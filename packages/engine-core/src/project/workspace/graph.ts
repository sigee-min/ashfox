import {
  hasExactContractKeys,
  isClosedContractRecord
} from '@ashfox/internal-contracts';

import { canonicalJsonString } from '../../canonicalJson';
import { sha256Digest } from '../../provenance/digest';

import {
  ASHFOX_MODEL_GRAMMAR,
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  type AuthoredAssetWorkspace,
  type LockedPackage,
  type Sha256Digest,
  type WorkspaceFile,
  type WorkspaceModuleAbi
} from './contract';
import {
  errorDiagnostic,
  sortWorkspaceDiagnostics,
  type SourceRef,
  type WorkspaceDiagnostic,
  type WorkspaceReadResult
} from './diagnostic';
import { withWorkspaceLimits, type WorkspaceLimits, type WorkspaceLimitsOverride } from './limits';
import { computeModuleInterfaceHash, computePackageInterfaceHash, computeSourceContentHash } from './hash';
import { readAuthoredAssetWorkspace } from './reader';
import {
  addDiagnostic,
  createWorkspaceSourceParseCache,
  keyFor,
  makeIndexes,
  parseWorkspaceSource,
  parseWorkspaceSources,
  qualified,
  resolveImport,
  sourceKey,
  type NodeRef,
  type PackageIndex,
  type ParsedState,
  type WorkspaceSourceParseCache,
  validateDeclaredModuleImports
} from './graphSource';
import {
  createWorkspaceCompilationClosure
} from './closure';
import type { WorkspaceCompilationClosure } from './closure';
import type {
  WorkspaceEntryBuild,
  WorkspaceEntrySelector,
  WorkspaceGraphEdge,
  WorkspaceGraphNode
} from './graph/contract';

export type {
  WorkspaceEntryBuild,
  WorkspaceEntrySelector,
  WorkspaceGraphEdge,
  WorkspaceGraphNode
} from './graph/contract';

export interface ResolveWorkspaceEntryOptions {
  readonly limits?: WorkspaceLimitsOverride;
}

/** Internal graph result consumed by the semantic compiler boundary. */
export interface WorkspaceEntryCompilation {
  readonly build: WorkspaceEntryBuild;
  readonly closure: WorkspaceCompilationClosure;
}

interface WorkspaceCompilationSnapshot {
  readonly workspace: AuthoredAssetWorkspace;
  readonly limits: WorkspaceLimits;
  readonly indexes: ReadonlyMap<string, PackageIndex>;
  readonly cache: WorkspaceSourceParseCache;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const packageFor = (
  indexes: ReadonlyMap<string, PackageIndex>,
  ref: NodeRef
): PackageIndex | undefined => indexes.get(ref.packageName);

const fileFor = (pkg: PackageIndex, ref: NodeRef): WorkspaceFile | undefined =>
  pkg.filesByPath.get(ref.path);

const closureProjection = (
  entry: NodeRef,
  nodes: readonly WorkspaceGraphNode[],
  edges: readonly WorkspaceGraphEdge[],
  lockByName: ReadonlyMap<string, LockedPackage>
): unknown => ({
  format: 'ashfox-entry-closure',
  version: 1,
  entry: {
    packageName: entry.packageName,
    name: entry.name,
    path: entry.path,
    contentHash: nodes.find((node) => node.packageName === entry.packageName &&
      node.path === entry.path)?.contentHash
  },
  nodes: [...nodes].sort((a, b) => compareText(a.packageName, b.packageName) ||
    compareText(a.path, b.path)).map((node) => ({
    kind: node.kind, packageName: node.packageName, name: node.name,
    path: node.path, contentHash: node.contentHash, interfaceHash: node.interfaceHash
  })),
  edges: [...edges].sort((a, b) => compareText(a.from, b.from) ||
    compareText(a.to, b.to) || compareText(a.specifier, b.specifier)).map((edge) => ({
    from: edge.from, to: edge.to, packageName: edge.packageName,
    specifier: edge.specifier, alias: edge.alias
  })),
  // Aggregate package hashes are intentionally absent: changing an unrelated
  // entry must not change this selected entry's transitive closure identity.
  packages: [...new Set(nodes.map((node) => node.packageName))].sort(compareText).map((name) => {
    const lock = lockByName.get(name);
    return lock === undefined ? { name } : {
      name, source: lock.source, digest: lock.digest
    };
  })
});

const failure = <T>(
  diagnostics: readonly WorkspaceDiagnostic[]
): WorkspaceReadResult<T> => ({
  ok: false,
  diagnostics: Object.freeze(sortWorkspaceDiagnostics([...diagnostics]))
});

export const prepareCompilationSnapshot = (
  input: AuthoredAssetWorkspace,
  options: ResolveWorkspaceEntryOptions
): WorkspaceReadResult<WorkspaceCompilationSnapshot> => {
  let limits: WorkspaceLimits;
  try {
    limits = withWorkspaceLimits(options.limits);
  } catch (error) {
    return failure([errorDiagnostic('workspace.budget.invalid', error instanceof Error
      ? error.message : 'Workspace limits are invalid.')]);
  }
  const opened = readAuthoredAssetWorkspace(input, { limits });
  if (!opened.ok) return opened;
  const workspace = opened.value;
  if (workspace.lock.compilerFingerprint !== ASHFOX_WORKSPACE_COMPILER_FINGERPRINT) {
    return failure([errorDiagnostic('workspace.lock.compiler_fingerprint',
      `Lock compilerFingerprint must equal ${ASHFOX_WORKSPACE_COMPILER_FINGERPRINT}.`)]);
  }
  const indexes = makeIndexes(workspace);
  const cache = createWorkspaceSourceParseCache();
  return { ok: true, value: Object.freeze({ workspace, limits, indexes, cache }) };
};

const interfaceHashesByPackage = (
  states: ReadonlyMap<string, ParsedState>,
  indexes: ReadonlyMap<string, PackageIndex>
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

const diagnosticKey = (item: WorkspaceDiagnostic): string => item.source === undefined
  ? [item.code, item.message].join('\u0000')
  : [item.code, item.source.packageName ?? '', item.source.path,
    item.source.start.offset, item.source.end.offset].join('\u0000');

export const resolveWorkspaceEntryCompilationFromSnapshot = (
  snapshot: WorkspaceCompilationSnapshot,
  selector: WorkspaceEntrySelector,
): WorkspaceReadResult<WorkspaceEntryCompilation> => {
  const { workspace, limits, indexes, cache } = snapshot;
  if (!isClosedContractRecord(selector) || !hasExactContractKeys(selector,
    new Set(['packageName', 'entryName'])) ||
      typeof selector.packageName !== 'string' || typeof selector.entryName !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(selector.entryName) ||
      selector.packageName.length === 0 ||
      selector.packageName.trim() !== selector.packageName) {
    return failure([errorDiagnostic('workspace.entry.selector',
      'Entry selection must contain a packageName and ASCII entryName.')]);
  }
  if (workspace.lock.compilerFingerprint !== ASHFOX_WORKSPACE_COMPILER_FINGERPRINT) {
    return failure([errorDiagnostic('workspace.lock.compiler_fingerprint',
      `Lock compilerFingerprint must equal ${ASHFOX_WORKSPACE_COMPILER_FINGERPRINT}.`)]);
  }
  const rootPackage = indexes.get(selector.packageName);
  if (rootPackage === undefined) return failure([errorDiagnostic('workspace.entry.package_missing',
    `Package is not present: ${selector.packageName}.`)]);
  const entryPath = rootPackage.entriesByName.get(selector.entryName);
  if (entryPath === undefined) return failure([errorDiagnostic('workspace.entry.missing',
    `Entry is not declared: ${selector.packageName}:${selector.entryName}.`)]);
  const root: NodeRef = { kind: 'entry', packageName: selector.packageName,
    name: selector.entryName, path: entryPath };
  if (fileFor(rootPackage, root) === undefined) return failure([errorDiagnostic(
    'workspace.entry.source_missing', `Entry source is unavailable: ${entryPath}.`
  )]);
  const diagnostics: WorkspaceDiagnostic[] = [];
  const rootState = parseWorkspaceSource(indexes, root, cache, diagnostics, limits);
  if (rootState === undefined) return failure(diagnostics);
  if (rootState.unit.id !== selector.entryName) return failure([errorDiagnostic(
    'workspace.entry.identity',
    `Manifest entry ${selector.entryName} does not match the root asset unit ${rootState.unit.id}.`
  )]);
  const importEdges: WorkspaceGraphEdge[] = [];
  const nodes: WorkspaceGraphNode[] = [];
  const visited = new Map<string, WorkspaceGraphNode>();
  const visiting = new Set<string>();
  const visit = (
    ref: NodeRef,
    chain: readonly string[],
    depth: number,
    offendingSource?: SourceRef
  ): boolean => {
    const key = sourceKey(ref);
    if (visited.has(key)) return true;
    if (depth > limits.maxImportDepth) {
      addDiagnostic(diagnostics, limits, errorDiagnostic('workspace.budget.import_depth',
        `Import depth exceeds ${limits.maxImportDepth}.`, offendingSource,
        [...chain, qualified(ref.packageName, ref.path)]));
      return false;
    }
    if (visiting.has(key)) {
      addDiagnostic(diagnostics, limits, errorDiagnostic('workspace.import.cycle',
        `Import cycle detected: ${[...chain, qualified(ref.packageName, ref.path)].join(' -> ')}.`,
        offendingSource, [...chain, qualified(ref.packageName, ref.path)]));
      return false;
    }
    const pkg = packageFor(indexes, ref);
    const source = pkg === undefined ? undefined : fileFor(pkg, ref);
    if (pkg === undefined || source === undefined) {
      addDiagnostic(diagnostics, limits, errorDiagnostic('workspace.import.source_missing',
        `Imported source is unavailable: ${qualified(ref.packageName, ref.path)}.`));
      return false;
    }
    const state = parseWorkspaceSource(indexes, ref, cache, diagnostics, limits);
    if (state === undefined) return false;
    visiting.add(key);
    const localEdges: WorkspaceGraphEdge[] = [];
    const records = [...state.imports].sort((a, b) =>
      compareText(a.specifier, b.specifier) || a.source.start.offset - b.source.start.offset);
    const aliases = new Set<string>();
    for (const record of records) {
      if (importEdges.length >= limits.maxImportEdges) {
        addDiagnostic(diagnostics, limits, errorDiagnostic('workspace.budget.import_edges',
          `Workspace import edges exceed ${limits.maxImportEdges}.`, record.source));
        visiting.delete(key);
        return false;
      }
      if (record.alias === null || aliases.has(record.alias)) {
        addDiagnostic(diagnostics, limits, errorDiagnostic(
          'workspace.import.duplicate_alias',
          `Import alias is declared more than once in ${qualified(ref.packageName, ref.path)}.`,
          record.source
        ));
        visiting.delete(key);
        return false;
      }
      aliases.add(record.alias);
      const target = resolveImport(ref, pkg, record, indexes);
      if ('severity' in target) {
        addDiagnostic(diagnostics, limits, target);
        visiting.delete(key);
        return false;
      }
      const edge: WorkspaceGraphEdge = Object.freeze({
        from: qualified(ref.packageName, ref.path),
        to: qualified(target.packageName, target.path),
        packageName: target.packageName,
        specifier: record.specifier,
        alias: record.alias,
        source: record.source
      });
      localEdges.push(edge);
      importEdges.push(edge);
      if (!visit(target, [...chain, qualified(ref.packageName, ref.path)], depth + 1,
        record.source)) {
        visiting.delete(key);
        return false;
      }
    }
    const interfaceHash = ref.kind === 'entry' ? null : computeModuleInterfaceHash(
      ref.packageName,
      ref.name,
      state.abi,
      localEdges.map((edge) => visited.get(keyFor(edge.packageName,
        edge.to.slice(edge.packageName.length + 1)))?.interfaceHash)
        .filter((hash): hash is Sha256Digest => hash !== null && hash !== undefined)
    );
    const node: WorkspaceGraphNode = Object.freeze({
      kind: ref.kind, packageName: ref.packageName, name: ref.name, path: ref.path,
      contentHash: computeSourceContentHash(source.source),
      interfaceHash,
      imports: Object.freeze(localEdges)
    });
    visiting.delete(key);
    visited.set(key, node);
    nodes.push(node);
    return true;
  };
  if (!visit(root, [], 0) || diagnostics.length > 0) return failure(diagnostics);

  const lockByName = new Map(workspace.lock.packages.map((pkg) => [pkg.name, pkg]));
  const closureHash = sha256Digest(canonicalJsonString(closureProjection(
    root, nodes, importEdges, lockByName
  ))) as Sha256Digest;
  const buildKey = sha256Digest(canonicalJsonString({
    format: 'ashfox-build-key', version: 1, grammar: ASHFOX_MODEL_GRAMMAR,
    compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT, closureHash
  })) as Sha256Digest;
  const build = Object.freeze({
    packageName: selector.packageName, entryName: selector.entryName, entryPath,
    closureHash, buildKey, compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
    nodes: Object.freeze(nodes), edges: Object.freeze(importEdges)
  });
  try {
    const closure = createWorkspaceCompilationClosure(
      root, build, cache.states, indexes
    );
    return { ok: true, value: Object.freeze({ build, closure }) };
  } catch (error) {
    return failure([errorDiagnostic('workspace.closure.invalid', error instanceof Error
      ? error.message : 'Selected workspace closure is invalid.')]);
  }
};

export const resolveWorkspaceEntryCompilation = (
  input: AuthoredAssetWorkspace,
  selector: WorkspaceEntrySelector,
  options: ResolveWorkspaceEntryOptions = {}
): WorkspaceReadResult<WorkspaceEntryCompilation> => {
  const prepared = prepareCompilationSnapshot(input, options);
  if (!prepared.ok) return prepared;
  return resolveWorkspaceEntryCompilationFromSnapshot(prepared.value, selector);
};

/** Public projection that intentionally omits the semantic closure. */
export const resolveWorkspaceEntry = (
  input: AuthoredAssetWorkspace,
  selector: WorkspaceEntrySelector,
  options: ResolveWorkspaceEntryOptions = {}
): WorkspaceReadResult<WorkspaceEntryBuild> => {
  const resolved = resolveWorkspaceEntryCompilation(input, selector, options);
  if (!resolved.ok) return resolved;
  return { ok: true, value: resolved.value.build };
};

export const computeWorkspaceEntryBuild = resolveWorkspaceEntry;

export const validateCompilationSnapshot = (
  snapshot: WorkspaceCompilationSnapshot
): readonly WorkspaceDiagnostic[] => {
  const { limits, indexes, cache } = snapshot;
  const limit = limits.maxDiagnostics;
  const diagnostics: WorkspaceDiagnostic[] = [];
  if (parseWorkspaceSources(indexes, diagnostics, limits, cache) === undefined) {
    return Object.freeze(sortWorkspaceDiagnostics(diagnostics.slice(0, limit)));
  }
  validateDeclaredModuleImports(indexes, cache, diagnostics, limits);
  if (diagnostics.length >= limit) {
    return Object.freeze(sortWorkspaceDiagnostics(diagnostics.slice(0, limit)));
  }
  const abis = interfaceHashesByPackage(cache.states, indexes);
  for (const pkg of indexes.values()) {
    const expected = computePackageInterfaceHash({
      name: pkg.view.name, root: pkg.view.root, manifest: pkg.view.manifest
    }, abis.get(pkg.view.name) ?? []);
    if (pkg.lock.interfaceHash !== expected && !addDiagnostic(diagnostics, limits,
      errorDiagnostic('workspace.lock.stale_interface',
        `Exported ABI digest for ${pkg.view.name} is stale or not compiler-derived.`))) {
      return Object.freeze(sortWorkspaceDiagnostics(diagnostics.slice(0, limit)));
    }
  }
  const emitted = new Set(diagnostics.map(diagnosticKey));
  for (const pkg of indexes.values()) {
    for (const entry of pkg.view.manifest.entries) {
      const result = resolveWorkspaceEntryCompilationFromSnapshot(snapshot,
        { packageName: pkg.view.name, entryName: entry.name });
      if (!result.ok) {
        for (const diagnostic of result.diagnostics) {
          const key = diagnosticKey(diagnostic);
          if (emitted.has(key)) continue;
          emitted.add(key);
          if (!addDiagnostic(diagnostics, limits, diagnostic)) {
            return Object.freeze(sortWorkspaceDiagnostics(diagnostics.slice(0, limit)));
          }
        }
      }
      if (diagnostics.length >= limit) return Object.freeze(sortWorkspaceDiagnostics(
        diagnostics.slice(0, limit)
      ));
    }
  }
  return Object.freeze(sortWorkspaceDiagnostics(diagnostics));
};

export const validateWorkspaceEntries = (
  workspace: AuthoredAssetWorkspace,
  options: ResolveWorkspaceEntryOptions = {}
): readonly WorkspaceDiagnostic[] => {
  const prepared = prepareCompilationSnapshot(workspace, options);
  return prepared.ok ? validateCompilationSnapshot(prepared.value) : prepared.diagnostics;
};
