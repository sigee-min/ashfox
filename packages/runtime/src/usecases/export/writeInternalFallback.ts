import type { EditorPort } from '../../ports/editor';
import type { SessionState } from '../../session';
import type { ExportResult } from '@ashfox/contracts/types/internal';
import { buildInternalExport } from '../../domain/exporters';
import type { NonGltfExportFormat } from '../../domain/export/types';
import { fail, ok, type UsecaseResult } from '../result';

export const writeInternalFallbackExport = (
  editor: EditorPort,
  format: NonGltfExportFormat,
  destPath: string,
  snapshot: SessionState,
  options?: {
    selectedTarget?: ExportResult['selectedTarget'];
    stage?: ExportResult['stage'];
    warnings?: string[];
  }
): UsecaseResult<ExportResult> => {
  const bundle = buildInternalExport(format, snapshot);
  const serialized = JSON.stringify(bundle.data, null, 2);
  const err = editor.writeFile(destPath, serialized);
  if (err) return fail(err);
  return ok({
    path: destPath,
    ...(options?.selectedTarget ? { selectedTarget: options.selectedTarget } : {}),
    ...(options?.stage ? { stage: options.stage } : {}),
    ...(options?.warnings && options.warnings.length > 0 ? { warnings: options.warnings } : {})
  });
};
