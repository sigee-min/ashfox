import type { ExportPayload } from '@ashfox/contracts/types/internal';

export type ResolvedExportFormat = Exclude<ExportPayload['format'], 'auto'>;
export type NonGltfExportFormat = Exclude<ResolvedExportFormat, 'gltf' | 'native_codec'>;

export type ResolvedExportSelection = {
  format: ResolvedExportFormat;
  codecId?: string;
};

