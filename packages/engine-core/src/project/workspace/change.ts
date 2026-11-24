import {
  isDenseContractArray,
  isClosedContractRecord,
  hasExactContractKeys,
} from '@ashfox/internal-contracts';
import {
  type AuthoredAssetWorkspace,
  type Sha256Digest,
  type WorkspaceChangeSet,
  type WorkspaceFile,
} from './contract';
import {
  errorDiagnostic,
  errorMessage,
  sortWorkspaceDiagnostics,
  syntheticSourceRef,
  type WorkspaceDiagnostic,
} from './diagnostic';
import { computeSourceContentHash, computeWorkspaceHash } from './hash';
import {
  resolveWorkspaceLimits,
  type WorkspaceLimits,
  type WorkspaceLimitsOverride,
} from './limits';
import { assertWellFormedSourceText, normalizeLogicalPath } from './path';
import { readWorkspaceManifest, readAuthoredAssetWorkspace } from './reader';
import { sealWorkspaceCandidate } from './seal';

export interface WorkspaceStageOptions {
  readonly limits?: WorkspaceLimitsOverride;
}

/** A validated candidate; it is not an authoritative workspace commit. */
export interface WorkspaceStageCandidate {
  readonly ok: true;
  readonly candidate: AuthoredAssetWorkspace;
  readonly workspaceHash: Sha256Digest;
}

export type WorkspaceStageResult =
  | WorkspaceStageCandidate
  | { readonly ok: false; readonly diagnostics: readonly WorkspaceDiagnostic[] };

type ChangeRecord = Readonly<Record<string, unknown>> & { readonly path: string };

/** Mutable staging state private to one change-set application. */
interface StagingState {
  readonly limits: WorkspaceLimits;
  readonly files: Map<string, WorkspaceFile>;
  readonly touched: Set<string>;
  readonly diagnostics: WorkspaceDiagnostic[];
}

/** A claimed logical path, or whether staging may continue after a rejection. */
type PathClaim = { readonly path: string } | { readonly proceed: boolean };

const CHANGE_KEYS = new Set(['expectedWorkspaceHash', 'writes', 'deletes', 'manifest']);

const fail = (code: string, message: string): WorkspaceStageResult => ({
  ok: false,
  diagnostics: [errorDiagnostic(code, message, syntheticSourceRef('ashfox.workspace.json'))],
});

const validDigest = (value: unknown): value is Sha256Digest =>
  typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);

const freezeFiles = (files: readonly WorkspaceFile[]): readonly WorkspaceFile[] =>
  Object.freeze(
    [...files]
      .sort((left, right) => (left.path < right.path ? -1 : 1))
      .map((file) => Object.freeze({ path: file.path, source: file.source })),
  );

/** Records one diagnostic; false once the diagnostic budget is exhausted. */
const report = (state: StagingState, diagnostic: WorkspaceDiagnostic): boolean => {
  if (state.diagnostics.length >= state.limits.maxDiagnostics) return false;
  state.diagnostics.push(diagnostic);
  return true;
};

const isChangeRecord = (value: unknown, required: readonly string[]): value is ChangeRecord =>
  isClosedContractRecord(value) &&
  (hasExactContractKeys(value, new Set(required)) ||
    hasExactContractKeys(value, new Set([...required, 'expectedHash']))) &&
  typeof value.path === 'string';

/** Header failure for a change set, or undefined when it may be applied. */
const checkChangeHeader = (
  base: AuthoredAssetWorkspace,
  changes: WorkspaceChangeSet,
  limits: WorkspaceLimits,
): WorkspaceStageResult | undefined => {
  if (
    !isClosedContractRecord(changes) ||
    Object.keys(changes).some((key) => !CHANGE_KEYS.has(key)) ||
    !Array.isArray(changes.writes) ||
    !Array.isArray(changes.deletes) ||
    !validDigest(changes.expectedWorkspaceHash)
  )
    return fail(
      'workspace.cas.changeset',
      'A change set must contain expectedWorkspaceHash, writes, and deletes.',
    );
  if (computeWorkspaceHash(base) !== changes.expectedWorkspaceHash)
    return fail(
      'workspace.cas.stale',
      'Workspace changed since the supplied expectedWorkspaceHash; no files were changed.',
    );
  if (!isDenseContractArray(changes.writes) || !isDenseContractArray(changes.deletes))
    return fail('workspace.cas.changeset', 'Workspace writes and deletes must be arrays.');
  if (changes.writes.length + changes.deletes.length > limits.maxFiles)
    return fail(
      'workspace.budget.changeset',
      'Workspace change set is larger than the file budget.',
    );
  return undefined;
};

const claimPath = (state: StagingState, rawPath: string, invalidMessage: string): PathClaim => {
  let path: string;
  try {
    path = normalizeLogicalPath(rawPath, state.limits.maxPathCodeUnits);
  } catch (error) {
    return {
      proceed: report(
        state,
        errorDiagnostic('workspace.cas.path', errorMessage(error, invalidMessage)),
      ),
    };
  }
  if (state.touched.has(path))
    return {
      proceed: report(
        state,
        errorDiagnostic(
          'workspace.cas.conflict',
          `Path is written or deleted more than once: ${path}.`,
        ),
      ),
    };
  state.touched.add(path);
  return { path };
};

const writeRaced = (existing: WorkspaceFile | undefined, expectedHash: Sha256Digest | null) =>
  expectedHash === null
    ? existing !== undefined
    : existing === undefined || computeSourceContentHash(existing.source) !== expectedHash;

/** Validates write expectedHash; returns false only when the diagnostic budget is exhausted. */
const checkWriteHash = (state: StagingState, path: string, expectedHash: unknown): boolean => {
  if (expectedHash === undefined) return true;
  if (expectedHash !== null && !validDigest(expectedHash))
    return report(
      state,
      errorDiagnostic('workspace.cas.expected_file_hash', `Invalid expected hash for ${path}.`),
    );
  if (!writeRaced(state.files.get(path), expectedHash)) return true;
  return report(
    state,
    errorDiagnostic('workspace.cas.file_race', `Write compare-and-swap failed for ${path}.`),
  );
};

const stageWriteSource = (state: StagingState, path: string, value: unknown): boolean => {
  try {
    const source = assertWellFormedSourceText(value);
    if (source.trim().length === 0) throw new Error('Workspace source must not be empty.');
    state.files.set(path, Object.freeze({ path, source }));
    return true;
  } catch (error) {
    return report(
      state,
      errorDiagnostic('workspace.cas.source', errorMessage(error, `Invalid source for ${path}.`)),
    );
  }
};

/** Applies one write; false stops staging because the budget is exhausted. */
const applyWrite = (state: StagingState, write: unknown): boolean => {
  if (!isChangeRecord(write, ['path', 'source']))
    return report(state, errorDiagnostic('workspace.cas.path', 'Write path must be text.'));
  const claim = claimPath(state, write.path, `Invalid write path: ${write.path}.`);
  if (!('path' in claim)) return claim.proceed;
  if (!checkWriteHash(state, claim.path, write.expectedHash)) return false;
  return stageWriteSource(state, claim.path, write.source);
};

/** Applies one delete; false stops staging because the budget is exhausted. */
const applyDelete = (state: StagingState, deletion: unknown): boolean => {
  if (!isChangeRecord(deletion, ['path']))
    return report(state, errorDiagnostic('workspace.cas.path', 'Delete path must be text.'));
  const claim = claimPath(state, deletion.path, `Invalid delete path: ${deletion.path}.`);
  if (!('path' in claim)) return claim.proceed;
  const { path } = claim;
  const existing = state.files.get(path);
  if (existing === undefined)
    return report(
      state,
      errorDiagnostic(
        'workspace.cas.missing_delete',
        `Cannot delete a missing workspace file: ${path}.`,
      ),
    );
  if (
    deletion.expectedHash !== undefined &&
    (!validDigest(deletion.expectedHash) ||
      computeSourceContentHash(existing.source) !== deletion.expectedHash)
  )
    return report(
      state,
      errorDiagnostic('workspace.cas.file_race', `Delete compare-and-swap failed for ${path}.`),
    );
  state.files.delete(path);
  return true;
};

const applyFileChanges = (state: StagingState, changes: WorkspaceChangeSet): void => {
  for (const write of changes.writes) if (!applyWrite(state, write)) break;
  if (state.diagnostics.length >= state.limits.maxDiagnostics) return;
  for (const deletion of changes.deletes) if (!applyDelete(state, deletion)) break;
};

/** Stages a parsed, locally sealed candidate after compare-and-swap and structure checks. */
export const stageWorkspaceChangeSet = (
  current: AuthoredAssetWorkspace,
  changes: WorkspaceChangeSet,
  options: WorkspaceStageOptions = {},
): WorkspaceStageResult => {
  const resolved = resolveWorkspaceLimits(options.limits);
  if (!resolved.ok) return fail('workspace.budget.invalid', resolved.message);
  const { limits } = resolved;
  const opened = readAuthoredAssetWorkspace(current, { limits });
  if (!opened.ok) return opened;
  const base = opened.value;
  const rejected = checkChangeHeader(base, changes, limits);
  if (rejected !== undefined) return rejected;

  const state: StagingState = {
    limits,
    files: new Map(base.files.map((file) => [file.path, file])),
    touched: new Set<string>(),
    diagnostics: [],
  };
  applyFileChanges(state, changes);
  if (state.diagnostics.length > 0)
    return { ok: false, diagnostics: Object.freeze(sortWorkspaceDiagnostics(state.diagnostics)) };

  let manifestValue = base.manifest;
  if (changes.manifest !== undefined) {
    const manifest = readWorkspaceManifest(changes.manifest);
    if (!manifest.ok) return manifest;
    manifestValue = manifest.value;
  }
  const candidate = sealWorkspaceCandidate(
    base,
    freezeFiles([...state.files.values()]),
    manifestValue,
    limits,
  );
  if (!candidate.ok) return candidate;
  return {
    ok: true,
    candidate: candidate.value,
    workspaceHash: computeWorkspaceHash(candidate.value),
  };
};
