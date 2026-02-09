import type { Capabilities, ExportPayload, ExportResult, ToolError } from '@ashfox/contracts/types/internal';
import type { ExportPort } from '../ports/exporter';
import type { EditorPort } from '../ports/editor';
import type { FormatPort } from '../ports/formats';
import type { ProjectSession } from '../session';
import { ProjectStateBuilder } from '../domain/project/projectStateBuilder';
import { fail, ok, UsecaseResult } from './result';
import { type FormatOverrides } from '../domain/formats';
import { withFormatOverrideHint } from './formatHints';
import type { ExportPolicy } from './policies';
import {
  EXPORT_CODEC_ID_REQUIRED,
  EXPORT_FORMAT_AUTO_UNRESOLVED,
  EXPORT_FORMAT_ID_MISSING,
  EXPORT_FORMAT_MISMATCH,
  EXPORT_FORMAT_NOT_ENABLED
} from '../shared/messages';
import { exportFormatToCapability } from '../domain/export/formatMapping';
import { ensureExportFormatEnabled, ensureSnapshotMatchesExportFormat } from '../domain/export/guards';
import { resolveExportFormatId } from '../domain/export/formatId';
import { resolveRequestedExport } from '../domain/export/requestedFormat';
import { writeInternalFallbackExport } from './export/writeInternalFallback';
import type { ResolvedExportSelection } from '../domain/export/types';

export interface ExportServiceDeps {
  capabilities: Capabilities;
  editor: EditorPort;
  exporter: ExportPort;
  formats: FormatPort;
  projectState: ProjectStateBuilder;
  getSnapshot: () => ReturnType<ProjectSession['snapshot']>;
  ensureActive: () => ToolError | null;
  policies: {
    formatOverrides?: FormatOverrides;
    exportPolicy?: ExportPolicy;
  };
}

export class ExportService {
  private readonly capabilities: Capabilities;
  private readonly editor: EditorPort;
  private readonly exporter: ExportPort;
  private readonly formats: FormatPort;
  private readonly projectState: ProjectStateBuilder;
  private readonly getSnapshot: () => ReturnType<ProjectSession['snapshot']>;
  private readonly ensureActive: () => ToolError | null;
  private readonly policies: ExportServiceDeps['policies'];

  constructor(deps: ExportServiceDeps) {
    this.capabilities = deps.capabilities;
    this.editor = deps.editor;
    this.exporter = deps.exporter;
    this.formats = deps.formats;
    this.projectState = deps.projectState;
    this.getSnapshot = deps.getSnapshot;
    this.ensureActive = deps.ensureActive;
    this.policies = deps.policies;
  }

  async exportModel(payload: ExportPayload): Promise<UsecaseResult<ExportResult>> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);

    const exportPolicy = payload.options?.fallback ?? this.policies.exportPolicy ?? 'strict';
    const includeDiagnostics = payload.options?.includeDiagnostics === true;
    const snapshot = this.getSnapshot();
    const resolvedRequested = resolveRequestedExport(payload, snapshot, {
      nativeCodecs: this.listNativeCodecs(),
      matchOverrideKind: (formatId) => this.projectState.matchOverrideKind(formatId)
    });
    if (!resolvedRequested.ok) {
      return fail({ code: 'invalid_payload', message: EXPORT_FORMAT_AUTO_UNRESOLVED });
    }

    const requested = resolvedRequested.value;
    const requestedFormat = requested.format;
    const expectedFormat = exportFormatToCapability(requestedFormat);
    const resolvedTarget = this.buildSelectedTarget(requested);
    const formatGuard = ensureExportFormatEnabled(this.capabilities, expectedFormat);
    if (!formatGuard.ok) {
      return fail({ code: 'unsupported_format', message: EXPORT_FORMAT_NOT_ENABLED(formatGuard.format) });
    }

    const snapshotGuard = ensureSnapshotMatchesExportFormat(
      snapshot,
      expectedFormat,
      (formatId) => this.projectState.matchOverrideKind(formatId)
    );
    if (!snapshotGuard.ok) {
      return fail({
        code: 'invalid_payload',
        message: snapshotGuard.needsOverrideHint
          ? withFormatOverrideHint(EXPORT_FORMAT_MISMATCH)
          : EXPORT_FORMAT_MISMATCH
      });
    }

    if (requestedFormat === 'gltf') {
      return await this.exportGltf(payload.destPath, resolvedTarget);
    }
    if (requestedFormat === 'native_codec') {
      if (!requested.codecId) {
        return fail({ code: 'invalid_payload', message: EXPORT_CODEC_ID_REQUIRED });
      }
      return await this.exportCodec(requested.codecId, payload.destPath, resolvedTarget);
    }

    if (requestedFormat === 'generic_model_json') {
      return writeInternalFallbackExport(this.editor, requestedFormat, payload.destPath, snapshot, {
        selectedTarget: resolvedTarget,
        stage: 'done'
      });
    }

    const formatId = resolveExportFormatId(
      snapshot,
      expectedFormat,
      this.formats.listFormats(),
      this.policies.formatOverrides
    );
    if (!formatId) {
      return fail({ code: 'unsupported_format', message: withFormatOverrideHint(EXPORT_FORMAT_ID_MISSING) });
    }

    const nativeErr = await this.exporter.exportNative({ formatId, destPath: payload.destPath });
    if (!nativeErr) {
      return ok({
        path: payload.destPath,
        selectedTarget: this.withFormatId(resolvedTarget, formatId),
        stage: 'done'
      });
    }
    if (exportPolicy === 'strict') {
      return fail(nativeErr);
    }
    if (nativeErr.code !== 'not_implemented' && nativeErr.code !== 'unsupported_format') {
      return fail(nativeErr);
    }
    return writeInternalFallbackExport(this.editor, requestedFormat, payload.destPath, snapshot, {
      selectedTarget: this.withFormatId(resolvedTarget, formatId),
      stage: 'fallback',
      warnings: includeDiagnostics ? [nativeErr.message] : undefined
    });
  }

  private async exportGltf(
    destPath: string,
    selectedTarget: NonNullable<ExportResult['selectedTarget']>
  ): Promise<UsecaseResult<ExportResult>> {
    const err = await this.exporter.exportGltf({ destPath });
    if (err) return fail(err);
    return ok({ path: destPath, selectedTarget, stage: 'done' });
  }

  private async exportCodec(
    codecId: string,
    destPath: string,
    selectedTarget: NonNullable<ExportResult['selectedTarget']>
  ): Promise<UsecaseResult<ExportResult>> {
    if (typeof this.exporter.exportCodec !== 'function') {
      return fail({ code: 'not_implemented', message: 'Native codec export is not available in this runtime.' });
    }
    const err = await this.exporter.exportCodec({ codecId, destPath });
    if (err) return fail(err);
    return ok({ path: destPath, selectedTarget, stage: 'done' });
  }

  private listNativeCodecs() {
    const list = this.exporter.listNativeCodecs;
    if (typeof list !== 'function') return [];
    return list();
  }

  private buildSelectedTarget(
    selection: ResolvedExportSelection
  ): NonNullable<ExportResult['selectedTarget']> {
    switch (selection.format) {
      case 'native_codec':
        return {
          kind: 'native_codec',
          id: selection.codecId ?? 'native_codec',
          ...(selection.codecId ? { codecId: selection.codecId } : {})
        };
      case 'gltf':
        return { kind: 'gltf', id: 'gltf' };
      default:
        return { kind: 'internal', id: selection.format };
    }
  }

  private withFormatId(
    selectedTarget: NonNullable<ExportResult['selectedTarget']>,
    formatId: string
  ): NonNullable<ExportResult['selectedTarget']> {
    if (selectedTarget.kind !== 'internal') return selectedTarget;
    return { ...selectedTarget, formatId };
  }
}




