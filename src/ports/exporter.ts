import { ToolError } from '../types';

export type ExportNativeParams = {
  formatId: string;
  destPath: string;
};

export interface ExportPort {
  exportNative: (params: ExportNativeParams) => ToolError | null;
}


