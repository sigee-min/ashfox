import { compareText } from '../../stableOrder';
import { canonicalJsonString } from '../../canonicalJson';
import { parseAssetSource } from '../program/asset/parse';
import type {
  AssetDeclaration,
  AssetImportDecl,
  AssetSourceParseResult,
  AssetSourceUnit
} from '../program/asset/contract';

import {
  type AuthoredAssetWorkspace,
  type LockedPackage,
  type WorkspaceAbiExport,
  type WorkspaceFile,
  type WorkspaceModuleAbi,
  type WorkspaceParsedImport
} from './contract';
import {
  errorDiagnostic,
  type SourceRef,
  type WorkspaceDiagnostic
} from './diagnostic';
import { type WorkspaceLimits } from './limits';
import { normalizeLogicalPath } from './path';
import { type WorkspacePackageView } from './validation';

export interface PackageIndex {
  readonly view: WorkspacePackageView;
  readonly lock: LockedPackage;
  readonly filesByPath: ReadonlyMap<string, WorkspaceFile>;
  readonly entriesByName: ReadonlyMap<string, string>;
  readonly modulesByPath: ReadonlyMap<string, { readonly subpath: string; readonly path: string }>;
  readonly modulesBySubpath: ReadonlyMap<string, { readonly subpath: string; readonly path: string }>;
}

export interface NodeRef {
  readonly kind: 'entry' | 'module';
  readonly packageName: string;
  readonly name: string;
  readonly path: string;
}

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

export const createWorkspaceSourceParseCache = (): WorkspaceSourceParseCache => ({
  attempted: new Set<string>(),
  states: new Map<string, ParsedState>()
});

export const keyFor = (packageName: string, path: string): string => `${packageName}\u0000${path}`;
export const qualified = (packageName: string, path: string): string => `${packageName}:${path}`;
export const sourceKey = (ref: NodeRef): string => keyFor(ref.packageName, ref.path);
const sourceRefFor = (packageName: string, path: string, ref: SourceRef): SourceRef =>
  Object.freeze({ packageName, path, start: ref.start, end: ref.end });

export const addDiagnostic = (
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits,
  diagnostic: WorkspaceDiagnostic
): boolean => {
  if (diagnostics.length >= limits.maxDiagnostics) return false;
  diagnostics.push(diagnostic);
  return true;
};

export const sourcePath = (pkg: WorkspacePackageView, relative: string): string =>
  pkg.root.length === 0 ? relative : `${pkg.root}/${relative}`;

export const makeIndexes = (
  workspace: AuthoredAssetWorkspace
): ReadonlyMap<string, PackageIndex> => {
  const filesByPath = new Map(workspace.files.map((file) => [file.path, file]));
  const lockByName = new Map(workspace.lock.packages.map((pkg) => [pkg.name, pkg]));
  const packages: WorkspacePackageView[] = workspace.manifest.packages.map((pkg) => ({
    name: pkg.name, root: pkg.root, manifest: pkg.manifest, source: 'workspace'
  }));
  for (const locked of workspace.lock.packages) {
    if (locked.source === 'cas' && !packages.some((pkg) => pkg.name === locked.name)) {
      packages.push({ name: locked.name, root: locked.root,
        manifest: locked.manifest, source: 'cas' });
    }
  }
  const indexes = new Map<string, PackageIndex>();
  for (const pkg of packages) {
    const lock = lockByName.get(pkg.name);
    if (lock === undefined) continue;
    const entries = pkg.manifest.entries.map((entry) => [entry.name,
      sourcePath(pkg, entry.path)] as const);
    const modules = pkg.manifest.modules.map((module) => ({
      subpath: module.subpath,
      path: sourcePath(pkg, module.path)
    }));
    indexes.set(pkg.name, {
      view: pkg, lock, filesByPath, entriesByName: new Map(entries),
      modulesByPath: new Map(modules.map((module) => [module.path, module])),
      modulesBySubpath: new Map(modules.map((module) => [module.subpath, module]))
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
  signature: canonicalJsonString(semanticValue(declaration))
});

const convertParserDiagnostic = (
  packageName: string,
  path: string,
  diagnostic: AssetSourceParseResult['diagnostics'][number]
): WorkspaceDiagnostic => errorDiagnostic(
  `workspace.source.${diagnostic.code.replace(/^asset\./u, '')}`,
  diagnostic.message,
  sourceRefFor(packageName, path, {
    packageName, path, start: diagnostic.span.start, end: diagnostic.span.end
  })
);

const parseSource = (
  packageName: string,
  path: string,
  expectedKind: AssetSourceUnit['kind'],
  source: string,
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits
): ParsedState | undefined => {
  const parsed = parseAssetSource(source, path);
  for (const diagnostic of parsed.diagnostics) {
    if (!addDiagnostic(diagnostics, limits, convertParserDiagnostic(packageName, path, diagnostic))) {
      return undefined;
    }
  }
  if (parsed.unit === null) return undefined;
  if (parsed.unit.kind !== expectedKind) {
    addDiagnostic(diagnostics, limits, errorDiagnostic('workspace.source.unit_kind',
      `Source ${path} must declare a ${expectedKind} unit.`, sourceRefFor(packageName, path, {
        packageName, path, start: parsed.unit.span.start, end: parsed.unit.span.end
      })));
    return undefined;
  }
  const imports: WorkspaceParsedImport[] = parsed.unit.imports.map((item: AssetImportDecl) => ({
    packageName, path, specifier: item.path, alias: item.alias,
    source: sourceRefFor(packageName, path, {
      packageName, path, start: item.ref.span.start, end: item.ref.span.end
    })
  }));
  const abi = expectedKind === 'module' ? {
    packageName, subpath: '',
    exports: Object.freeze(parsed.unit.declarations
      .filter((declaration) => declaration.exported).map(declarationAbi))
  } : undefined;
  return { unit: parsed.unit, imports: Object.freeze(imports), abi };
};

export const parseWorkspaceSource = (
  indexes: ReadonlyMap<string, PackageIndex>,
  ref: NodeRef,
  cache: WorkspaceSourceParseCache,
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits
): ParsedState | undefined => {
  const key = sourceKey(ref);
  if (cache.attempted.has(key)) return cache.states.get(key);
  cache.attempted.add(key);
  const pkg = indexes.get(ref.packageName);
  const source = pkg?.filesByPath.get(ref.path);
  if (pkg === undefined || source === undefined) return undefined;
  const parsed = parseSource(pkg.view.name, ref.path, ref.kind === 'entry' ? 'asset' : 'module',
    source.source, diagnostics, limits);
  if (parsed !== undefined) cache.states.set(key, parsed);
  return parsed;
};

export const parseWorkspaceSources = (
  indexes: ReadonlyMap<string, PackageIndex>,
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits,
  cache: WorkspaceSourceParseCache = createWorkspaceSourceParseCache()
): ReadonlyMap<string, ParsedState> | undefined => {
  for (const pkg of indexes.values()) {
    const declarations = [
      ...pkg.view.manifest.entries.map((entry) => ({
        kind: 'entry' as const, name: entry.name, path: sourcePath(pkg.view, entry.path)
      })),
      ...pkg.view.manifest.modules.map((module) => ({
        kind: 'module' as const, name: module.subpath, path: sourcePath(pkg.view, module.path)
      }))
    ];
    for (const declaration of declarations) {
      parseWorkspaceSource(indexes, {
        kind: declaration.kind, name: declaration.name,
        packageName: pkg.view.name, path: declaration.path
      }, cache, diagnostics, limits);
      if (diagnostics.length >= limits.maxDiagnostics) return undefined;
    }
  }
  return cache.states;
};

/** Resolves imports for all declared modules during whole-workspace validation. */
export const validateDeclaredModuleImports = (
  indexes: ReadonlyMap<string, PackageIndex>,
  cache: WorkspaceSourceParseCache,
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits
): void => {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  let edgeCount = 0;
  const walk = (
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
    const pkg = indexes.get(ref.packageName);
    const source = pkg?.filesByPath.get(ref.path);
    const state = cache.states.get(key);
    if (pkg === undefined || source === undefined) {
      addDiagnostic(diagnostics, limits, errorDiagnostic('workspace.import.source_missing',
        `Imported source is unavailable: ${qualified(ref.packageName, ref.path)}.`));
      visited.add(key);
      return false;
    }
    if (state === undefined) {
      visited.add(key);
      return false;
    }
    visiting.add(key);
    let valid = true;
    const aliases = new Set<string>();
    const records = [...state.imports].sort((a, b) =>
      compareText(a.specifier, b.specifier) || a.source.start.offset - b.source.start.offset);
    for (const record of records) {
      if (edgeCount >= limits.maxImportEdges) {
        addDiagnostic(diagnostics, limits, errorDiagnostic('workspace.budget.import_edges',
          `Workspace import edges exceed ${limits.maxImportEdges}.`, record.source));
        valid = false;
        break;
      }
      edgeCount += 1;
      if (record.alias === null || aliases.has(record.alias)) {
        addDiagnostic(diagnostics, limits, errorDiagnostic('workspace.import.duplicate_alias',
          `Import alias is declared more than once in ${qualified(ref.packageName, ref.path)}.`,
          record.source));
        valid = false;
        break;
      }
      aliases.add(record.alias);
      const target = resolveImport(ref, pkg, record, indexes);
      if ('severity' in target) {
        addDiagnostic(diagnostics, limits, target);
        valid = false;
        break;
      }
      if (!walk(target, [...chain, qualified(ref.packageName, ref.path)], depth + 1,
        record.source)) {
        valid = false;
        break;
      }
    }
    visiting.delete(key);
    visited.add(key);
    return valid;
  };
  const refs: NodeRef[] = [];
  for (const pkg of indexes.values()) for (const module of pkg.view.manifest.modules) {
    refs.push({ kind: 'module', packageName: pkg.view.name,
      name: module.subpath, path: sourcePath(pkg.view, module.path) });
  }
  refs.sort((left, right) => compareText(left.packageName, right.packageName) ||
    compareText(left.path, right.path));
  for (const ref of refs) {
    walk(ref, [], 0);
    if (diagnostics.length >= limits.maxDiagnostics) return;
  }
};

const relativeTargetPath = (
  importer: string,
  specifier: string,
  root: string
): string | undefined => {
  if (!specifier.startsWith('./') || specifier.includes('//') ||
      specifier.includes('/./') || specifier.includes('/../') ||
      specifier.endsWith('/') || specifier.normalize('NFC') !== specifier) return undefined;
  const base = importer.split('/');
  base.pop();
  for (const segment of specifier.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (base.length === 0) return undefined;
      base.pop();
    } else base.push(segment);
  }
  const result = base.join('/');
  if (root.length > 0 && !result.startsWith(`${root}/`)) return undefined;
  try { return normalizeLogicalPath(result); } catch (_error) { return undefined; }
};

const packageSpecifier = (
  specifier: string
): { readonly packageName: string; readonly subpath: string } | undefined => {
  const pieces = specifier.split('/');
  if (specifier.startsWith('@')) {
    if (pieces.length < 3) return undefined;
    return { packageName: `${pieces[0]}/${pieces[1]}`,
      subpath: `./${pieces.slice(2).join('/')}` };
  }
  if (pieces.length < 2) return undefined;
  return { packageName: pieces[0], subpath: `./${pieces.slice(1).join('/')}` };
};

export const resolveImport = (
  from: NodeRef,
  importer: PackageIndex,
  record: WorkspaceParsedImport,
  indexes: ReadonlyMap<string, PackageIndex>
): NodeRef | WorkspaceDiagnostic => {
  if (record.specifier.startsWith('./') || record.specifier.startsWith('../')) {
    const path = relativeTargetPath(from.path, record.specifier, importer.view.root);
    const module = path === undefined ? undefined : importer.modulesByPath.get(path);
    if (path === undefined || module === undefined) return errorDiagnostic(
      'workspace.import.relative_missing',
      `Relative import does not resolve to a declared module: ${record.specifier}.`, record.source);
    return { kind: 'module', packageName: importer.view.name,
      name: module.subpath, path };
  }
  const parsed = packageSpecifier(record.specifier);
  if (parsed === undefined) return errorDiagnostic('workspace.import.package_specifier',
    `Package import must name an exposed module subpath: ${record.specifier}.`, record.source);
  if (!importer.view.manifest.dependencies.some((item) => item.name === parsed.packageName)) {
    return errorDiagnostic('workspace.import.undeclared_dependency',
      `Package ${importer.view.name} does not declare dependency ${parsed.packageName}.`, record.source);
  }
  const target = indexes.get(parsed.packageName);
  if (target === undefined) return errorDiagnostic('workspace.import.package_missing',
    `Package dependency is not present in the closed workspace: ${parsed.packageName}.`, record.source);
  const module = target.modulesBySubpath.get(parsed.subpath);
  if (module === undefined) return errorDiagnostic('workspace.import.module_missing',
    `Package module is not exported: ${record.specifier}.`, record.source);
  return { kind: 'module', packageName: parsed.packageName,
    name: module.subpath, path: module.path };
};
