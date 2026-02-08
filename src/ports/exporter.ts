import { ToolError } from '../types/internal';

export type ExportNativeParams = {
  formatId: string;
  destPath: string;
};

export type ExportGltfParams = {
  destPath: string;
};

export type ExportOperationResult = ToolError | null | Promise<ToolError | null>;

export interface ExportPort {
  exportNative: (params: ExportNativeParams) => ExportOperationResult;
  exportGltf: (params: ExportGltfParams) => ExportOperationResult;
}



