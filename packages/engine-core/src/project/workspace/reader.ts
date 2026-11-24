import {
  hasExactContractKeys,
  isClosedContractRecord,
  isDenseContractArray,
} from '@ashfox/internal-contracts';

import { type AuthoredAssetWorkspace, type WorkspaceFile } from './contract';
import {
  errorDiagnostic,
  sortWorkspaceDiagnostics,
  syntheticSourceRef,
  type WorkspaceReadResult,
} from './diagnostic';
import { withWorkspaceLimits, type WorkspaceLimitsOverride } from './limits';
import { assertWellFormedSourceText, normalizeLogicalPath } from './path';
import { readWorkspaceLock, readWorkspaceManifest } from './schema';
import { validateWorkspaceContents } from './validation';

type RecordValue = Readonly<Record<string, unknown>>;

const exactRecord = (value: unknown, keys: readonly string[]): value is RecordValue =>
  isClosedContractRecord(value) && hasExactContractKeys(value, new Set(keys));

const failure = <T>(code: string, message: string): WorkspaceReadResult<T> => ({
  ok: false,
  diagnostics: [errorDiagnostic(code, message, syntheticSourceRef('ashfox.workspace.json'))],
});

export interface ReadWorkspaceOptions {
  readonly limits?: WorkspaceLimitsOverride;
}

/** Closed, strict reader for the one public source authority. */
export const readAuthoredAssetWorkspace = (
  value: unknown,
  options: ReadWorkspaceOptions = {},
): WorkspaceReadResult<AuthoredAssetWorkspace> => {
  let limits: ReturnType<typeof withWorkspaceLimits>;
  try {
    limits = withWorkspaceLimits(options.limits);
  } catch (error) {
    return failure(
      'workspace.budget.invalid',
      error instanceof Error ? error.message : 'Workspace limits are invalid.',
    );
  }
  if (!exactRecord(value, ['files', 'manifest', 'lock']))
    return failure(
      'workspace.contract.authority',
      'AuthoredAssetWorkspace must contain exactly files, manifest, and lock.',
    );
  if (!isDenseContractArray(value.files))
    return failure('workspace.contract.array', 'workspace.files must be a dense array.');
  if (value.files.length > limits.maxFiles)
    return failure(
      'workspace.budget.files',
      `Workspace contains more than ${limits.maxFiles} files.`,
    );
  const files: WorkspaceFile[] = [];
  for (const item of value.files) {
    if (!exactRecord(item, ['path', 'source']))
      return failure(
        'workspace.contract.file',
        'Each workspace file must contain exactly path and source.',
      );
    if (typeof item.path !== 'string')
      return failure('workspace.contract.path', 'Workspace file path must be text.');
    let path: string;
    try {
      path = normalizeLogicalPath(item.path, limits.maxPathCodeUnits);
    } catch (error) {
      return failure(
        'workspace.contract.path',
        error instanceof Error ? error.message : 'Workspace file path is invalid.',
      );
    }
    try {
      const source = assertWellFormedSourceText(item.source);
      if (source.trim().length === 0)
        return failure(
          'workspace.contract.source_empty',
          `Workspace source must not be empty: ${path}.`,
        );
      files.push(Object.freeze({ path, source }));
    } catch (error) {
      return failure(
        'workspace.contract.utf8',
        error instanceof Error ? error.message : `Workspace source is invalid: ${path}.`,
      );
    }
  }
  const manifest = readWorkspaceManifest(value.manifest);
  if (!manifest.ok) return manifest;
  const lock = readWorkspaceLock(value.lock);
  if (!lock.ok) return lock;
  const normalizedFiles = Object.freeze(
    files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  );
  const candidate: AuthoredAssetWorkspace = Object.freeze({
    files: normalizedFiles,
    manifest: manifest.value,
    lock: lock.value,
  });
  const diagnostics = validateWorkspaceContents(candidate, options.limits);
  if (diagnostics.length > 0)
    return {
      ok: false,
      diagnostics: Object.freeze(
        sortWorkspaceDiagnostics(diagnostics.slice(0, limits.maxDiagnostics)),
      ),
    };
  return { ok: true, value: candidate };
};

export { readPackageManifest, readWorkspaceLock, readWorkspaceManifest } from './schema';
export { validateWorkspaceContents } from './validation';
