import { isClosedContractRecord } from '@ashfox/internal-contracts';

import { errorMessage } from './diagnostic';

/** Resource ceilings applied before graph traversal or hashing. */
export interface WorkspaceLimits {
  readonly maxPathCodeUnits: number;
  readonly maxFiles: number;
  readonly maxPackages: number;
  readonly maxEntries: number;
  readonly maxModules: number;
  readonly maxSourceCodeUnits: number;
  readonly maxSourceBytes: number;
  readonly maxImportEdges: number;
  readonly maxImportDepth: number;
  readonly maxDiagnostics: number;
}

export const DEFAULT_WORKSPACE_LIMITS: WorkspaceLimits = Object.freeze({
  maxPathCodeUnits: 240,
  maxFiles: 512,
  maxPackages: 64,
  maxEntries: 256,
  maxModules: 512,
  maxSourceCodeUnits: 1_000_000,
  maxSourceBytes: 4 * 1024 * 1024,
  maxImportEdges: 4096,
  maxImportDepth: 64,
  maxDiagnostics: 256,
});

export type WorkspaceLimitsOverride = Partial<WorkspaceLimits>;

const WORKSPACE_LIMIT_KEYS = new Set<keyof WorkspaceLimits>(
  Object.keys(DEFAULT_WORKSPACE_LIMITS) as (keyof WorkspaceLimits)[],
);

export const withWorkspaceLimits = (
  override: WorkspaceLimitsOverride | undefined,
): WorkspaceLimits => {
  if (
    override !== undefined &&
    (!isClosedContractRecord(override) ||
      Object.keys(override).some((key) => !WORKSPACE_LIMIT_KEYS.has(key as keyof WorkspaceLimits)))
  ) {
    throw new TypeError('Workspace limits must be a closed limits object.');
  }
  const candidate = {
    ...DEFAULT_WORKSPACE_LIMITS,
    ...(override ?? {}),
  };
  for (const [name, value] of Object.entries(candidate)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`Workspace limit ${name} must be a positive safe integer.`);
    }
  }
  return Object.freeze(candidate);
};

export type WorkspaceLimitsResolution =
  | { readonly ok: true; readonly limits: WorkspaceLimits }
  | { readonly ok: false; readonly message: string };

/** Non-throwing limits resolution shared by every workspace boundary. */
export const resolveWorkspaceLimits = (
  override: WorkspaceLimitsOverride | undefined,
): WorkspaceLimitsResolution => {
  try {
    return { ok: true, limits: withWorkspaceLimits(override) };
  } catch (error) {
    return { ok: false, message: errorMessage(error, 'Workspace limits are invalid.') };
  }
};
