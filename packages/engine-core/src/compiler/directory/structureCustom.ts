import type { CompiledModel } from '../../model/compiled';
import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import type { AssetSourceParseResult } from '../../project/program/asset/contract';
import { parseAssetSource } from '../../project/program/asset/parse';
import {
  buildStdPackageEntry,
  isStdLibraryLogicalPath,
  isVirtualLibrarySpecifier,
  virtualLibraryLogicalPath,
} from '../../project/stdlib/resolve';
import {
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  DEFAULT_WORKSPACE_LIMITS,
} from '../../project/workspace';
import { sealWorkspaceCandidate } from '../../project/workspace/seal';
import { compileAssetWorkspaceEntry } from '../program/asset/compile';
import type { CachedCustomModel } from './cache';

/** Resolves either a virtual `"std/..."` import or a relative structure `.ashfox` path. */
export const resolveStructureImportPath = (owner: string, target: string): string => {
  if (isVirtualLibrarySpecifier(target)) return virtualLibraryLogicalPath(target);
  if (!target.startsWith('./') && !target.startsWith('../')) {
    throw new Error(`Structure imports must be relative .ashfox paths: ${target}`);
  }
  if (!target.endsWith('.ashfox') || /[\\\x00-\x1f]/u.test(target)) {
    throw new Error(`Invalid structure import: ${target}`);
  }
  const parts = owner.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) throw new Error(`Import escapes root: ${target}`);
      parts.pop();
    } else if (!segment) throw new Error(`Empty import segment: ${target}`);
    else parts.push(segment);
  }
  return parts.join('/');
};

const resolvePackageImport = (
  packages: DirectoryWorkspace['packages'],
  specifier: string,
): string | null => {
  for (const pkg of packages) {
    if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) continue;
    const subpath = specifier === pkg.name ? '.' : `./${specifier.slice(pkg.name.length + 1)}`;
    const mod = pkg.manifest.modules.find((m) => m.subpath === subpath);
    if (!mod) return null;
    return pkg.root ? `${pkg.root}/${mod.path}` : mod.path;
  }
  return null;
};

const resolveModelImport = (
  packages: DirectoryWorkspace['packages'],
  ownerPath: string,
  specifier: string,
): string | null => {
  if (isVirtualLibrarySpecifier(specifier)) return virtualLibraryLogicalPath(specifier);
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return resolvePackageImport(packages, specifier);
  }
  try {
    return resolveStructureImportPath(ownerPath, specifier);
  } catch {
    return null;
  }
};

const parseAssetCached = (
  filePath: string,
  source: string,
  assetUnits?: Map<string, AssetSourceParseResult>,
): AssetSourceParseResult => {
  const cached = assetUnits?.get(filePath);
  if (cached) return cached;
  const parsed = parseAssetSource(source, filePath);
  assetUnits?.set(filePath, parsed);
  return parsed;
};

const visitReachableModel = (
  current: string,
  packages: DirectoryWorkspace['packages'],
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  reachable: Set<string>,
  stack: string[],
  assetUnits?: Map<string, AssetSourceParseResult>,
): void => {
  if (reachable.has(current)) return;
  reachable.add(current);
  const file = filesByPath.get(current);
  const parsed = file ? parseAssetCached(current, file.source, assetUnits) : null;
  if (!parsed?.unit) return;
  for (const imp of parsed.unit.imports) {
    const target = resolveModelImport(packages, current, imp.path);
    if (target && !reachable.has(target)) stack.push(target);
  }
};

/** Returns structure custom-model sources not reachable from any independent model entry. */
export const collectStructureOnlyCustomPaths = (
  config: DirectoryWorkspace,
  modelEntryPaths: readonly string[],
  structureCustomPaths: ReadonlySet<string>,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  assetUnits?: Map<string, AssetSourceParseResult>,
): ReadonlySet<string> => {
  const reachable = new Set<string>();
  const stack = [...modelEntryPaths];
  while (stack.length > 0) {
    visitReachableModel(stack.pop()!, config.packages, filesByPath, reachable, stack, assetUnits);
  }
  return new Set([...structureCustomPaths].filter((p) => !reachable.has(p)));
};

const collectModelClosure = (
  entryPath: string,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  collected: Map<string, DirectoryFile>,
  visiting: Set<string>,
  assetUnits?: Map<string, AssetSourceParseResult>,
): void => {
  if (visiting.has(entryPath) || collected.has(entryPath)) return;
  const file = filesByPath.get(entryPath);
  if (!file) throw new Error(`Missing custom model source: ${entryPath}`);
  visiting.add(entryPath);
  const parsed = parseAssetCached(entryPath, file.source, assetUnits);
  if (!parsed.unit || parsed.diagnostics.length > 0) {
    throw new Error(
      `Custom model parse failed (${entryPath}): ${JSON.stringify(parsed.diagnostics)}`,
    );
  }
  collected.set(entryPath, file);
  for (const imp of parsed.unit.imports) {
    collectModelClosure(
      resolveStructureImportPath(entryPath, imp.path),
      filesByPath,
      collected,
      visiting,
      assetUnits,
    );
  }
  visiting.delete(entryPath);
};

const buildCustomModelManifest = (
  entryId: string,
  modelPath: string,
  files: readonly DirectoryFile[],
) => {
  const customFiles = files.filter((f) => f.path !== modelPath && !isStdLibraryLogicalPath(f.path));
  const stdPkg = buildStdPackageEntry(files.map((f) => f.path));
  const base = {
    name: 'custom',
    root: '',
    manifest: {
      format: 'ashfox-package' as const,
      version: 1 as const,
      dependencies: [] as const,
      entries: [{ name: entryId, path: modelPath }],
      modules: customFiles.map((f, i) => ({ subpath: `./mod${i}`, path: f.path })),
    },
  };
  return {
    format: 'ashfox-workspace' as const,
    version: 1 as const,
    packages: stdPkg ? [base, stdPkg] : [base],
  };
};

/** Compiles an imported custom `.ashfox` model and its closure for a structure entry. */
export const compileImportedModel = (
  modelPath: string,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  cache: Map<string, CachedCustomModel>,
  touched: Set<string>,
  assetUnits?: Map<string, AssetSourceParseResult>,
): CompiledModel => {
  const cached = cache.get(modelPath);
  if (cached) {
    for (const p of cached.closurePaths) touched.add(p);
    return cached.model;
  }
  const closure = new Map<string, DirectoryFile>();
  collectModelClosure(modelPath, filesByPath, closure, new Set(), assetUnits);
  const closurePaths = Object.freeze([...closure.keys()]);
  for (const p of closurePaths) touched.add(p);
  const entryUnit = parseAssetCached(
    modelPath,
    filesByPath.get(modelPath)!.source,
    assetUnits,
  ).unit!;
  const files = [...closure.values()];
  const manifest = buildCustomModelManifest(entryUnit.id, modelPath, files);
  const base = {
    files: [],
    manifest,
    lock: {
      format: 'ashfox-lock' as const,
      version: 1 as const,
      compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
      packages: [],
    },
  };
  const sealed = sealWorkspaceCandidate(base, files, manifest, DEFAULT_WORKSPACE_LIMITS);
  if (!sealed.ok)
    throw new Error(
      `Custom model seal failed (${modelPath}): ${JSON.stringify(sealed.diagnostics)}`,
    );
  const compiled = compileAssetWorkspaceEntry(sealed.value, {
    packageName: 'custom',
    entryName: entryUnit.id,
  });
  if (!compiled.ok)
    throw new Error(
      `Custom model compile failed (${modelPath}): ${JSON.stringify(compiled.diagnostics)}`,
    );
  cache.set(modelPath, Object.freeze({ model: compiled.model, closurePaths }));
  return compiled.model;
};
