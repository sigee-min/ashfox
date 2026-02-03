import type { ToolError } from '../types';

export type TmpSaveResult = {
  path: string;
  mimeType: string;
  byteLength: number;
};

export interface TmpStorePort {
  saveDataUri: (
    dataUri: string,
    options?: { nameHint?: string; prefix?: string; cwd?: string }
  ) => { ok: true; data: TmpSaveResult } | { ok: false; error: ToolError };
}


