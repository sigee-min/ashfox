import { deepFreeze } from '../../../immutable';
import type { AuthoredAssetWorkspace, Sha256Digest } from '../../../project/workspace/contract';
import { errorDiagnostic, sortWorkspaceDiagnostics, type WorkspaceDiagnostic } from '../../../project/workspace/diagnostic';
import {
  prepareCompilationSnapshot, resolveWorkspaceEntryCompilationFromSnapshot,
  validateCompilationSnapshot, type ResolveWorkspaceEntryOptions, type WorkspaceEntrySelector
} from '../../../project/workspace/graph';
import { withWorkspaceLimits } from '../../../project/workspace/limits';
import { joinLogicalPath } from '../../../project/workspace/path';
import { computeWorkspaceHash } from '../../../project/workspace/hash';
import { compileResolvedAssetWorkspaceEntry, type CompileAssetWorkspaceEntryResult } from './compile';

type CandidateProduct = Extract<CompileAssetWorkspaceEntryResult, { readonly ok: true }> & {
  readonly entry: WorkspaceEntrySelector;
};
type CompileWorkspaceCandidateResult =
  | Readonly<{ readonly ok: true; readonly workspace: AuthoredAssetWorkspace;
      readonly workspaceHash: Sha256Digest; readonly products: readonly CandidateProduct[] }>
  | Readonly<{ readonly ok: false; readonly diagnostics: readonly WorkspaceDiagnostic[] }>;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const diagnosticKey = (item: WorkspaceDiagnostic): string => [
  item.code,
  item.source?.packageName ?? '',
  item.source?.path ?? '',
  item.source?.start.offset ?? -1,
  item.source?.end.offset ?? -1,
  item.message
].join('\u0000');

const failure = (
  diagnostics: readonly WorkspaceDiagnostic[]
): CompileWorkspaceCandidateResult => deepFreeze({
  ok: false as const,
  diagnostics: sortWorkspaceDiagnostics(diagnostics)
});

/** Validate every entry and module using one invocation-owned parser snapshot. */
export const compileWorkspaceCandidate = (
  input: AuthoredAssetWorkspace,
  options: ResolveWorkspaceEntryOptions = {},
  collectProducts = false
): CompileWorkspaceCandidateResult => {
  let maxDiagnostics: number;
  try { maxDiagnostics = withWorkspaceLimits(options.limits).maxDiagnostics; }
  catch { return failure([errorDiagnostic('workspace.budget.invalid', 'Workspace limits are invalid.')]); }
  try {
    const prepared = prepareCompilationSnapshot(input, options);
    if (!prepared.ok) return failure(prepared.diagnostics.slice(0, maxDiagnostics));
    const workspace = prepared.value.workspace, workspaceHash = computeWorkspaceHash(workspace);
    const products: CandidateProduct[] = [];
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
    if (!push(validateCompilationSnapshot(prepared.value)) || diagnostics.length > 0) {
      return failure(diagnostics);
    }

    const entries = workspace.manifest.packages.flatMap((pkg) =>
      pkg.manifest.entries.map((entry) => ({ packageName: pkg.name,
        entryName: entry.name }))).sort((left, right) =>
      compareText(left.packageName, right.packageName) ||
      compareText(left.entryName, right.entryName));
    const reachableModules = new Set<string>();
    for (const selector of entries) {
      const resolved = resolveWorkspaceEntryCompilationFromSnapshot(prepared.value, selector);
      if (!resolved.ok) {
        if (!push(resolved.diagnostics)) break;
        continue;
      }
      for (const node of resolved.value.build.nodes) if (node.kind === 'module') {
        reachableModules.add(`${node.packageName}\u0000${node.path}`);
      }
      const compiled = compileResolvedAssetWorkspaceEntry(workspaceHash, resolved.value);
      if (!compiled.ok && !push(compiled.diagnostics)) break;
      if (compiled.ok && collectProducts) products.push({ entry: selector, ...compiled });
    }
    if (diagnostics.length < maxDiagnostics) for (const pkg of workspace.manifest.packages) {
      for (const module of pkg.manifest.modules) {
        const path = joinLogicalPath(pkg.root, module.path);
        if (!reachableModules.has(`${pkg.name}\u0000${path}`) && !push([errorDiagnostic(
          'workspace.module.orphan',
          `Declared module "${pkg.name}:${module.subpath}" is unreachable from every asset entry.`
        )])) break;
      }
      if (diagnostics.length >= maxDiagnostics) break;
    }
    if (diagnostics.length > 0) return failure(diagnostics);
    return deepFreeze({ ok: true as const, workspace, workspaceHash, products });
  } catch {
    return failure([errorDiagnostic('workspace.change.failure', 'Workspace change validation failed closed.')]);
  }
};
