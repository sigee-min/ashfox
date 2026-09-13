import { deepFreeze } from '../../../immutable';
import type {
  AuthoredAssetWorkspace,
  Sha256Digest,
  WorkspaceChangeSet
} from '../../../project/workspace/contract';
import {
  errorDiagnostic,
  sortWorkspaceDiagnostics,
  type WorkspaceDiagnostic
} from '../../../project/workspace/diagnostic';
import {
  type ResolveWorkspaceEntryOptions
} from '../../../project/workspace/graph';
import { stageWorkspaceChangeSet } from '../../../project/workspace/change';
import { withWorkspaceLimits } from '../../../project/workspace/limits';
import { compileWorkspaceCandidate } from './workspaceCompile';

export type ApplyWorkspaceChangeSetResult =
  | Readonly<{
      readonly ok: true;
      readonly workspace: AuthoredAssetWorkspace;
      readonly workspaceHash: Sha256Digest;
    }>
  | Readonly<{
      readonly ok: false;
      readonly diagnostics: readonly WorkspaceDiagnostic[];
    }>;

const failure = (
  diagnostics: readonly WorkspaceDiagnostic[]
): ApplyWorkspaceChangeSetResult => deepFreeze({
  ok: false as const,
  diagnostics: sortWorkspaceDiagnostics(diagnostics)
});

/**
 * Stage, compile, and atomically accept one workspace edit. No candidate is
 * returned unless every declared entry and every declared module participates
 * in a valid semantic build.
 */
export const applyWorkspaceChangeSet = (
  current: AuthoredAssetWorkspace,
  changes: WorkspaceChangeSet,
  options: ResolveWorkspaceEntryOptions = {}
): ApplyWorkspaceChangeSetResult => {
  let maxDiagnostics: number;
  try {
    maxDiagnostics = withWorkspaceLimits(options.limits).maxDiagnostics;
  } catch {
    return failure([errorDiagnostic('workspace.budget.invalid',
      'Workspace limits are invalid.')]);
  }
  try {
    const staged = stageWorkspaceChangeSet(current, changes, options);
    if (!staged.ok) return failure(staged.diagnostics.slice(0, maxDiagnostics));
    const compiled = compileWorkspaceCandidate(staged.candidate, options);
    if (!compiled.ok) return failure(compiled.diagnostics);
    return deepFreeze({ ok: true as const, workspace: compiled.workspace,
      workspaceHash: staged.workspaceHash });
  } catch {
    return failure([errorDiagnostic('workspace.change.failure',
      'Workspace change validation failed closed.')]);
  }
};
