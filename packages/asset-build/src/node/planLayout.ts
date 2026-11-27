import {
  buildStdPackageEntry,
  inspectNativeSource,
  isDirectorySource,
  isStdLibraryLogicalPath,
  isVirtualLibrarySpecifier,
  resolveImportPath,
  virtualLibraryLogicalPath,
  type DirectoryFile,
  type DirectoryWorkspace,
  type WorkspaceEntrySelector,
} from '@ashfox/engine-core';
import { compareText, encodeUtf8 } from '@ashfox/internal-contracts';
import { digest } from '../shared/digest';
import { readCacheJson, writeCacheJson, type DiskCacheContext } from './diskCache';

export type AssetEntryKind = 'model' | 'sprite' | 'sound' | 'structure' | 'vfx';
export type NativeSourceMetadata = ReturnType<typeof inspectNativeSource>;

const CANONICAL_PREFIXES = [
  'assets/models/',
  'assets/sprites/',
  'assets/sounds/',
  'assets/structures/',
  'assets/vfx/',
  'assets/module/',
] as const;

const BUCKET_BY_KIND: Readonly<Record<AssetEntryKind, string>> = {
  model: 'assets/models/',
  sprite: 'assets/sprites/',
  sound: 'assets/sounds/',
  structure: 'assets/structures/',
  vfx: 'assets/vfx/',
};

export const joinPackagePath = (root: string, rel: string): string =>
  [root, rel].filter(Boolean).join('/');

export const entrySelectorKey = (entry: WorkspaceEntrySelector): string =>
  JSON.stringify([entry.packageName, entry.entryName]);

const resolvePackageImport = (
  packages: DirectoryWorkspace['packages'],
  specifier: string,
): string | null => {
  for (const pkg of packages) {
    if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) continue;
    const subpath = specifier === pkg.name ? '.' : `./${specifier.slice(pkg.name.length + 1)}`;
    const mod = pkg.manifest.modules.find((m) => m.subpath === subpath);
    if (!mod) return null;
    return joinPackagePath(pkg.root, mod.path);
  }
  return null;
};

const resolveImportTarget = (
  packages: DirectoryWorkspace['packages'],
  ownerPath: string,
  specifier: string,
  allowPackage: boolean,
): string | null => {
  if (isVirtualLibrarySpecifier(specifier)) return virtualLibraryLogicalPath(specifier);
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return resolveImportPath(ownerPath, specifier);
  }
  return allowPackage ? resolvePackageImport(packages, specifier) : null;
};

export const loadSourceMetadata = (
  files: readonly DirectoryFile[],
  cache: DiskCacheContext,
): ReadonlyMap<string, NativeSourceMetadata> => {
  const indexKey = `meta-${cache.fingerprint}`;
  const cached = cache.enabled
    ? (readCacheJson<Record<string, NativeSourceMetadata>>(cache, indexKey) ?? {})
    : {};
  const nextIndex: Record<string, NativeSourceMetadata> = { ...cached };
  const result = new Map<string, NativeSourceMetadata>();
  let dirty = false;
  for (const file of files) {
    const fileKey = digest(`${file.path}\u0000${file.source}`);
    let meta = cached[fileKey];
    if (!meta) {
      meta = inspectNativeSource(file.source, file.path);
      nextIndex[fileKey] = meta;
      dirty = true;
    }
    result.set(file.path, meta);
  }
  if (dirty && cache.enabled) writeCacheJson(cache, indexKey, nextIndex);
  return result;
};

export const validateDeclaredSnapshotFiles = (
  config: DirectoryWorkspace,
  files: readonly DirectoryFile[],
): ReadonlyMap<string, DirectoryFile> | null => {
  const totalBytes = files.reduce((sum, f) => sum + encodeUtf8(f.source).length, 0);
  if (files.length > 512 || totalBytes > 8 * 1024 * 1024) return null;
  const declared = new Set(
    config.packages.flatMap((p) =>
      [...p.manifest.entries, ...p.manifest.modules].map((e) => joinPackagePath(p.root, e.path)),
    ),
  );
  const seen = new Set<string>();
  for (const f of files) {
    const isStd = isStdLibraryLogicalPath(f.path);
    const valid =
      !f.path.startsWith('/') &&
      !seen.has(f.path.toLowerCase()) &&
      (isStd || (isDirectorySource(config, f.path) && declared.has(f.path)));
    if (!valid) return null;
    seen.add(f.path.toLowerCase());
  }
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const p of declared) if (!byPath.has(p)) return null;
  return byPath;
};

const recordModuleImport = (
  entryPath: string,
  target: string | null,
  seen: Set<string>,
  queue: string[],
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
  importers: Map<string, Set<string>>,
): void => {
  if (!target || seen.has(target)) return;
  seen.add(target);
  const targetMeta = metaByPath.get(target);
  if (!targetMeta) return;
  if (targetMeta.kind === 'module') {
    const owners = importers.get(target) ?? new Set<string>();
    owners.add(entryPath);
    importers.set(target, owners);
  }
  queue.push(target);
};

const collectEntryModuleImporters = (
  entryPath: string,
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
  importers: Map<string, Set<string>>,
): void => {
  const seen = new Set<string>();
  const queue = [entryPath];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const curMeta = metaByPath.get(cur);
    if (!curMeta) continue;
    for (const spec of curMeta.imports) {
      recordModuleImport(
        entryPath,
        resolveImportPath(cur, spec),
        seen,
        queue,
        metaByPath,
        importers,
      );
    }
  }
};

const hasInvalidLayoutFile = (metaByPath: ReadonlyMap<string, NativeSourceMetadata>): boolean => {
  for (const [filePath, meta] of metaByPath) {
    if (isStdLibraryLogicalPath(filePath)) {
      if (meta.kind !== 'module') return true;
      continue;
    }
    if (!CANONICAL_PREFIXES.some((prefix) => filePath.startsWith(prefix))) return true;
    if (filePath.startsWith('assets/module/') && meta.kind !== 'module') return true;
  }
  return false;
};

export const checkLayout = (
  config: DirectoryWorkspace,
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
  entryPaths: readonly string[],
): boolean => {
  if (config.name === 'standalone') return true;
  if (hasInvalidLayoutFile(metaByPath)) return false;
  const importers = new Map<string, Set<string>>();
  for (const entryPath of new Set(entryPaths)) {
    const meta = metaByPath.get(entryPath);
    if (!meta || meta.kind === 'module') continue;
    if (!entryPath.startsWith(BUCKET_BY_KIND[meta.kind])) return false;
    collectEntryModuleImporters(entryPath, metaByPath, importers);
  }
  return [...importers.entries()].every(
    ([modPath, owners]) =>
      owners.size < 2 || modPath.startsWith('assets/module/') || isStdLibraryLogicalPath(modPath),
  );
};

export const collectEntryClosure = (
  entryPath: string,
  kind: AssetEntryKind,
  packages: DirectoryWorkspace['packages'],
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
): readonly string[] | null => {
  const seen = new Set<string>();
  const queue = [entryPath];
  const allowPkg = kind === 'model';
  while (queue.length > 0) {
    const cur = queue.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const meta = metaByPath.get(cur);
    if (!meta) return null;
    for (const spec of meta.imports) {
      const target = resolveImportTarget(packages, cur, spec, allowPkg);
      if (!target || !metaByPath.has(target)) return null;
      if (!seen.has(target)) queue.push(target);
    }
  }
  return [...seen].sort(compareText);
};

const packageRelativePath = (pkgRoot: string, fullPath: string): string =>
  pkgRoot ? fullPath.slice(pkgRoot.length + 1) : fullPath;

const buildPackageSubset = (
  pkg: DirectoryWorkspace['packages'][number],
  ownerEntry: WorkspaceEntrySelector,
  ownerPath: string,
  closureSet: ReadonlySet<string>,
) => {
  const isOwner = pkg.name === ownerEntry.packageName;
  const entries = isOwner
    ? pkg.manifest.entries.filter((e) => e.name === ownerEntry.entryName)
    : [];
  const modules = pkg.manifest.modules.filter((m) =>
    closureSet.has(joinPackagePath(pkg.root, m.path)),
  );
  const declaredModPaths = new Set(modules.map((m) => joinPackagePath(pkg.root, m.path)));
  const prefix = pkg.root ? `${pkg.root}/` : '';
  const extraModules = [...closureSet]
    .filter(
      (p) =>
        p !== ownerPath &&
        !isStdLibraryLogicalPath(p) &&
        !declaredModPaths.has(p) &&
        (prefix === '' || p.startsWith(prefix)),
    )
    .sort(compareText)
    .map((p, idx) => ({ subpath: `./__dep_${idx}`, path: packageRelativePath(pkg.root, p) }));
  const allModules = [...modules, ...extraModules];
  if (entries.length === 0 && allModules.length === 0) return null;
  return {
    name: pkg.name,
    root: pkg.root,
    manifest: {
      format: pkg.manifest.format,
      version: pkg.manifest.version,
      entries,
      modules: allModules,
      dependencies: pkg.manifest.dependencies,
    },
  };
};

export const buildSubConfigJson = (
  config: DirectoryWorkspace,
  ownerEntry: WorkspaceEntrySelector,
  ownerPath: string,
  closureSet: ReadonlySet<string>,
): string => {
  const packages = config.packages
    .map((pkg) => buildPackageSubset(pkg, ownerEntry, ownerPath, closureSet))
    .filter((pkg): pkg is NonNullable<typeof pkg> => pkg !== null);
  const stdPkg = packages.some((p) => p.name === 'std') ? null : buildStdPackageEntry(closureSet);
  const allPackages = stdPkg ? [...packages, stdPkg] : packages;
  const validNames = new Set(allPackages.map((p) => p.name));
  const sanitized = allPackages.map((pkg) => ({
    ...pkg,
    manifest: {
      ...pkg.manifest,
      dependencies: pkg.manifest.dependencies.filter((d) => validNames.has(d.name)),
    },
  }));
  return JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: config.name,
    packages: sanitized,
    include: config.include,
    ignore: config.ignore,
    build: { directory: config.build.directory },
    exports: [],
  });
};
