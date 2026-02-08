import type { Capabilities, ExportPayload, FormatKind, ToolError } from '../types/internal';
import type { ExportPort } from '../ports/exporter';
import type { EditorPort } from '../ports/editor';
import type { FormatPort } from '../ports/formats';
import type { ProjectSession } from '../session';
import { ProjectStateBuilder } from '../domain/project/projectStateBuilder';
import { ok, fail, UsecaseResult } from './result';
import { resolveFormatId, FormatOverrides, matchesFormatKind } from '../domain/formats';
import { buildInternalExport } from '../domain/exporters';
import { withFormatOverrideHint } from './formatHints';
import type { ExportPolicy } from './policies';
import {
  EXPORT_FORMAT_AUTO_UNRESOLVED,
  EXPORT_FORMAT_ID_MISSING,
  EXPORT_FORMAT_MISMATCH,
  EXPORT_FORMAT_NOT_ENABLED
} from '../shared/messages';

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

  async exportModel(payload: ExportPayload): Promise<UsecaseResult<{ path: string }>> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);

    const exportPolicy = this.policies.exportPolicy ?? 'strict';
    const snapshot = this.getSnapshot();
    const resolvedFormat = this.resolveRequestedFormat(payload, snapshot);
    if (!resolvedFormat.ok) return fail(resolvedFormat.error);

    const requestedFormat = resolvedFormat.value;
    const expectedFormat = exportFormatToCapability(requestedFormat);
    const capabilityErr = this.ensureFormatEnabled(expectedFormat);
    if (capabilityErr) return fail(capabilityErr);

    const snapshotErr = this.ensureSnapshotMatchesExpected(snapshot, expectedFormat);
    if (snapshotErr) return fail(snapshotErr);

    if (requestedFormat === 'gltf') {
      return await this.exportGltf(payload.destPath);
    }

    if (requestedFormat === 'generic_model_json') {
      return this.writeInternalFallback(requestedFormat, payload.destPath, snapshot);
    }

    const formatId = this.resolveExportFormatId(snapshot, expectedFormat);
    if (!formatId) {
      return fail({ code: 'unsupported_format', message: withFormatOverrideHint(EXPORT_FORMAT_ID_MISSING) });
    }

    const nativeErr = await this.exporter.exportNative({ formatId, destPath: payload.destPath });
    if (!nativeErr) return ok({ path: payload.destPath });
    if (exportPolicy === 'strict') {
      return fail(nativeErr);
    }
    if (nativeErr.code !== 'not_implemented' && nativeErr.code !== 'unsupported_format') {
      return fail(nativeErr);
    }
    return this.writeInternalFallback(requestedFormat, payload.destPath, snapshot);
  }

  private ensureFormatEnabled(expectedFormat: FormatKind | null): ToolError | null {
    if (!expectedFormat) return null;
    const formatCapability = this.capabilities.formats.find((entry) => entry.format === expectedFormat);
    if (!formatCapability || !formatCapability.enabled) {
      return { code: 'unsupported_format', message: EXPORT_FORMAT_NOT_ENABLED(expectedFormat) };
    }
    return null;
  }

  private ensureSnapshotMatchesExpected(
    snapshot: ReturnType<ProjectSession['snapshot']>,
    expectedFormat: FormatKind | null
  ): ToolError | null {
    if (!expectedFormat) return null;
    if (snapshot.format && snapshot.format !== expectedFormat) {
      return { code: 'invalid_payload', message: EXPORT_FORMAT_MISMATCH };
    }
    if (
      !snapshot.format &&
      snapshot.formatId &&
      !matchesFormatKind(expectedFormat, snapshot.formatId) &&
      this.projectState.matchOverrideKind(snapshot.formatId) !== expectedFormat
    ) {
      return { code: 'invalid_payload', message: withFormatOverrideHint(EXPORT_FORMAT_MISMATCH) };
    }
    return null;
  }

  private resolveExportFormatId(
    snapshot: ReturnType<ProjectSession['snapshot']>,
    expectedFormat: FormatKind | null
  ): string | null {
    if (snapshot.formatId) return snapshot.formatId;
    if (!expectedFormat) return null;
    return resolveFormatId(expectedFormat, this.formats.listFormats(), this.policies.formatOverrides);
  }

  private resolveRequestedFormat(
    payload: ExportPayload,
    snapshot: ReturnType<ProjectSession['snapshot']>
  ): UsecaseResult<ResolvedExportFormat> {
    if (payload.format !== 'auto') {
      return ok(payload.format);
    }
    const fromPath = resolveAutoFormatFromPath(payload.destPath);
    if (fromPath) return ok(fromPath);
    const fromProject = this.resolveAutoFormatFromSnapshot(snapshot);
    if (fromProject) return ok(fromProject);
    return fail({ code: 'invalid_payload', message: EXPORT_FORMAT_AUTO_UNRESOLVED });
  }

  private resolveAutoFormatFromSnapshot(snapshot: ReturnType<ProjectSession['snapshot']>): NonGltfExportFormat | null {
    const formatKind = resolveSnapshotFormatKind(snapshot, this.projectState);
    if (!formatKind) return null;
    return mapFormatKindToDefaultExport(formatKind);
  }

  private async exportGltf(destPath: string): Promise<UsecaseResult<{ path: string }>> {
    const err = await this.exporter.exportGltf({ destPath });
    if (err) return fail(err);
    return ok({ path: destPath });
  }

  private writeInternalFallback(
    format: NonGltfExportFormat,
    destPath: string,
    snapshot: ReturnType<ProjectSession['snapshot']>
  ): UsecaseResult<{ path: string }> {
    const bundle = buildInternalExport(format, snapshot);
    const serialized = JSON.stringify(bundle.data, null, 2);
    const err = this.editor.writeFile(destPath, serialized);
    if (err) return fail(err);
    return ok({ path: destPath });
  }
}

type ResolvedExportFormat = Exclude<ExportPayload['format'], 'auto'>;
type NonGltfExportFormat = Exclude<ResolvedExportFormat, 'gltf'>;

const exportFormatToCapability = (format: ResolvedExportFormat): FormatKind | null => {
  switch (format) {
    case 'java_block_item_json':
      return 'Java Block/Item';
    case 'gecko_geo_anim':
      return 'geckolib';
    case 'animated_java':
      return 'animated_java';
    case 'generic_model_json':
      return 'Generic Model';
    case 'gltf':
    default:
      return null;
  }
};

const resolveAutoFormatFromPath = (destPath: string): ResolvedExportFormat | null => {
  const normalized = String(destPath ?? '').trim().toLowerCase();
  if (normalized.endsWith('.gltf') || normalized.endsWith('.glb')) {
    return 'gltf';
  }
  return null;
};

const resolveSnapshotFormatKind = (
  snapshot: ReturnType<ProjectSession['snapshot']>,
  projectState: ProjectStateBuilder
): FormatKind | null => {
  if (snapshot.format) return snapshot.format;
  if (!snapshot.formatId) return null;
  const overridden = projectState.matchOverrideKind(snapshot.formatId);
  if (overridden) return overridden;
  if (matchesFormatKind('Java Block/Item', snapshot.formatId)) return 'Java Block/Item';
  if (matchesFormatKind('geckolib', snapshot.formatId)) return 'geckolib';
  if (matchesFormatKind('animated_java', snapshot.formatId)) return 'animated_java';
  if (matchesFormatKind('Generic Model', snapshot.formatId)) return 'Generic Model';
  return null;
};

const mapFormatKindToDefaultExport = (formatKind: FormatKind): NonGltfExportFormat | null => {
  switch (formatKind) {
    case 'Java Block/Item':
      return 'java_block_item_json';
    case 'geckolib':
      return 'gecko_geo_anim';
    case 'animated_java':
      return 'animated_java';
    case 'Generic Model':
      return 'generic_model_json';
    default:
      return null;
  }
};




