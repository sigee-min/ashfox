import {
  isDenseContractArray,
  isClosedContractRecord,
  hasExactContractKeys
} from '@ashfox/internal-contracts';
import {
  type AuthoredAssetWorkspace,
  type Sha256Digest,
  type WorkspaceChangeSet,
  type WorkspaceFile
} from './contract';
import {
  errorDiagnostic,
  sortWorkspaceDiagnostics,
  syntheticSourceRef,
  type WorkspaceDiagnostic,
} from './diagnostic';
import { computeSourceContentHash, computeWorkspaceHash } from './hash';
import { withWorkspaceLimits, type WorkspaceLimitsOverride } from './limits';
import {
  assertWellFormedSourceText,
  normalizeLogicalPath
} from './path';
import {
  readWorkspaceManifest,
  readAuthoredAssetWorkspace
} from './reader';
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

const fail = (code: string, message: string): WorkspaceStageResult => ({
  ok: false,
  diagnostics: [errorDiagnostic(code, message, syntheticSourceRef('ashfox.workspace.json'))]
});

const validDigest = (value: unknown): value is Sha256Digest =>
  typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);

const freezeFiles = (files: readonly WorkspaceFile[]): readonly WorkspaceFile[] =>
  Object.freeze([...files].sort((left, right) => left.path < right.path ? -1 : 1)
    .map((file) => Object.freeze({ path: file.path, source: file.source })));

/** Stages a parsed, locally sealed candidate after compare-and-swap and structure checks. */
export const stageWorkspaceChangeSet = (
  current: AuthoredAssetWorkspace,
  changes: WorkspaceChangeSet,
  options: WorkspaceStageOptions = {}
): WorkspaceStageResult => {
  let limits: ReturnType<typeof withWorkspaceLimits>;
  try {
    limits = withWorkspaceLimits(options.limits);
  } catch (error) {
    return fail('workspace.budget.invalid', error instanceof Error
      ? error.message : 'Workspace limits are invalid.');
  }
  const opened = readAuthoredAssetWorkspace(current, { limits });
  if (!opened.ok) return opened;
  const base = opened.value;
  const allowedChangeKeys = new Set([
    'expectedWorkspaceHash', 'writes', 'deletes', 'manifest'
  ]);
  if (!isClosedContractRecord(changes) ||
      Object.keys(changes).some((key) => !allowedChangeKeys.has(key)) ||
      !Array.isArray(changes.writes) || !Array.isArray(changes.deletes) ||
      !validDigest(changes.expectedWorkspaceHash)) return fail(
    'workspace.cas.changeset',
    'A change set must contain expectedWorkspaceHash, writes, and deletes.');
  const actualHash = computeWorkspaceHash(base);
  if (actualHash !== changes.expectedWorkspaceHash) return fail(
    'workspace.cas.stale',
    'Workspace changed since the supplied expectedWorkspaceHash; no files were changed.');
  if (!isDenseContractArray(changes.writes) || !isDenseContractArray(changes.deletes)) return fail(
    'workspace.cas.changeset', 'Workspace writes and deletes must be arrays.');
  if (changes.writes.length + changes.deletes.length > limits.maxFiles) return fail(
    'workspace.budget.changeset', 'Workspace change set is larger than the file budget.');

  const files = new Map(base.files.map((file) => [file.path, file]));
  const touched = new Set<string>();
  const diagnostics: WorkspaceDiagnostic[] = [];
  const push = (diagnostic: WorkspaceDiagnostic): boolean => {
    if (diagnostics.length >= limits.maxDiagnostics) return false;
    diagnostics.push(diagnostic);
    return true;
  };
  for (const write of changes.writes) {
    if (!isClosedContractRecord(write) ||
        (!(hasExactContractKeys(write, new Set(['path', 'source'])) ||
          hasExactContractKeys(write, new Set(['path', 'source', 'expectedHash'])))) ||
        typeof write.path !== 'string') {
      if (!push(errorDiagnostic('workspace.cas.path', 'Write path must be text.'))) break;
      continue;
    }
    let path: string;
    try {
      path = normalizeLogicalPath(write.path, limits.maxPathCodeUnits);
    } catch (error) {
      if (!push(errorDiagnostic('workspace.cas.path', error instanceof Error
        ? error.message : `Invalid write path: ${write.path}.`))) break;
      continue;
    }
    if (touched.has(path)) {
      if (!push(errorDiagnostic('workspace.cas.conflict',
        `Path is written or deleted more than once: ${path}.`))) break;
      continue;
    }
    touched.add(path);
    const existing = files.get(path);
    if (write.expectedHash !== undefined) {
      if (write.expectedHash !== null && !validDigest(write.expectedHash)) {
        if (!push(errorDiagnostic('workspace.cas.expected_file_hash',
          `Invalid expected hash for ${path}.`))) break;
      } else if (write.expectedHash === null ? existing !== undefined :
        existing === undefined || computeSourceContentHash(existing.source) !== write.expectedHash) {
        if (!push(errorDiagnostic('workspace.cas.file_race',
          `Write compare-and-swap failed for ${path}.`))) break;
      }
    }
    try {
      const source = assertWellFormedSourceText(write.source);
      if (source.trim().length === 0) throw new Error('Workspace source must not be empty.');
      files.set(path, Object.freeze({ path, source }));
    } catch (error) {
      if (!push(errorDiagnostic('workspace.cas.source', error instanceof Error
        ? error.message : `Invalid source for ${path}.`))) break;
    }
  }
  if (diagnostics.length < limits.maxDiagnostics) {
    for (const deletion of changes.deletes) {
      if (!isClosedContractRecord(deletion) ||
          (!(hasExactContractKeys(deletion, new Set(['path'])) ||
            hasExactContractKeys(deletion, new Set(['path', 'expectedHash'])))) ||
          typeof deletion.path !== 'string') {
        if (!push(errorDiagnostic('workspace.cas.path', 'Delete path must be text.'))) break;
        continue;
      }
      let path: string;
      try {
        path = normalizeLogicalPath(deletion.path, limits.maxPathCodeUnits);
      } catch (error) {
        if (!push(errorDiagnostic('workspace.cas.path', error instanceof Error
          ? error.message : `Invalid delete path: ${deletion.path}.`))) break;
        continue;
      }
      if (touched.has(path)) {
        if (!push(errorDiagnostic('workspace.cas.conflict',
          `Path is written or deleted more than once: ${path}.`))) break;
        continue;
      }
      touched.add(path);
      const existing = files.get(path);
      if (existing === undefined) {
        if (!push(errorDiagnostic('workspace.cas.missing_delete',
          `Cannot delete a missing workspace file: ${path}.`))) break;
        continue;
      }
      if (deletion.expectedHash !== undefined &&
          (!validDigest(deletion.expectedHash) ||
            computeSourceContentHash(existing.source) !== deletion.expectedHash)) {
        if (!push(errorDiagnostic('workspace.cas.file_race',
          `Delete compare-and-swap failed for ${path}.`))) break;
        continue;
      }
      files.delete(path);
    }
  }
  if (diagnostics.length > 0) return {
    ok: false,
    diagnostics: Object.freeze(sortWorkspaceDiagnostics(diagnostics))
  };

  let manifestValue = base.manifest;
  if (changes.manifest !== undefined) {
    const manifest = readWorkspaceManifest(changes.manifest);
    if (!manifest.ok) return manifest;
    manifestValue = manifest.value;
  }
  const candidate = sealWorkspaceCandidate(base, freezeFiles([...files.values()]), manifestValue, limits);
  if (!candidate.ok) return candidate;
  return {
    ok: true,
    candidate: candidate.value,
    workspaceHash: computeWorkspaceHash(candidate.value)
  };
};
