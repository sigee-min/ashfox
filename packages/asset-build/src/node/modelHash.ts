import {
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  computePackageContentHash,
  computePackageInterfaceHash,
  computePackageManifestHash,
  computeSourceContentHash,
  computeWorkspaceHash,
  readDirectoryWorkspace,
  type AuthoredAssetWorkspace,
  type DirectoryFile,
  type DirectoryWorkspace,
  type Sha256Digest,
} from '@ashfox/engine-core';
import { compareText } from '@ashfox/internal-contracts';
import { checkSnapshot } from '../bundle/compile';
import type { Snapshot } from '../bundle/contract';
import { digest, json } from '../shared/digest';
import { readCacheJson, writeCacheJson, type DiskCacheContext } from './diskCache';
import { joinPackagePath, type PlannedEntry } from './entryPlan';

type WorkspaceManifestPkg = AuthoredAssetWorkspace['manifest']['packages'][number];
type LockedPkg = AuthoredAssetWorkspace['lock']['packages'][number];

const packageModuleFiles = (
  pkg: WorkspaceManifestPkg,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
): readonly DirectoryFile[] =>
  pkg.manifest.modules
    .map((m) => filesByPath.get(joinPackagePath(pkg.root, m.path))!)
    .filter(Boolean)
    .sort((a, b) => compareText(a.path, b.path));

const packageModuleCacheKey = (
  pkg: WorkspaceManifestPkg,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  cache: DiskCacheContext,
): string => {
  const modFiles = packageModuleFiles(pkg, filesByPath);
  return `pkg-iface-${digest(json({ name: pkg.name, root: pkg.root, modules: pkg.manifest.modules, files: modFiles }))}-${cache.fingerprint}`;
};

const collectPackageWithDeps = (
  targetName: string,
  byName: ReadonlyMap<string, WorkspaceManifestPkg>,
): readonly WorkspaceManifestPkg[] => {
  const seen = new Set<string>();
  const queue = [targetName];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const pkg = byName.get(cur);
    if (!pkg) continue;
    for (const dep of pkg.manifest.dependencies) queue.push(dep.name);
  }
  return [...byName.values()].filter((p) => seen.has(p.name));
};

const probePackageInterfaceHash = (
  targetPkg: WorkspaceManifestPkg,
  allModelPkgs: readonly WorkspaceManifestPkg[],
  config: DirectoryWorkspace,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
): Sha256Digest => {
  const byName = new Map(allModelPkgs.map((p) => [p.name, p]));
  const pkgs = collectPackageWithDeps(targetPkg.name, byName).map((p) =>
    p.name === targetPkg.name ? p : { ...p, manifest: { ...p.manifest, entries: [] } },
  );
  const paths = new Set(
    pkgs.flatMap((p) =>
      [...p.manifest.entries, ...p.manifest.modules].map((e) => joinPackagePath(p.root, e.path)),
    ),
  );
  const files = [...paths].sort(compareText).map((p) => filesByPath.get(p)!);
  const subConfig = JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: config.name,
    packages: pkgs,
    include: config.include,
    ignore: config.ignore,
    build: { directory: config.build.directory },
    exports: [],
  });
  const snap: Snapshot = {
    input: '.ashfoxworkspace',
    root: '',
    configuration: subConfig,
    config: readDirectoryWorkspace(subConfig),
    files,
    hash: '',
  };
  const checked = checkSnapshot(snap);
  const modelProd = checked.products.find((p) => p.kind === 'model');
  if (!modelProd || modelProd.kind !== 'model') {
    throw new Error(`Missing model workspace lock for ${targetPkg.name}`);
  }
  const locked = modelProd.workspace.lock.packages.find((p) => p.name === targetPkg.name);
  if (!locked) throw new Error(`Missing locked package ${targetPkg.name}`);
  return locked.interfaceHash;
};

export const collectExactModelPackageInterfaces = (
  modelEntries: readonly PlannedEntry[],
  config: DirectoryWorkspace,
  pkgInterfacesByEntry: ReadonlyMap<
    string,
    readonly { readonly name: string; readonly interfaceHash: string }[]
  >,
  cache: DiskCacheContext,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
): ReadonlyMap<string, Sha256Digest> => {
  const result = new Map<string, Sha256Digest>();
  const modelReachable = new Set(modelEntries.flatMap((e) => e.closurePaths));
  for (const entry of modelEntries) {
    const closureSet = new Set(entry.closurePaths);
    const fullPkgs = config.packages.filter((p) =>
      p.manifest.modules
        .filter((m) => modelReachable.has(joinPackagePath(p.root, m.path)))
        .every((m) => closureSet.has(joinPackagePath(p.root, m.path))),
    );
    const list = pkgInterfacesByEntry.get(
      JSON.stringify([entry.entry.packageName, entry.entry.entryName]),
    );
    if (!list) continue;
    for (const pkg of fullPkgs) {
      const hit = list.find((item) => item.name === pkg.name);
      if (!hit) continue;
      const hash = hit.interfaceHash as Sha256Digest;
      result.set(pkg.name, hash);
      if (pkg.manifest.modules.length > 0) {
        const filteredPkg: WorkspaceManifestPkg = {
          ...pkg,
          manifest: {
            ...pkg.manifest,
            modules: pkg.manifest.modules.filter((m) =>
              modelReachable.has(joinPackagePath(pkg.root, m.path)),
            ),
          },
        };
        writeCacheJson(cache, packageModuleCacheKey(filteredPkg, filesByPath, cache), {
          interfaceHash: hash,
        });
      }
    }
  }
  return result;
};

const resolvePackageInterfaceHash = (
  pkg: WorkspaceManifestPkg,
  allModelPkgs: readonly WorkspaceManifestPkg[],
  config: DirectoryWorkspace,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  knownInterfaces: ReadonlyMap<string, Sha256Digest>,
  cache: DiskCacheContext,
): Sha256Digest => {
  if (pkg.manifest.modules.length === 0) return computePackageInterfaceHash(pkg, []);
  const known = knownInterfaces.get(pkg.name);
  if (known) return known;
  const key = packageModuleCacheKey(pkg, filesByPath, cache);
  const cached = readCacheJson<{ interfaceHash: Sha256Digest }>(cache, key);
  if (cached) return cached.interfaceHash;
  const probed = probePackageInterfaceHash(pkg, allModelPkgs, config, filesByPath);
  writeCacheJson(cache, key, { interfaceHash: probed });
  return probed;
};

const buildLockedPackages = (
  modelPkgs: readonly WorkspaceManifestPkg[],
  config: DirectoryWorkspace,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  knownInterfaces: ReadonlyMap<string, Sha256Digest>,
  cache: DiskCacheContext,
): readonly LockedPkg[] => {
  const provisional = new Map<string, Omit<LockedPkg, 'dependencies'>>();
  for (const pkg of modelPkgs) {
    const pkgFiles = [...pkg.manifest.entries, ...pkg.manifest.modules].map((e) =>
      filesByPath.get(joinPackagePath(pkg.root, e.path))!,
    );
    const ifaceHash = resolvePackageInterfaceHash(
      pkg,
      modelPkgs,
      config,
      filesByPath,
      knownInterfaces,
      cache,
    );
    provisional.set(pkg.name, {
      name: pkg.name,
      root: pkg.root,
      manifest: pkg.manifest,
      source: 'workspace',
      digest: null,
      contentHash: computePackageContentHash(pkg, pkgFiles),
      manifestHash: computePackageManifestHash(pkg),
      interfaceHash: ifaceHash,
      files: pkgFiles.map((f) => ({
        path: f.path,
        contentHash: computeSourceContentHash(f.source),
      })),
    });
  }
  return [...provisional.values()]
    .map((pkg) => ({
      ...pkg,
      dependencies: pkg.manifest.dependencies.map((dep) => {
        const target = provisional.get(dep.name)!;
        return {
          name: target.name,
          contentHash: target.contentHash,
          interfaceHash: target.interfaceHash,
        };
      }),
    }))
    .sort((a, b) => compareText(a.name, b.name));
};

export const computeModelWorkspaceHash = (
  config: DirectoryWorkspace,
  snapshotFiles: readonly DirectoryFile[],
  modelEntries: readonly PlannedEntry[],
  knownInterfaces: ReadonlyMap<string, Sha256Digest>,
  cache: DiskCacheContext,
): Sha256Digest => {
  const modelPaths = new Set(modelEntries.map((e) => e.sourcePath));
  const modelReachable = new Set(modelEntries.flatMap((e) => e.closurePaths));
  const filesByPath = new Map(snapshotFiles.map((f) => [f.path, f]));
  const modelPkgs: WorkspaceManifestPkg[] = config.packages.map((p) => ({
    ...p,
    manifest: {
      ...p.manifest,
      entries: p.manifest.entries.filter((e) => modelPaths.has(joinPackagePath(p.root, e.path))),
      modules: p.manifest.modules.filter((m) =>
        modelReachable.has(joinPackagePath(p.root, m.path)),
      ),
    },
  }));
  return computeWorkspaceHash({
    files: snapshotFiles.filter((f) => modelReachable.has(f.path)),
    manifest: { format: 'ashfox-workspace', version: 1, packages: modelPkgs },
    lock: {
      format: 'ashfox-lock',
      version: 1,
      compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
      packages: buildLockedPackages(modelPkgs, config, filesByPath, knownInterfaces, cache),
    },
  });
};
