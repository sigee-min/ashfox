import {
  computeWorkspaceHash,
  type AssetProject,
  type WorkspaceEntrySelector
} from '@ashfox/engine-core';

const MAX_CANDIDATE_PREVIEWS = 8;

interface CandidatePreviewEntry {
  readonly projectId: AssetProject['id'];
  readonly revision: AssetProject['revision'];
  readonly baseEntry: WorkspaceEntrySelector;
  readonly baseBuild: AssetProject['build'];
  readonly candidateEntry: WorkspaceEntrySelector;
  readonly candidateBuild: AssetProject['build'];
  readonly project: AssetProject;
}

const entries = new Map<string, CandidatePreviewEntry>();

const randomToken = (): string | null => {
  try {
    if (typeof globalThis.crypto !== 'undefined' &&
      typeof globalThis.crypto.randomUUID === 'function') {
      return `candidate-preview-${globalThis.crypto.randomUUID()}`;
    }
    if (typeof globalThis.crypto !== 'undefined' &&
      typeof globalThis.crypto.getRandomValues === 'function') {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
      return `candidate-preview-${Array.from(bytes, (value) =>
        value.toString(16).padStart(2, '0')).join('')}`;
    }
  } catch {
    // Candidate tokens must never fall back to predictable randomness.
  }
  return null;
};

const sameEntry = (
  left: WorkspaceEntrySelector,
  right: WorkspaceEntrySelector
): boolean => left.packageName === right.packageName &&
  left.entryName === right.entryName;

const sameBuild = (
  left: AssetProject['build'],
  right: AssetProject['build']
): boolean => left.packageName === right.packageName &&
  left.entryName === right.entryName &&
  left.path === right.path &&
  left.workspaceHash === right.workspaceHash &&
  left.closureHash === right.closureHash &&
  left.buildKey === right.buildKey &&
  left.compilerFingerprint === right.compilerFingerprint &&
  left.productHash === right.productHash;

const isProjectWorkspaceCurrent = (project: AssetProject): boolean => {
  try {
    return project.build.workspaceHash === computeWorkspaceHash(project.workspace);
  } catch {
    return false;
  }
};

const prune = (): void => {
  while (entries.size > MAX_CANDIDATE_PREVIEWS) {
    const oldest = entries.keys().next().value;
    if (typeof oldest !== 'string') return;
    entries.delete(oldest);
  }
};

/** Store a compiler-created candidate only in the transient Web process. */
export const createCandidatePreview = (
  base: AssetProject,
  candidate: AssetProject
): string | null => {
  if (base.id !== candidate.id ||
    base.revision !== candidate.revision ||
    !isProjectWorkspaceCurrent(base) ||
    !isProjectWorkspaceCurrent(candidate) ||
    candidate.build.productHash.length === 0) return null;
  const token = randomToken();
  if (token === null) return null;
  prune();
  entries.set(token, {
    projectId: base.id,
    revision: base.revision,
    baseEntry: { ...base.entry },
    baseBuild: { ...base.build },
    candidateEntry: { ...candidate.entry },
    candidateBuild: { ...candidate.build },
    project: candidate
  });
  prune();
  return token;
};

/** Read a candidate only while every host/build binding remains unchanged. */
export const candidatePreviewFor = (
  base: AssetProject,
  token: string
): AssetProject | null => {
  prune();
  const entry = entries.get(token);
  const valid = entry !== undefined &&
    entry.projectId === base.id &&
    entry.revision === base.revision &&
    sameEntry(entry.baseEntry, base.entry) &&
    sameBuild(entry.baseBuild, base.build) &&
    isProjectWorkspaceCurrent(base) &&
    sameBuild(entry.candidateBuild, entry.project.build) &&
    sameEntry(entry.candidateEntry, entry.project.entry) &&
    isProjectWorkspaceCurrent(entry.project);
  if (!valid) {
    if (entry !== undefined) entries.delete(token);
    return null;
  }
  entries.delete(token);
  entries.set(token, entry);
  return entry.project;
};
