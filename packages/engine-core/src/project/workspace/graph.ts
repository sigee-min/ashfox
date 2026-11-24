import { hasExactContractKeys, isClosedContractRecord } from '@ashfox/internal-contracts';

import {
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  type AuthoredAssetWorkspace,
  type WorkspaceModuleAbi,
} from './contract';
import {
  errorDiagnostic,
  sortWorkspaceDiagnostics,
  type WorkspaceDiagnostic,
  type WorkspaceReadResult,
} from './diagnostic';
import { resolveWorkspaceLimits, type WorkspaceLimitsOverride } from './limits';
import { computePackageInterfaceHash } from './hash';
import { readAuthoredAssetWorkspace } from './reader';
import {
  addDiagnostic,
  createWorkspaceSourceParseCache,
  makeIndexes,
  parseWorkspaceSource,
  parseWorkspaceSources,
  type ParsedState,
  validateDeclaredModuleImports,
} from './graphSource';
import {
  finalizeEntryCompilation,
  visitEntryNode,
  type EntryGraphContext,
  type WorkspaceCompilationSnapshot,
  type WorkspaceEntryCompilation,
} from './graph/visit';
import type {
  NodeRef,
  PackageIndex,
  WorkspaceEntryBuild,
  WorkspaceEntrySelector,
  WorkspaceGraphNode,
} from './graph/contract';

export type {
  WorkspaceEntryBuild,
  WorkspaceEntrySelector,
  WorkspaceGraphEdge,
  WorkspaceGraphNode,
} from './graph/contract';
export type { WorkspaceEntryCompilation } from './graph/visit';

export interface ResolveWorkspaceEntryOptions {
  readonly limits?: WorkspaceLimitsOverride;
}

const failure = <T>(diagnostics: readonly WorkspaceDiagnostic[]): WorkspaceReadResult<T> => ({
  ok: false,
  diagnostics: Object.freeze(sortWorkspaceDiagnostics([...diagnostics])),
});

const sliceDiagnostics = (
  diagnostics: readonly WorkspaceDiagnostic[],
  limit: number,
): readonly WorkspaceDiagnostic[] =>
  Object.freeze(sortWorkspaceDiagnostics(diagnostics.slice(0, limit)));

export const prepareCompilationSnapshot = (
  input: AuthoredAssetWorkspace,
  options: ResolveWorkspaceEntryOptions,
): WorkspaceReadResult<WorkspaceCompilationSnapshot> => {
  const resolved = resolveWorkspaceLimits(options.limits);
  if (!resolved.ok) {
    return failure([errorDiagnostic('workspace.budget.invalid', resolved.message)]);
  }
  const { limits } = resolved;
  const opened = readAuthoredAssetWorkspace(input, { limits });
  if (!opened.ok) return opened;
  const workspace = opened.value;
  if (workspace.lock.compilerFingerprint !== ASHFOX_WORKSPACE_COMPILER_FINGERPRINT) {
    return failure([
      errorDiagnostic(
        'workspace.lock.compiler_fingerprint',
        `Lock compilerFingerprint must equal ${ASHFOX_WORKSPACE_COMPILER_FINGERPRINT}.`,
      ),
    ]);
  }
  const indexes = makeIndexes(workspace);
  const cache = createWorkspaceSourceParseCache();
  return { ok: true, value: Object.freeze({ workspace, limits, indexes, cache }) };
};

const interfaceHashesByPackage = (
  states: ReadonlyMap<string, ParsedState>,
  indexes: ReadonlyMap<string, PackageIndex>,
): ReadonlyMap<string, readonly WorkspaceModuleAbi[]> => {
  const output = new Map<string, WorkspaceModuleAbi[]>();
  for (const [key, state] of states) {
    if (state.abi === undefined) continue;
    const separator = key.indexOf('\u0000');
    const packageName = key.slice(0, separator);
    const path = key.slice(separator + 1);
    const subpath = indexes.get(packageName)?.modulesByPath.get(path)?.subpath;
    if (subpath === undefined) continue;
    const list = output.get(packageName) ?? [];
    list.push({ ...state.abi, subpath });
    output.set(packageName, list);
  }
  return output;
};

const diagnosticKey = (item: WorkspaceDiagnostic): string =>
  item.source === undefined
    ? [item.code, item.message].join('\u0000')
    : [
        item.code,
        item.source.packageName ?? '',
        item.source.path,
        item.source.start.offset,
        item.source.end.offset,
      ].join('\u0000');

const isValidSelector = (selector: WorkspaceEntrySelector): boolean =>
  isClosedContractRecord(selector) &&
  hasExactContractKeys(selector, new Set(['packageName', 'entryName'])) &&
  typeof selector.packageName === 'string' &&
  typeof selector.entryName === 'string' &&
  /^[A-Za-z_][A-Za-z0-9_]*$/u.test(selector.entryName) &&
  selector.packageName.length > 0 &&
  selector.packageName.trim() === selector.packageName;

const resolveEntryRoot = (
  snapshot: WorkspaceCompilationSnapshot,
  selector: WorkspaceEntrySelector,
): WorkspaceReadResult<{ readonly root: NodeRef; readonly entryPath: string }> => {
  if (!isValidSelector(selector)) {
    return failure([
      errorDiagnostic(
        'workspace.entry.selector',
        'Entry selection must contain a packageName and ASCII entryName.',
      ),
    ]);
  }
  if (snapshot.workspace.lock.compilerFingerprint !== ASHFOX_WORKSPACE_COMPILER_FINGERPRINT) {
    return failure([
      errorDiagnostic(
        'workspace.lock.compiler_fingerprint',
        `Lock compilerFingerprint must equal ${ASHFOX_WORKSPACE_COMPILER_FINGERPRINT}.`,
      ),
    ]);
  }
  const rootPackage = snapshot.indexes.get(selector.packageName);
  if (rootPackage === undefined) {
    return failure([
      errorDiagnostic(
        'workspace.entry.package_missing',
        `Package is not present: ${selector.packageName}.`,
      ),
    ]);
  }
  const entryPath = rootPackage.entriesByName.get(selector.entryName);
  if (entryPath === undefined) {
    return failure([
      errorDiagnostic(
        'workspace.entry.missing',
        `Entry is not declared: ${selector.packageName}:${selector.entryName}.`,
      ),
    ]);
  }
  const root: NodeRef = {
    kind: 'entry',
    packageName: selector.packageName,
    name: selector.entryName,
    path: entryPath,
  };
  if (rootPackage.filesByPath.get(root.path) === undefined) {
    return failure([
      errorDiagnostic(
        'workspace.entry.source_missing',
        `Entry source is unavailable: ${entryPath}.`,
      ),
    ]);
  }
  return { ok: true, value: { root, entryPath } };
};

export const resolveWorkspaceEntryCompilationFromSnapshot = (
  snapshot: WorkspaceCompilationSnapshot,
  selector: WorkspaceEntrySelector,
): WorkspaceReadResult<WorkspaceEntryCompilation> => {
  const entry = resolveEntryRoot(snapshot, selector);
  if (!entry.ok) return entry;
  const { root, entryPath } = entry.value;
  const diagnostics: WorkspaceDiagnostic[] = [];
  const rootState = parseWorkspaceSource(
    snapshot.indexes,
    root,
    snapshot.cache,
    diagnostics,
    snapshot.limits,
  );
  if (rootState === undefined) return failure(diagnostics);
  if (rootState.unit.id !== selector.entryName) {
    return failure([
      errorDiagnostic(
        'workspace.entry.identity',
        `Manifest entry ${selector.entryName} does not match the root asset unit ${rootState.unit.id}.`,
      ),
    ]);
  }
  const context: EntryGraphContext = {
    snapshot,
    diagnostics,
    importEdges: [],
    nodes: [],
    visited: new Map<string, WorkspaceGraphNode>(),
    visiting: new Set<string>(),
  };
  if (!visitEntryNode(context, root, [], 0) || diagnostics.length > 0) return failure(diagnostics);
  return finalizeEntryCompilation(
    snapshot,
    selector,
    root,
    entryPath,
    context.nodes,
    context.importEdges,
  );
};

export const resolveWorkspaceEntryCompilation = (
  input: AuthoredAssetWorkspace,
  selector: WorkspaceEntrySelector,
  options: ResolveWorkspaceEntryOptions = {},
): WorkspaceReadResult<WorkspaceEntryCompilation> => {
  const prepared = prepareCompilationSnapshot(input, options);
  if (!prepared.ok) return prepared;
  return resolveWorkspaceEntryCompilationFromSnapshot(prepared.value, selector);
};

/** Public projection that intentionally omits the semantic closure. */
export const resolveWorkspaceEntry = (
  input: AuthoredAssetWorkspace,
  selector: WorkspaceEntrySelector,
  options: ResolveWorkspaceEntryOptions = {},
): WorkspaceReadResult<WorkspaceEntryBuild> => {
  const resolved = resolveWorkspaceEntryCompilation(input, selector, options);
  if (!resolved.ok) return resolved;
  return { ok: true, value: resolved.value.build };
};

export const computeWorkspaceEntryBuild = resolveWorkspaceEntry;

const checkPackageInterfaces = (
  snapshot: WorkspaceCompilationSnapshot,
  diagnostics: WorkspaceDiagnostic[],
): boolean => {
  const { limits, indexes, cache } = snapshot;
  const abis = interfaceHashesByPackage(cache.states, indexes);
  for (const pkg of indexes.values()) {
    const expected = computePackageInterfaceHash(
      { name: pkg.view.name, root: pkg.view.root, manifest: pkg.view.manifest },
      abis.get(pkg.view.name) ?? [],
    );
    if (pkg.lock.interfaceHash === expected) continue;
    const ok = addDiagnostic(
      diagnostics,
      limits,
      errorDiagnostic(
        'workspace.lock.stale_interface',
        `Exported ABI digest for ${pkg.view.name} is stale or not compiler-derived.`,
      ),
    );
    if (!ok) return false;
  }
  return true;
};

const appendEntryDiagnostics = (
  snapshot: WorkspaceCompilationSnapshot,
  selector: WorkspaceEntrySelector,
  emitted: Set<string>,
  diagnostics: WorkspaceDiagnostic[],
): boolean => {
  const result = resolveWorkspaceEntryCompilationFromSnapshot(snapshot, selector);
  if (result.ok) return diagnostics.length < snapshot.limits.maxDiagnostics;
  for (const diagnostic of result.diagnostics) {
    const key = diagnosticKey(diagnostic);
    if (emitted.has(key)) continue;
    emitted.add(key);
    if (!addDiagnostic(diagnostics, snapshot.limits, diagnostic)) return false;
  }
  return diagnostics.length < snapshot.limits.maxDiagnostics;
};

const collectEntryDiagnostics = (
  snapshot: WorkspaceCompilationSnapshot,
  diagnostics: WorkspaceDiagnostic[],
): boolean => {
  const emitted = new Set(diagnostics.map(diagnosticKey));
  for (const pkg of snapshot.indexes.values()) {
    for (const entry of pkg.view.manifest.entries) {
      const ok = appendEntryDiagnostics(
        snapshot,
        { packageName: pkg.view.name, entryName: entry.name },
        emitted,
        diagnostics,
      );
      if (!ok) return false;
    }
  }
  return true;
};

export const validateCompilationSnapshot = (
  snapshot: WorkspaceCompilationSnapshot,
): readonly WorkspaceDiagnostic[] => {
  const { limits, indexes, cache } = snapshot;
  const limit = limits.maxDiagnostics;
  const diagnostics: WorkspaceDiagnostic[] = [];
  if (parseWorkspaceSources(indexes, diagnostics, limits, cache) === undefined) {
    return sliceDiagnostics(diagnostics, limit);
  }
  validateDeclaredModuleImports(indexes, cache, diagnostics, limits);
  if (diagnostics.length >= limit) return sliceDiagnostics(diagnostics, limit);
  if (!checkPackageInterfaces(snapshot, diagnostics)) return sliceDiagnostics(diagnostics, limit);
  if (!collectEntryDiagnostics(snapshot, diagnostics)) return sliceDiagnostics(diagnostics, limit);
  return Object.freeze(sortWorkspaceDiagnostics(diagnostics));
};

export const validateWorkspaceEntries = (
  workspace: AuthoredAssetWorkspace,
  options: ResolveWorkspaceEntryOptions = {},
): readonly WorkspaceDiagnostic[] => {
  const prepared = prepareCompilationSnapshot(workspace, options);
  return prepared.ok ? validateCompilationSnapshot(prepared.value) : prepared.diagnostics;
};
