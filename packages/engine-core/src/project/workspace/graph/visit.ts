import { compareText } from '../../../stableOrder';
import { canonicalJsonString } from '../../../canonicalJson';
import { sha256Digest } from '../../../provenance/digest';

import {
  ASHFOX_MODEL_GRAMMAR,
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  type AuthoredAssetWorkspace,
  type LockedPackage,
  type Sha256Digest,
  type WorkspaceFile,
  type WorkspaceParsedImport,
} from '../contract';
import {
  errorDiagnostic,
  errorMessage,
  type SourceRef,
  type WorkspaceDiagnostic,
  type WorkspaceReadResult,
} from '../diagnostic';
import { computeModuleInterfaceHash, computeSourceContentHash } from '../hash';
import {
  addDiagnostic,
  keyFor,
  parseWorkspaceSource,
  qualified,
  sourceKey,
  type WorkspaceSourceParseCache,
} from '../graphSource';
import { resolveImport } from './resolve';
import { createWorkspaceCompilationClosure, type WorkspaceCompilationClosure } from '../closure';
import type {
  NodeRef,
  PackageIndex,
  WorkspaceEntryBuild,
  WorkspaceEntrySelector,
  WorkspaceGraphEdge,
  WorkspaceGraphNode,
} from './contract';
import type { WorkspaceLimits } from '../limits';

export interface WorkspaceCompilationSnapshot {
  readonly workspace: AuthoredAssetWorkspace;
  readonly limits: WorkspaceLimits;
  readonly indexes: ReadonlyMap<string, PackageIndex>;
  readonly cache: WorkspaceSourceParseCache;
}

/** Internal graph result consumed by the semantic compiler boundary. */
export interface WorkspaceEntryCompilation {
  readonly build: WorkspaceEntryBuild;
  readonly closure: WorkspaceCompilationClosure;
}

export interface EntryGraphContext {
  readonly snapshot: WorkspaceCompilationSnapshot;
  readonly diagnostics: WorkspaceDiagnostic[];
  readonly importEdges: WorkspaceGraphEdge[];
  readonly nodes: WorkspaceGraphNode[];
  readonly visited: Map<string, WorkspaceGraphNode>;
  readonly visiting: Set<string>;
}

const packageFor = (
  indexes: ReadonlyMap<string, PackageIndex>,
  ref: NodeRef,
): PackageIndex | undefined => indexes.get(ref.packageName);

const fileFor = (pkg: PackageIndex, ref: NodeRef): WorkspaceFile | undefined =>
  pkg.filesByPath.get(ref.path);

const closureProjection = (
  entry: NodeRef,
  nodes: readonly WorkspaceGraphNode[],
  edges: readonly WorkspaceGraphEdge[],
  lockByName: ReadonlyMap<string, LockedPackage>,
): unknown => ({
  format: 'ashfox-entry-closure',
  version: 1,
  entry: {
    packageName: entry.packageName,
    name: entry.name,
    path: entry.path,
    contentHash: nodes.find(
      (node) => node.packageName === entry.packageName && node.path === entry.path,
    )?.contentHash,
  },
  nodes: [...nodes]
    .sort((a, b) => compareText(a.packageName, b.packageName) || compareText(a.path, b.path))
    .map((node) => ({
      kind: node.kind,
      packageName: node.packageName,
      name: node.name,
      path: node.path,
      contentHash: node.contentHash,
      interfaceHash: node.interfaceHash,
    })),
  edges: [...edges]
    .sort(
      (a, b) =>
        compareText(a.from, b.from) ||
        compareText(a.to, b.to) ||
        compareText(a.specifier, b.specifier),
    )
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      packageName: edge.packageName,
      specifier: edge.specifier,
      alias: edge.alias,
    })),
  // Aggregate package hashes are intentionally absent: changing an unrelated
  // entry must not change this selected entry's transitive closure identity.
  packages: [...new Set(nodes.map((node) => node.packageName))].sort(compareText).map((name) => {
    const lock = lockByName.get(name);
    return lock === undefined ? { name } : { name, source: lock.source, digest: lock.digest };
  }),
});

const visitEntryEdge = (
  context: EntryGraphContext,
  ref: NodeRef,
  pkg: PackageIndex,
  record: WorkspaceParsedImport,
  aliases: Set<string>,
  chain: readonly string[],
  depth: number,
  localEdges: WorkspaceGraphEdge[],
): boolean => {
  const { diagnostics, importEdges, snapshot } = context;
  const { limits, indexes } = snapshot;
  if (importEdges.length >= limits.maxImportEdges) {
    addDiagnostic(
      diagnostics,
      limits,
      errorDiagnostic(
        'workspace.budget.import_edges',
        `Workspace import edges exceed ${limits.maxImportEdges}.`,
        record.source,
      ),
    );
    return false;
  }
  if (record.alias === null || aliases.has(record.alias)) {
    addDiagnostic(
      diagnostics,
      limits,
      errorDiagnostic(
        'workspace.import.duplicate_alias',
        `Import alias is declared more than once in ${qualified(ref.packageName, ref.path)}.`,
        record.source,
      ),
    );
    return false;
  }
  aliases.add(record.alias);
  const target = resolveImport(ref, pkg, record, indexes);
  if ('severity' in target) {
    addDiagnostic(diagnostics, limits, target);
    return false;
  }
  const edge: WorkspaceGraphEdge = Object.freeze({
    from: qualified(ref.packageName, ref.path),
    to: qualified(target.packageName, target.path),
    packageName: target.packageName,
    specifier: record.specifier,
    alias: record.alias,
    source: record.source,
  });
  localEdges.push(edge);
  importEdges.push(edge);
  return visitEntryNode(
    context,
    target,
    [...chain, qualified(ref.packageName, ref.path)],
    depth + 1,
    record.source,
  );
};

const checkNodeTraversalLimits = (
  context: EntryGraphContext,
  ref: NodeRef,
  key: string,
  chain: readonly string[],
  depth: number,
  offendingSource?: SourceRef,
): boolean => {
  const { diagnostics, visiting, snapshot } = context;
  const { limits } = snapshot;
  if (depth > limits.maxImportDepth) {
    addDiagnostic(
      diagnostics,
      limits,
      errorDiagnostic(
        'workspace.budget.import_depth',
        `Import depth exceeds ${limits.maxImportDepth}.`,
        offendingSource,
        [...chain, qualified(ref.packageName, ref.path)],
      ),
    );
    return false;
  }
  if (visiting.has(key)) {
    const cycle = [...chain, qualified(ref.packageName, ref.path)];
    addDiagnostic(
      diagnostics,
      limits,
      errorDiagnostic(
        'workspace.import.cycle',
        `Import cycle detected: ${cycle.join(' -> ')}.`,
        offendingSource,
        cycle,
      ),
    );
    return false;
  }
  return true;
};

const buildVisitedNode = (
  ref: NodeRef,
  source: WorkspaceFile,
  abi: ReturnType<typeof parseWorkspaceSource> extends infer T
    ? T extends { readonly abi: infer A }
      ? A
      : never
    : never,
  localEdges: readonly WorkspaceGraphEdge[],
  visited: ReadonlyMap<string, WorkspaceGraphNode>,
): WorkspaceGraphNode => {
  const depHashes = localEdges
    .map(
      (edge) =>
        visited.get(keyFor(edge.packageName, edge.to.slice(edge.packageName.length + 1)))
          ?.interfaceHash,
    )
    .filter((hash): hash is Sha256Digest => hash !== null && hash !== undefined);
  const interfaceHash =
    ref.kind === 'entry'
      ? null
      : computeModuleInterfaceHash(ref.packageName, ref.name, abi, depHashes);
  return Object.freeze({
    kind: ref.kind,
    packageName: ref.packageName,
    name: ref.name,
    path: ref.path,
    contentHash: computeSourceContentHash(source.source),
    interfaceHash,
    imports: Object.freeze(localEdges),
  });
};

/** Traverses and validates one entry closure graph in deterministic import order. */
export const visitEntryNode = (
  context: EntryGraphContext,
  ref: NodeRef,
  chain: readonly string[],
  depth: number,
  offendingSource?: SourceRef,
): boolean => {
  const key = sourceKey(ref);
  if (context.visited.has(key)) return true;
  if (!checkNodeTraversalLimits(context, ref, key, chain, depth, offendingSource)) return false;
  const { diagnostics, nodes, visited, visiting, snapshot } = context;
  const { limits, indexes, cache } = snapshot;
  const pkg = packageFor(indexes, ref);
  const source = pkg === undefined ? undefined : fileFor(pkg, ref);
  if (pkg === undefined || source === undefined) {
    addDiagnostic(
      diagnostics,
      limits,
      errorDiagnostic(
        'workspace.import.source_missing',
        `Imported source is unavailable: ${qualified(ref.packageName, ref.path)}.`,
      ),
    );
    return false;
  }
  const state = parseWorkspaceSource(indexes, ref, cache, diagnostics, limits);
  if (state === undefined) return false;
  visiting.add(key);
  const localEdges: WorkspaceGraphEdge[] = [];
  const records = [...state.imports].sort(
    (a, b) =>
      compareText(a.specifier, b.specifier) || a.source.start.offset - b.source.start.offset,
  );
  const aliases = new Set<string>();
  for (const record of records) {
    if (!visitEntryEdge(context, ref, pkg, record, aliases, chain, depth, localEdges)) {
      visiting.delete(key);
      return false;
    }
  }
  const node = buildVisitedNode(ref, source, state.abi, localEdges, visited);
  visiting.delete(key);
  visited.set(key, node);
  nodes.push(node);
  return true;
};

/** Seals closure hash, build key, and semantic compilation closure for a traversed entry. */
export const finalizeEntryCompilation = (
  snapshot: WorkspaceCompilationSnapshot,
  selector: WorkspaceEntrySelector,
  root: NodeRef,
  entryPath: string,
  nodes: readonly WorkspaceGraphNode[],
  importEdges: readonly WorkspaceGraphEdge[],
): WorkspaceReadResult<WorkspaceEntryCompilation> => {
  const lockByName = new Map(snapshot.workspace.lock.packages.map((pkg) => [pkg.name, pkg]));
  const closureHash = sha256Digest(
    canonicalJsonString(closureProjection(root, nodes, importEdges, lockByName)),
  ) as Sha256Digest;
  const buildKey = sha256Digest(
    canonicalJsonString({
      format: 'ashfox-build-key',
      version: 1,
      grammar: ASHFOX_MODEL_GRAMMAR,
      compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
      closureHash,
    }),
  ) as Sha256Digest;
  const build = Object.freeze({
    packageName: selector.packageName,
    entryName: selector.entryName,
    entryPath,
    closureHash,
    buildKey,
    compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(importEdges),
  });
  try {
    const closure = createWorkspaceCompilationClosure(
      root,
      build,
      snapshot.cache.states,
      snapshot.indexes,
    );
    return { ok: true, value: Object.freeze({ build, closure }) };
  } catch (error) {
    return {
      ok: false,
      diagnostics: Object.freeze([
        errorDiagnostic(
          'workspace.closure.invalid',
          errorMessage(error, 'Selected workspace closure is invalid.'),
        ),
      ]),
    };
  }
};
