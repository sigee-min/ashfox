import type { Capabilities, ExportPayload, FormatKind } from '@ashfox/contracts/types/internal';
import type { ProjectSession } from '../session';
import type { BlockbenchFormats } from '../adapters/blockbench/BlockbenchFormats';
import type { ExportPolicy } from '../usecases/policies';
import { readGlobals } from '../adapters/blockbench/blockbenchUtils';
import type { Logger } from '../logging';
import { buildInternalExport } from '../domain/exporters';
import { resolveFormatId, type FormatOverrides } from '../domain/formats';
import { BlockbenchCompileAdapter } from '../adapters/blockbench/export/BlockbenchCompileAdapter';
import { PLUGIN_ID } from '../config';
import {
  PLUGIN_UI_EXPORT_COMPLETE,
  PLUGIN_UI_EXPORT_FAILED,
  PLUGIN_UI_EXPORT_FAILED_GENERIC
} from './messages';
import {
  ADAPTER_NATIVE_COMPILER_EMPTY,
  EXPORT_FORMAT_ID_MISSING_FOR_KIND
} from '../shared/messages';

export const registerCodecs = (args: {
  capabilities: Capabilities;
  session: ProjectSession;
  formats: BlockbenchFormats;
  formatOverrides: FormatOverrides;
  exportPolicy: ExportPolicy;
  logger: Logger;
}): void => {
  const globals = readGlobals();
  const blockbench = globals.Blockbench;
  const codecCtor = globals.Codec;
  if (!blockbench || !codecCtor) return;
  const compileAdapter = new BlockbenchCompileAdapter(args.logger);

  const notifyExportFailure = (message?: string) => {
    const content = message ?? PLUGIN_UI_EXPORT_FAILED_GENERIC;
    blockbench.showQuickMessage?.(PLUGIN_UI_EXPORT_FAILED(content), 2000);
  };

  const buildInternalExportString = (exportKind: ExportPayload['format']): string | null => {
    const snapshot = args.session.snapshot();
    try {
      return JSON.stringify(buildInternalExport(exportKind, snapshot).data);
    } catch (_err) {
      return null;
    }
  };

  const compileFor = (
    kind: FormatKind,
    exportKind: ExportPayload['format']
  ): { ok: true; data: string } | { ok: false; message: string } => {
    const formatId = resolveFormatId(kind, args.formats.listFormats(), args.formatOverrides);
    if (!formatId) {
      if (args.exportPolicy === 'best_effort') {
        const fallback = buildInternalExportString(exportKind);
        if (fallback) return { ok: true, data: fallback };
      }
      return { ok: false, message: EXPORT_FORMAT_ID_MISSING_FOR_KIND(kind) };
    }

    const compiled = compileAdapter.compileNativeFormat(formatId);
    if (compiled.ok) {
      if (typeof compiled.compiled === 'string') {
        return { ok: true, data: compiled.compiled };
      }
      try {
        return { ok: true, data: JSON.stringify(compiled.compiled) };
      } catch (_err) {
        return { ok: false, message: ADAPTER_NATIVE_COMPILER_EMPTY };
      }
    }

    if (args.exportPolicy === 'best_effort' && compiled.error.code === 'not_implemented') {
      const fallback = buildInternalExportString(exportKind);
      if (fallback) return { ok: true, data: fallback };
    }
    return { ok: false, message: compiled.error.message };
  };

  const compileWithNotice = (kind: FormatKind, exportKind: ExportPayload['format']): string | null => {
    const result = compileFor(kind, exportKind);
    if (!result.ok) {
      notifyExportFailure(result.message);
      return null;
    }
    return result.data;
  };

  const register = (kind: FormatKind, exportKind: ExportPayload['format'], codecName: string) => {
    new codecCtor({
      name: codecName,
      extension: 'json',
      remember: true,
      compile() {
        const compiled = compileWithNotice(kind, exportKind);
        return compiled ?? '';
      },
      export() {
        try {
          const compiled = compileWithNotice(kind, exportKind);
          if (!compiled) return;
          blockbench.exportFile?.(
            { content: compiled, name: 'model.json' },
            () => blockbench.showQuickMessage?.(PLUGIN_UI_EXPORT_COMPLETE, 1500)
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : PLUGIN_UI_EXPORT_FAILED_GENERIC;
          notifyExportFailure(message);
        }
      }
    });
  };

  if (args.capabilities.formats.find((f) => f.format === 'Java Block/Item' && f.enabled)) {
    register('Java Block/Item', 'java_block_item_json', PLUGIN_ID + '_java_block_item');
  }
  if (args.capabilities.formats.find((f) => f.format === 'geckolib' && f.enabled)) {
    register('geckolib', 'gecko_geo_anim', PLUGIN_ID + '_geckolib');
  }
  if (args.capabilities.formats.find((f) => f.format === 'animated_java' && f.enabled)) {
    register('animated_java', 'animated_java', PLUGIN_ID + '_animated_java');
  }
};

