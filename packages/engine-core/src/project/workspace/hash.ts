import { encodeUtf8 } from '@ashfox/internal-contracts';
import { canonicalJsonString } from '../../canonicalJson';
import { sha256ByteDigest, sha256Digest } from '../../provenance/digest';

import type {
  AssetEntry,
  AuthoredAssetWorkspace,
  LockedDependency,
  LockedFile,
  LockedPackage,
  ModuleDeclaration,
  PackageDependency,
  PackageManifest,
  Sha256Digest,
  WorkspaceAbiExport,
  WorkspaceFile,
  WorkspaceLock,
  WorkspaceManifest,
  WorkspaceModuleAbi,
  WorkspacePackage,
} from './contract';
import { assertWellFormedSourceText, sourceByteLength } from './path';

const digest = (value: string): Sha256Digest => sha256Digest(value) as Sha256Digest;

const compareBy = <T>(left: T, right: T, key: (value: T) => string): number => {
  const leftKey = key(left);
  const rightKey = key(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
};

const canonicalEntry = (entry: AssetEntry): AssetEntry => ({
  name: entry.name,
  path: entry.path,
});

const canonicalModule = (module: ModuleDeclaration): ModuleDeclaration => ({
  subpath: module.subpath,
  path: module.path,
});

const canonicalDependency = (dependency: PackageDependency): PackageDependency => ({
  name: dependency.name,
});

export const canonicalPackageManifest = (manifest: PackageManifest): PackageManifest => ({
  format: manifest.format,
  version: manifest.version,
  entries: [...manifest.entries]
    .sort((left, right) => compareBy(left, right, (entry) => entry.name))
    .map(canonicalEntry),
  modules: [...manifest.modules]
    .sort((left, right) => compareBy(left, right, (module) => module.subpath))
    .map(canonicalModule),
  dependencies: [...manifest.dependencies]
    .sort((left, right) => compareBy(left, right, (dependency) => dependency.name))
    .map(canonicalDependency),
});

export const canonicalWorkspaceManifest = (manifest: WorkspaceManifest): WorkspaceManifest => ({
  format: manifest.format,
  version: manifest.version,
  packages: [...manifest.packages]
    .sort((left, right) => compareBy(left, right, (pkg) => pkg.name))
    .map((pkg) => ({
      name: pkg.name,
      root: pkg.root,
      manifest: canonicalPackageManifest(pkg.manifest),
    })),
});

const canonicalLockedFile = (file: LockedFile): LockedFile => ({
  path: file.path,
  contentHash: file.contentHash,
});

const canonicalLockedDependency = (dependency: LockedDependency): LockedDependency => ({
  name: dependency.name,
  contentHash: dependency.contentHash,
  interfaceHash: dependency.interfaceHash,
});

const canonicalLockedPackage = (pkg: LockedPackage): LockedPackage => ({
  name: pkg.name,
  source: pkg.source,
  digest: pkg.digest,
  root: pkg.root,
  manifest: canonicalPackageManifest(pkg.manifest),
  contentHash: pkg.contentHash,
  manifestHash: pkg.manifestHash,
  files: [...pkg.files]
    .sort((left, right) => compareBy(left, right, (file) => file.path))
    .map(canonicalLockedFile),
  interfaceHash: pkg.interfaceHash,
  dependencies: [...pkg.dependencies]
    .sort((left, right) => compareBy(left, right, (dependency) => dependency.name))
    .map(canonicalLockedDependency),
});

export const canonicalWorkspaceLock = (lock: WorkspaceLock): WorkspaceLock => ({
  format: lock.format,
  version: lock.version,
  compilerFingerprint: lock.compilerFingerprint,
  packages: [...lock.packages]
    .sort((left, right) => compareBy(left, right, (pkg) => pkg.name))
    .map(canonicalLockedPackage),
});

export const computeSourceContentHash = (source: string): Sha256Digest => {
  const checked = assertWellFormedSourceText(source);
  return sha256ByteDigest(encodeUtf8(checked)) as Sha256Digest;
};

export const computePackageManifestHash = (pkg: WorkspacePackage): Sha256Digest =>
  digest(
    canonicalJsonString({
      name: pkg.name,
      root: pkg.root,
      manifest: canonicalPackageManifest(pkg.manifest),
    }),
  );

export const computeLockedPackageManifestHash = (pkg: LockedPackage): Sha256Digest =>
  digest(
    canonicalJsonString({
      name: pkg.name,
      root: pkg.root,
      manifest: canonicalPackageManifest(pkg.manifest),
    }),
  );

export const computePackageContentHash = (
  pkg: WorkspacePackage,
  files: readonly WorkspaceFile[],
): Sha256Digest =>
  digest(
    canonicalJsonString({
      name: pkg.name,
      root: pkg.root,
      manifestHash: computePackageManifestHash(pkg),
      files: [...files]
        .sort((left, right) => compareBy(left, right, (file) => file.path))
        .map((file) => ({
          path: file.path,
          byteLength: sourceByteLength(file.source),
          contentHash: computeSourceContentHash(file.source),
        })),
    }),
  );

const canonicalAbiExports = (
  exports: readonly WorkspaceAbiExport[],
): readonly WorkspaceAbiExport[] =>
  [...exports]
    .sort((left, right) =>
      compareBy(left, right, (entry) => `${entry.name}\u0000${entry.signature}`),
    )
    .map((entry) => ({ name: entry.name, signature: entry.signature }));

/** Hash only ABI supplied by the compiler's parsed/typed module HIR. */
export const computeModuleInterfaceHash = (
  packageName: string,
  subpath: string,
  abi: WorkspaceModuleAbi | undefined,
  importedInterfaceHashes: readonly Sha256Digest[] = [],
): Sha256Digest =>
  digest(
    canonicalJsonString({
      abiVersion: 1,
      packageName,
      subpath,
      exports: canonicalAbiExports(abi?.exports ?? []),
      imports: [...importedInterfaceHashes].sort(),
    }),
  );

export const computePackageInterfaceHash = (
  pkg: WorkspacePackage,
  moduleAbis: readonly WorkspaceModuleAbi[] = [],
): Sha256Digest => {
  const abiBySubpath = new Map(
    moduleAbis
      .filter((abi) => abi.packageName === pkg.name)
      .map((abi) => [abi.subpath, abi] as const),
  );
  return digest(
    canonicalJsonString({
      abiVersion: 1,
      packageName: pkg.name,
      modules: [...pkg.manifest.modules]
        .sort((left, right) => compareBy(left, right, (module) => module.subpath))
        .map((module) => ({
          subpath: module.subpath,
          interfaceHash: computeModuleInterfaceHash(
            pkg.name,
            module.subpath,
            abiBySubpath.get(module.subpath),
          ),
        })),
    }),
  );
};

const canonicalFileHashes = (files: readonly WorkspaceFile[]) =>
  [...files]
    .sort((left, right) => compareBy(left, right, (file) => file.path))
    .map((file) => ({
      path: file.path,
      byteLength: sourceByteLength(file.source),
      contentHash: computeSourceContentHash(file.source),
    }));

/** Hashes all source bytes plus manifest/lock projections in canonical order. */
export const computeWorkspaceHash = (workspace: AuthoredAssetWorkspace): Sha256Digest =>
  digest(
    canonicalJsonString({
      format: 'ashfox-workspace-authority',
      version: 1,
      files: canonicalFileHashes(workspace.files),
      manifest: canonicalWorkspaceManifest(workspace.manifest),
      lock: canonicalWorkspaceLock(workspace.lock),
    }),
  );
