import {
  hasExactContractKeys,
  isClosedContractRecord,
  isDenseContractArray,
} from '@ashfox/internal-contracts';

import { type AuthoredAssetWorkspace, type WorkspaceFile } from './contract';
import {
  errorDiagnostic,
  errorMessage,
  sortWorkspaceDiagnostics,
  syntheticSourceRef,
  type WorkspaceReadResult,
} from './diagnostic';
import {
  resolveWorkspaceLimits,
  type WorkspaceLimits,
  type WorkspaceLimitsOverride,
} from './limits';
import { assertWellFormedSourceText, normalizeLogicalPath } from './path';
import { readWorkspaceLock } from './lockSchema';
import { readWorkspaceManifest } from './schema';
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

const readWorkspaceFile = (
  item: unknown,
  maxPathCodeUnits: number,
): WorkspaceReadResult<WorkspaceFile> => {
  if (!exactRecord(item, ['path', 'source'])) {
    return failure(
      'workspace.contract.file',
      'Each workspace file must contain exactly path and source.',
    );
  }
  if (typeof item.path !== 'string') {
    return failure('workspace.contract.path', 'Workspace file path must be text.');
  }
  let path: string;
  try {
    path = normalizeLogicalPath(item.path, maxPathCodeUnits);
  } catch (error) {
    return failure(
      'workspace.contract.path',
      errorMessage(error, 'Workspace file path is invalid.'),
    );
  }
  try {
    const source = assertWellFormedSourceText(item.source);
    if (source.trim().length === 0) {
      return failure(
        'workspace.contract.source_empty',
        `Workspace source must not be empty: ${path}.`,
      );
    }
    return { ok: true, value: Object.freeze({ path, source }) };
  } catch (error) {
    return failure(
      'workspace.contract.utf8',
      errorMessage(error, `Workspace source is invalid: ${path}.`),
    );
  }
};

const readWorkspaceFiles = (
  rawFiles: unknown,
  limits: WorkspaceLimits,
): WorkspaceReadResult<readonly WorkspaceFile[]> => {
  if (!isDenseContractArray(rawFiles)) {
    return failure('workspace.contract.array', 'workspace.files must be a dense array.');
  }
  if (rawFiles.length > limits.maxFiles) {
    return failure(
      'workspace.budget.files',
      `Workspace contains more than ${limits.maxFiles} files.`,
    );
  }
  const files: WorkspaceFile[] = [];
  for (const item of rawFiles) {
    const file = readWorkspaceFile(item, limits.maxPathCodeUnits);
    if (!file.ok) return file;
    files.push(file.value);
  }
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { ok: true, value: Object.freeze(files) };
};

/** Closed, strict reader for the one public source authority. */
export const readAuthoredAssetWorkspace = (
  value: unknown,
  options: ReadWorkspaceOptions = {},
): WorkspaceReadResult<AuthoredAssetWorkspace> => {
  const resolved = resolveWorkspaceLimits(options.limits);
  if (!resolved.ok) return failure('workspace.budget.invalid', resolved.message);
  const { limits } = resolved;
  if (!exactRecord(value, ['files', 'manifest', 'lock'])) {
    return failure(
      'workspace.contract.authority',
      'AuthoredAssetWorkspace must contain exactly files, manifest, and lock.',
    );
  }
  const files = readWorkspaceFiles(value.files, limits);
  if (!files.ok) return files;
  const manifest = readWorkspaceManifest(value.manifest);
  if (!manifest.ok) return manifest;
  const lock = readWorkspaceLock(value.lock);
  if (!lock.ok) return lock;
  const candidate: AuthoredAssetWorkspace = Object.freeze({
    files: files.value,
    manifest: manifest.value,
    lock: lock.value,
  });
  const diagnostics = validateWorkspaceContents(candidate, options.limits);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: Object.freeze(
        sortWorkspaceDiagnostics(diagnostics.slice(0, limits.maxDiagnostics)),
      ),
    };
  }
  return { ok: true, value: candidate };
};

export { readWorkspaceLock } from './lockSchema';
export { readPackageManifest, readWorkspaceManifest } from './schema';
export { validateWorkspaceContents } from './validation';
