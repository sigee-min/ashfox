import type {
  AuthoredAssetWorkspace
} from '../workspace/contract';
import type {
  WorkspaceDiagnostic
} from '../workspace/diagnostic';
import type {
  WorkspaceLimitsOverride
} from '../workspace/limits';

/** Portable container identity for the one workspace source authority. */
export const ASHFOX_WORKSPACE_FILE_EXTENSION = '.ashfoxworkspace' as const;
export const ASHFOX_WORKSPACE_FILE_CONTENT_TYPE =
  'application/vnd.ashfox.workspace+json' as const;

/** File bytes or already-decoded UTF-8 text at the host boundary. */
export type WorkspaceFileInput = string | Uint8Array;

export interface ReadWorkspaceFileOptions {
  readonly limits?: WorkspaceLimitsOverride;
}

export type ReadWorkspaceFileResult =
  | {
      readonly ok: true;
      readonly workspace: AuthoredAssetWorkspace;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly WorkspaceDiagnostic[];
    };

export type WriteWorkspaceFileResult =
  | { readonly ok: true; readonly source: string }
  | {
      readonly ok: false;
      readonly diagnostics: readonly WorkspaceDiagnostic[];
    };
