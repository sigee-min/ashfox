import { compareText } from '../../stableOrder';
import { canonicalJsonString } from '../../canonicalJson';
import { parseAssetSource } from '../program/asset/parse';
import type {
  AssetDeclaration,
  AssetImportDecl,
  AssetSourceParseResult,
  AssetSourceUnit,
} from '../program/asset/contract';

import {
  type AuthoredAssetWorkspace,
  type WorkspaceAbiExport,
  type WorkspaceModuleAbi,
  type WorkspaceParsedImport,
} from './contract';
import { errorDiagnostic, type SourceRef, type WorkspaceDiagnostic } from './diagnostic';
import type { NodeRef, PackageIndex } from './graph/contract';
import { resolveImport } from './graph/resolve';
import { type WorkspaceLimits } from './limits';
import { type WorkspacePackageView } from './validation';

export interface ParsedState {
  readonly unit: AssetSourceUnit;
  readonly imports: readonly WorkspaceParsedImport[];
  readonly abi: WorkspaceModuleAbi | undefined;
}

/** Memoized parser boundary shared by selected and whole-workspace passes. */
export interface WorkspaceSourceParseCache {
  readonly attempted: Set<string>;
  readonly states: Map<string, ParsedState>;
}

interface ImportValidationState {
  readonly indexes: ReadonlyMap<string, PackageIndex>;
  readonly cache: WorkspaceSourceParseCache;
  readonly diagnostics: WorkspaceDiagnostic[];
  readonly limits: WorkspaceLimits;
  readonly visited: Set<string>;
  readonly visiting: Set<string>;
  edgeCount: number;
}

export const createWorkspaceSourceParseCache = (): WorkspaceSourceParseCache => ({
  attempted: new Set<string>(),
  states: new Map<string, ParsedState>(),
});

export const keyFor = (packageName: string, path: string): string => `${packageName}\u0000${path}`;
export const qualified = (packageName: string, path: string): string => `${packageName}:${path}`;
export const sourceKey = (ref: NodeRef): string => keyFor(ref.packageName, ref.path);

const sourceRefFor = (packageName: string, path: string, ref: SourceRef): SourceRef =>
  Object.freeze({ packageName, path, start: ref.start, end: ref.end });

export const addDiagnostic = (
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits,
  diagnostic: WorkspaceDiagnostic,
): boolean => {
  if (diagnostics.length >= limits.maxDiagnostics) return false;
  diagnostics.push(diagnostic);
  return true;
};

export const sourcePath = (pkg: WorkspacePackageView, relative: string): string =>
  pkg.root.length === 0 ? relative : `${pkg.root}/${relative}`;

/** Builds fast per-package lookup indexes for workspace graph resolution. */
export const makeIndexes = (
  workspace: AuthoredAssetWorkspace,
): ReadonlyMap<string, PackageIndex> => {
  const filesByPath = new Map(workspace.files.map((file) => [file.path, file]));
  const lockByName = new Map(workspace.lock.packages.map((pkg) => [pkg.name, pkg]));
  const packages: WorkspacePackageView[] = workspace.manifest.packages.map((pkg) => ({
    name: pkg.name,
    root: pkg.root,
    manifest: pkg.manifest,
    source: 'workspace',
  }));
  for (const locked of workspace.lock.packages) {
    if (locked.source === 'cas' && !packages.some((pkg) => pkg.name === locked.name)) {
      packages.push({
        name: locked.name,
        root: locked.root,
        manifest: locked.manifest,
        source: 'cas',
      });
    }
  }
  const indexes = new Map<string, PackageIndex>();
  for (const pkg of packages) {
    const lock = lockByName.get(pkg.name);
    if (lock === undefined) continue;
    const entries = pkg.manifest.entries.map(
      (entry) => [entry.name, sourcePath(pkg, entry.path)] as const,
    );
    const modules = pkg.manifest.modules.map((module) => ({
      subpath: module.subpath,
      path: sourcePath(pkg, module.path),
    }));
    indexes.set(pkg.name, {
      view: pkg,
      lock,
      filesByPath,
      entriesByName: new Map(entries),
      modulesByPath: new Map(modules.map((module) => [module.path, module])),
      modulesBySubpath: new Map(modules.map((module) => [module.subpath, module])),
    });
  }
  return indexes;
};

const semanticValue = (value: unknown, seen = new Set<object>()): unknown => {
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (Array.isArray(value)) return value.map((item) => semanticValue(item, seen));
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[cycle]';
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareText)) {
    if (key === 'span' || key === 'ref' || key === 'path' || key === 'source') continue;
    result[key] = semanticValue((value as Record<string, unknown>)[key], seen);
  }
  seen.delete(value);
  return result;
};

const declarationAbi = (declaration: AssetDeclaration): WorkspaceAbiExport => ({
  name: declaration.id,
  signature: canonicalJsonString(semanticValue(declaration)),
});

const convertParserDiagnostic = (
  packageName: string,
  path: string,
  diagnostic: AssetSourceParseResult['diagnostics'][number],
): WorkspaceDiagnostic =>
  errorDiagnostic(
    `workspace.source.${diagnostic.code.replace(/^asset\./u, '')}`,
    diagnostic.message,
    sourceRefFor(packageName, path, {
      packageName,
      path,
      start: diagnostic.span.start,
      end: diagnostic.span.end,
    }),
    undefined,
    diagnostic.hint,
  );

const parseSource = (
  packageName: string,
  path: string,
  expectedKind: AssetSourceUnit['kind'],
  source: string,
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits,
): ParsedState | undefined => {
  const parsed = parseAssetSource(source, path);
  for (const diagnostic of parsed.diagnostics) {
    if (
      !addDiagnostic(diagnostics, limits, convertParserDiagnostic(packageName, path, diagnostic))
    ) {
      return undefined;
    }
  }
  if (parsed.unit === null) return undefined;
  if (parsed.unit.kind !== expectedKind) {
    addDiagnostic(
      diagnostics,
      limits,
      errorDiagnostic(
        'workspace.source.unit_kind',
        `Source ${path} must declare a ${expectedKind} unit.`,
        sourceRefFor(packageName, path, {
          packageName,
          path,
          start: parsed.unit.span.start,
          end: parsed.unit.span.end,
        }),
      ),
    );
    return undefined;
  }
  const imports: WorkspaceParsedImport[] = parsed.unit.imports.map((item: AssetImportDecl) => ({
    packageName,
    path,
    specifier: item.path,
    alias: item.alias,
    source: sourceRefFor(packageName, path, {
      packageName,
      path,
      start: item.ref.span.start,
      end: item.ref.span.end,
    }),
  }));
  const abi =
    expectedKind === 'module'
      ? {
          packageName,
          subpath: '',
          exports: Object.freeze(
            parsed.unit.declarations
              .filter((declaration) => declaration.exported)
              .map(declarationAbi),
          ),
        }
      : undefined;
  return { unit: parsed.unit, imports: Object.freeze(imports), abi };
};

export const parseWorkspaceSource = (
  indexes: ReadonlyMap<string, PackageIndex>,
  ref: NodeRef,
  cache: WorkspaceSourceParseCache,
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits,
): ParsedState | undefined => {
  const key = sourceKey(ref);
  if (cache.attempted.has(key)) return cache.states.get(key);
  cache.attempted.add(key);
  const pkg = indexes.get(ref.packageName);
  const source = pkg?.filesByPath.get(ref.path);
  if (pkg === undefined || source === undefined) return undefined;
  const parsed = parseSource(
    pkg.view.name,
    ref.path,
    ref.kind === 'entry' ? 'asset' : 'module',
    source.source,
    diagnostics,
    limits,
  );
  if (parsed !== undefined) cache.states.set(key, parsed);
  return parsed;
};

export const parseWorkspaceSources = (
  indexes: ReadonlyMap<string, PackageIndex>,
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits,
  cache: WorkspaceSourceParseCache = createWorkspaceSourceParseCache(),
): ReadonlyMap<string, ParsedState> | undefined => {
  for (const pkg of indexes.values()) {
    const declarations = [
      ...pkg.view.manifest.entries.map((entry) => ({
        kind: 'entry' as const,
        name: entry.name,
        path: sourcePath(pkg.view, entry.path),
      })),
      ...pkg.view.manifest.modules.map((module) => ({
        kind: 'module' as const,
        name: module.subpath,
        path: sourcePath(pkg.view, module.path),
      })),
    ];
    for (const declaration of declarations) {
      parseWorkspaceSource(
        indexes,
        {
          kind: declaration.kind,
          name: declaration.name,
          packageName: pkg.view.name,
          path: declaration.path,
        },
        cache,
        diagnostics,
        limits,
      );
      if (diagnostics.length >= limits.maxDiagnostics) return undefined;
    }
  }
  return cache.states;
};

const walkModuleEdge = (
  state: ImportValidationState,
  ref: NodeRef,
  pkg: PackageIndex,
  record: WorkspaceParsedImport,
  aliases: Set<string>,
  chain: readonly string[],
  depth: number,
): boolean => {
  const { diagnostics, limits, indexes } = state;
  if (state.edgeCount >= limits.maxImportEdges) {
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
  state.edgeCount += 1;
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
  return walkModuleImports(
    state,
    target,
    [...chain, qualified(ref.packageName, ref.path)],
    depth + 1,
    record.source,
  );
};

const checkModuleLimits = (
  state: ImportValidationState,
  ref: NodeRef,
  key: string,
  chain: readonly string[],
  depth: number,
  offendingSource?: SourceRef,
): boolean => {
  const { diagnostics, limits, visiting } = state;
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

const walkModuleImports = (
  state: ImportValidationState,
  ref: NodeRef,
  chain: readonly string[],
  depth: number,
  offendingSource?: SourceRef,
): boolean => {
  const key = sourceKey(ref);
  if (state.visited.has(key)) return true;
  if (!checkModuleLimits(state, ref, key, chain, depth, offendingSource)) return false;
  const { diagnostics, limits, indexes, cache, visited, visiting } = state;
  const pkg = indexes.get(ref.packageName);
  const source = pkg?.filesByPath.get(ref.path);
  const parsed = cache.states.get(key);
  if (pkg === undefined || source === undefined) {
    addDiagnostic(
      diagnostics,
      limits,
      errorDiagnostic(
        'workspace.import.source_missing',
        `Imported source is unavailable: ${qualified(ref.packageName, ref.path)}.`,
      ),
    );
    visited.add(key);
    return false;
  }
  if (parsed === undefined) {
    visited.add(key);
    return false;
  }
  visiting.add(key);
  let valid = true;
  const aliases = new Set<string>();
  const records = [...parsed.imports].sort(
    (a, b) =>
      compareText(a.specifier, b.specifier) || a.source.start.offset - b.source.start.offset,
  );
  for (const record of records) {
    if (!walkModuleEdge(state, ref, pkg, record, aliases, chain, depth)) {
      valid = false;
      break;
    }
  }
  visiting.delete(key);
  visited.add(key);
  return valid;
};

/** Resolves imports for all declared modules during whole-workspace validation. */
export const validateDeclaredModuleImports = (
  indexes: ReadonlyMap<string, PackageIndex>,
  cache: WorkspaceSourceParseCache,
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits,
): void => {
  const state: ImportValidationState = {
    indexes,
    cache,
    diagnostics,
    limits,
    visited: new Set<string>(),
    visiting: new Set<string>(),
    edgeCount: 0,
  };
  const refs: NodeRef[] = [];
  for (const pkg of indexes.values()) {
    for (const module of pkg.view.manifest.modules) {
      refs.push({
        kind: 'module',
        packageName: pkg.view.name,
        name: module.subpath,
        path: sourcePath(pkg.view, module.path),
      });
    }
  }
  refs.sort(
    (left, right) =>
      compareText(left.packageName, right.packageName) || compareText(left.path, right.path),
  );
  for (const ref of refs) {
    walkModuleImports(state, ref, [], 0);
    if (diagnostics.length >= limits.maxDiagnostics) return;
  }
};
