import { compareText } from '@ashfox/internal-contracts';
import type { AssetSourceUnit } from '../program/asset/contract';

import type { Sha256Digest, WorkspaceFile } from './contract';
import type { SourceRef } from './diagnostic';
import { canonicalJsonString } from '../../canonicalJson';
import { sha256Digest } from '../../provenance/digest';
import { keyFor, qualified, sourceKey, type ParsedState } from './graphSource';
import type {
  NodeRef,
  PackageIndex,
  WorkspaceEntryBuild,
  WorkspaceGraphEdge,
  WorkspaceGraphNode,
} from './graph/contract';

/** Identity used by the compiler for one package-qualified source unit. */
export interface WorkspaceSourceIdentity {
  readonly key: string;
  readonly packageName: string;
  /** Stable package instance identity; workspace manifests, CAS exact digests. */
  readonly packageInstanceKey: Sha256Digest;
  /** Full normalized workspace logical path, never package-local. */
  readonly path: string;
  /** Source-unit name; it is metadata, not part of the source key. */
  readonly unitName: string;
}

export interface WorkspaceCompilationFile {
  readonly identity: WorkspaceSourceIdentity;
  readonly source: string;
  /** The one parser snapshot consumed by later semantic compilation. */
  readonly unit: AssetSourceUnit;
  /** Exported declaration names, sorted and independent of import aliases. */
  readonly exportedNames: readonly string[];
}

export interface WorkspaceCompilationImportEdge {
  /** Importer identity plus alias; aliases are edge keys, not symbol identity. */
  readonly key: string;
  readonly importer: WorkspaceSourceIdentity;
  readonly alias: string;
  readonly target: WorkspaceSourceIdentity;
  readonly specifier: string;
  readonly source: SourceRef;
}

export interface WorkspaceSelectedEntryBuildIdentity {
  readonly packageName: string;
  readonly entryName: string;
  readonly path: string;
  readonly closureHash: Sha256Digest;
  readonly buildKey: Sha256Digest;
  readonly compilerFingerprint: string;
}

/**
 * Internal immutable input boundary for selected-entry semantic compilation.
 * It contains only reachable files and parser snapshots; products and caches
 * remain outside the workspace source authority.
 */
export interface WorkspaceCompilationClosure {
  readonly root: WorkspaceCompilationFile;
  readonly files: readonly WorkspaceCompilationFile[];
  readonly imports: readonly WorkspaceCompilationImportEdge[];
  readonly build: WorkspaceSelectedEntryBuildIdentity;
}

const sourceUnitName = (state: ParsedState): string => state.unit.id;

const exportedNames = (state: ParsedState): readonly string[] =>
  Object.freeze(
    state.unit.declarations
      .filter((declaration) => declaration.exported)
      .map((declaration) => declaration.id)
      .sort(compareText),
  );

const packageInstanceKey = (pkg: PackageIndex): Sha256Digest => {
  if (pkg.lock.source === 'cas' && pkg.lock.digest !== null) {
    return pkg.lock.digest;
  }
  return sha256Digest(
    canonicalJsonString({
      format: 'ashfox-workspace-package-instance',
      version: 1,
      name: pkg.view.name,
    }),
  ) as Sha256Digest;
};

const nodeByQualified = (
  nodes: readonly WorkspaceGraphNode[],
): ReadonlyMap<string, WorkspaceGraphNode> =>
  new Map(nodes.map((node) => [qualified(node.packageName, node.path), node]));

const sourceForNode = (
  node: WorkspaceGraphNode,
  states: ReadonlyMap<string, ParsedState>,
  indexes: ReadonlyMap<string, PackageIndex>,
): WorkspaceCompilationFile => {
  const pkg = indexes.get(node.packageName);
  const state = states.get(keyFor(node.packageName, node.path));
  const source: WorkspaceFile | undefined = pkg?.filesByPath.get(node.path);
  if (pkg === undefined || state === undefined || source === undefined) {
    throw new TypeError(
      `Workspace closure source is unavailable: ${qualified(node.packageName, node.path)}.`,
    );
  }
  const unitName = sourceUnitName(state);
  const instanceKey = packageInstanceKey(pkg);
  const identityKey = [node.packageName, instanceKey, node.path].join('\u0000');
  const identity: WorkspaceSourceIdentity = Object.freeze({
    key: identityKey,
    packageName: node.packageName,
    packageInstanceKey: instanceKey,
    path: node.path,
    unitName,
  });
  return Object.freeze({
    identity,
    source: source.source,
    unit: state.unit,
    exportedNames: exportedNames(state),
  });
};

const buildIdentity = (build: WorkspaceEntryBuild): WorkspaceSelectedEntryBuildIdentity =>
  Object.freeze({
    packageName: build.packageName,
    entryName: build.entryName,
    path: build.entryPath,
    closureHash: build.closureHash,
    buildKey: build.buildKey,
    compilerFingerprint: build.compilerFingerprint,
  });

/** Builds closure records from the already resolved graph and parsed states. */
export const createWorkspaceCompilationClosure = (
  root: NodeRef,
  build: WorkspaceEntryBuild,
  states: ReadonlyMap<string, ParsedState>,
  indexes: ReadonlyMap<string, PackageIndex>,
): WorkspaceCompilationClosure => {
  const nodes = [...build.nodes];
  const nodeMap = nodeByQualified(nodes);
  const files = Object.freeze(nodes.map((node) => sourceForNode(node, states, indexes)));
  const filesByQualified = new Map(
    files.map((file) => [qualified(file.identity.packageName, file.identity.path), file]),
  );
  const rootFile = filesByQualified.get(qualified(root.packageName, root.path));
  if (rootFile === undefined || root.kind !== 'entry') {
    throw new TypeError('Workspace closure root is not the selected entry source.');
  }
  const edgeKeys = new Set<string>();
  const imports = Object.freeze(
    build.edges.map((edge: WorkspaceGraphEdge) => {
      const importer = filesByQualified.get(edge.from);
      const target = filesByQualified.get(edge.to);
      if (importer === undefined || target === undefined || edge.alias === null) {
        throw new TypeError('Workspace closure contains an unresolved import edge.');
      }
      const key = `${importer.identity.key}\u0000${edge.alias}`;
      if (edgeKeys.has(key)) {
        throw new TypeError(`Workspace closure repeats import edge key: ${key}.`);
      }
      edgeKeys.add(key);
      return Object.freeze({
        key,
        importer: importer.identity,
        alias: edge.alias,
        target: target.identity,
        specifier: edge.specifier,
        source: edge.source,
      });
    }),
  );
  // Retain the explicit root ref in the construction path so an accidentally
  // mismatched graph node cannot silently become the semantic root.
  if (sourceKey(root) !== keyFor(rootFile.identity.packageName, rootFile.identity.path)) {
    throw new TypeError('Workspace closure root identity does not match the graph root.');
  }
  // Every edge endpoint must be one of the reachable graph nodes. The map is
  // intentionally local; no mutable resolver or caller-supplied index escapes.
  for (const edge of build.edges) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) {
      throw new TypeError('Workspace closure edge endpoint is outside the selected graph.');
    }
  }
  return Object.freeze({
    root: rootFile,
    files,
    imports,
    build: buildIdentity(build),
  });
};
