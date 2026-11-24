import { compareText } from '../../../stableOrder';
import { deepFreeze } from '../../../immutable';
import type { AuthoredAssetWorkspace, Sha256Digest } from '../../../project/workspace/contract';
import {
  errorDiagnostic,
  sortWorkspaceDiagnostics,
  type WorkspaceDiagnostic,
} from '../../../project/workspace/diagnostic';
import {
  prepareCompilationSnapshot,
  resolveWorkspaceEntryCompilationFromSnapshot,
  validateCompilationSnapshot,
  type ResolveWorkspaceEntryOptions,
  type WorkspaceEntryCompilation,
  type WorkspaceEntrySelector,
} from '../../../project/workspace/graph';
import { withWorkspaceLimits } from '../../../project/workspace/limits';
import { joinLogicalPath } from '../../../project/workspace/path';
import { computeWorkspaceHash } from '../../../project/workspace/hash';
import {
  compileResolvedAssetWorkspaceEntry,
  type CompileAssetWorkspaceEntryResult,
} from './compile';

type CandidateProduct = Extract<CompileAssetWorkspaceEntryResult, { readonly ok: true }> & {
  readonly entry: WorkspaceEntrySelector;
};
type CompileWorkspaceCandidateResult =
  | Readonly<{
      readonly ok: true;
      readonly workspace: AuthoredAssetWorkspace;
      readonly workspaceHash: Sha256Digest;
      readonly products: readonly CandidateProduct[];
    }>
  | Readonly<{ readonly ok: false; readonly diagnostics: readonly WorkspaceDiagnostic[] }>;

const diagnosticKey = (item: WorkspaceDiagnostic): string =>
  [
    item.code,
    item.source?.packageName ?? '',
    item.source?.path ?? '',
    item.source?.start.offset ?? -1,
    item.source?.end.offset ?? -1,
    item.message,
  ].join('\u0000');

const failure = (diagnostics: readonly WorkspaceDiagnostic[]): CompileWorkspaceCandidateResult =>
  deepFreeze({
    ok: false as const,
    diagnostics: sortWorkspaceDiagnostics(diagnostics),
  });

type CompilationSnapshot = Parameters<typeof resolveWorkspaceEntryCompilationFromSnapshot>[0];

/** Deduplicating diagnostic collector bounded by the workspace diagnostic budget. */
interface DiagnosticSink {
  readonly diagnostics: WorkspaceDiagnostic[];
  /** Adds unseen diagnostics; returns false once the budget is reached. */
  readonly push: (values: readonly WorkspaceDiagnostic[]) => boolean;
}

const createSink = (maxDiagnostics: number): DiagnosticSink => {
  const diagnostics: WorkspaceDiagnostic[] = [];
  const emitted = new Set<string>();
  const push = (values: readonly WorkspaceDiagnostic[]): boolean => {
    for (const value of values) {
      const key = diagnosticKey(value);
      if (emitted.has(key)) continue;
      emitted.add(key);
      diagnostics.push(value);
      if (diagnostics.length >= maxDiagnostics) return false;
    }
    return true;
  };
  return { diagnostics, push };
};

const sortedEntries = (workspace: AuthoredAssetWorkspace): WorkspaceEntrySelector[] =>
  workspace.manifest.packages
    .flatMap((pkg) =>
      pkg.manifest.entries.map((entry) => ({ packageName: pkg.name, entryName: entry.name })),
    )
    .sort(
      (left, right) =>
        compareText(left.packageName, right.packageName) ||
        compareText(left.entryName, right.entryName),
    );

const recordReachableModules = (
  resolved: WorkspaceEntryCompilation,
  reachableModules: Set<string>,
): void => {
  for (const node of resolved.build.nodes)
    if (node.kind === 'module') reachableModules.add(`${node.packageName}\u0000${node.path}`);
};

interface EntryRun {
  readonly reachableModules: ReadonlySet<string>;
  readonly products: CandidateProduct[];
}

/** Compiles every entry in stable order, stopping once the diagnostic budget is reached. */
const compileEntries = (
  snapshot: CompilationSnapshot,
  workspaceHash: Sha256Digest,
  sink: DiagnosticSink,
  collectProducts: boolean,
): EntryRun => {
  const products: CandidateProduct[] = [];
  const reachableModules = new Set<string>();
  for (const selector of sortedEntries(snapshot.workspace)) {
    const resolved = resolveWorkspaceEntryCompilationFromSnapshot(snapshot, selector);
    if (!resolved.ok) {
      if (!sink.push(resolved.diagnostics)) break;
      continue;
    }
    recordReachableModules(resolved.value, reachableModules);
    const compiled = compileResolvedAssetWorkspaceEntry(workspaceHash, resolved.value);
    if (!compiled.ok && !sink.push(compiled.diagnostics)) break;
    if (compiled.ok && collectProducts) products.push({ entry: selector, ...compiled });
  }
  return { reachableModules, products };
};

/** Reports declared modules no entry reaches, stopping once the budget is reached. */
const reportOrphanModules = (
  workspace: AuthoredAssetWorkspace,
  reachableModules: ReadonlySet<string>,
  sink: DiagnosticSink,
): void => {
  for (const pkg of workspace.manifest.packages)
    for (const module of pkg.manifest.modules) {
      if (reachableModules.has(`${pkg.name}\u0000${joinLogicalPath(pkg.root, module.path)}`))
        continue;
      const orphan = errorDiagnostic(
        'workspace.module.orphan',
        `Declared module "${pkg.name}:${module.subpath}" is unreachable from every asset entry.`,
      );
      if (!sink.push([orphan])) return;
    }
};

const compileSnapshot = (
  snapshot: CompilationSnapshot,
  maxDiagnostics: number,
  collectProducts: boolean,
): CompileWorkspaceCandidateResult => {
  const workspace = snapshot.workspace;
  const workspaceHash = computeWorkspaceHash(workspace);
  const sink = createSink(maxDiagnostics);
  if (!sink.push(validateCompilationSnapshot(snapshot)) || sink.diagnostics.length > 0)
    return failure(sink.diagnostics);
  const run = compileEntries(snapshot, workspaceHash, sink, collectProducts);
  if (sink.diagnostics.length < maxDiagnostics)
    reportOrphanModules(workspace, run.reachableModules, sink);
  if (sink.diagnostics.length > 0) return failure(sink.diagnostics);
  return deepFreeze({ ok: true as const, workspace, workspaceHash, products: run.products });
};

/** Validate every entry and module using one invocation-owned parser snapshot. */
export const compileWorkspaceCandidate = (
  input: AuthoredAssetWorkspace,
  options: ResolveWorkspaceEntryOptions = {},
  collectProducts = false,
): CompileWorkspaceCandidateResult => {
  let maxDiagnostics: number;
  try {
    maxDiagnostics = withWorkspaceLimits(options.limits).maxDiagnostics;
  } catch {
    return failure([errorDiagnostic('workspace.budget.invalid', 'Workspace limits are invalid.')]);
  }
  try {
    const prepared = prepareCompilationSnapshot(input, options);
    if (!prepared.ok) return failure(prepared.diagnostics.slice(0, maxDiagnostics));
    return compileSnapshot(prepared.value, maxDiagnostics, collectProducts);
  } catch {
    return failure([
      errorDiagnostic('workspace.change.failure', 'Workspace change validation failed closed.'),
    ]);
  }
};
