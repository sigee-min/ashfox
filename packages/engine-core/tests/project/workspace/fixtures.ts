import {
  ASHFOX_LOCK_FORMAT,
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  ASHFOX_PACKAGE_FORMAT,
  ASHFOX_WORKSPACE_FORMAT,
  ASHFOX_WORKSPACE_VERSION,
  computePackageContentHash,
  computePackageInterfaceHash,
  computePackageManifestHash,
  computeSourceContentHash,
  type AuthoredAssetWorkspace,
  type LockedPackage,
  type WorkspaceFile,
  type WorkspaceModuleAbi,
  type WorkspacePackage,
} from '../../../src/project/workspace';

export const assetSource = (name: string, imports: readonly string[] = []): string =>
  `ashfox 1\nmodel ${name} {${imports
    .map((item) => ` import "${item}" as ${item.replace(/[^A-Za-z0-9_]/gu, '_')};`)
    .join('')}}`;

export const moduleSource = (
  name: string,
  imports: readonly string[] = [],
  exported = false,
): string =>
  `ashfox 1\nmodule ${name} {${imports
    .map((item) => ` import "${item}" as ${item.replace(/[^A-Za-z0-9_]/gu, '_')};`)
    .join('')}${exported ? ` export component ${name}_component {}` : ''}}`;

const lockForPackage = (
  pkg: WorkspacePackage,
  files: readonly WorkspaceFile[],
  moduleAbis: readonly WorkspaceModuleAbi[] = [],
  dependencies: LockedPackage['dependencies'] = [],
): LockedPackage => ({
  name: pkg.name,
  source: 'workspace',
  digest: null,
  root: pkg.root,
  manifest: pkg.manifest,
  contentHash: computePackageContentHash(pkg, files),
  manifestHash: computePackageManifestHash(pkg),
  files: files.map((file) => ({
    path: file.path,
    contentHash: computeSourceContentHash(file.source),
  })),
  interfaceHash: computePackageInterfaceHash(pkg, moduleAbis),
  dependencies,
});

export const workspaceFixture = (
  files: readonly WorkspaceFile[],
  options: {
    readonly entries?: readonly { readonly name: string; readonly path: string }[];
    readonly modules?: readonly { readonly subpath: string; readonly path: string }[];
    readonly root?: string;
    readonly packageName?: string;
    readonly moduleAbis?: readonly WorkspaceModuleAbi[];
  } = {},
): AuthoredAssetWorkspace => {
  const root = options.root ?? 'dragon';
  const packageName = options.packageName ?? 'dragon';
  const pkg: WorkspacePackage = {
    name: packageName,
    root,
    manifest: {
      format: ASHFOX_PACKAGE_FORMAT,
      version: ASHFOX_WORKSPACE_VERSION,
      entries: options.entries ?? [{ name: 'main', path: 'main.ashfox' }],
      modules: options.modules ?? [],
      dependencies: [],
    },
  };
  const packageFiles = files.filter(
    (file) => root.length === 0 || file.path.startsWith(`${root}/`),
  );
  return Object.freeze({
    files: Object.freeze([...files]),
    manifest: {
      format: ASHFOX_WORKSPACE_FORMAT,
      version: ASHFOX_WORKSPACE_VERSION,
      packages: [pkg],
    },
    lock: {
      format: ASHFOX_LOCK_FORMAT,
      version: ASHFOX_WORKSPACE_VERSION,
      compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
      packages: [lockForPackage(pkg, packageFiles, options.moduleAbis)],
    },
  });
};

export const packagesFixture = (
  specs: readonly {
    readonly name: string;
    readonly root: string;
    readonly entries: readonly { readonly name: string; readonly path: string }[];
    readonly modules: readonly { readonly subpath: string; readonly path: string }[];
    readonly dependencies?: readonly string[];
    readonly files: readonly WorkspaceFile[];
  }[],
): AuthoredAssetWorkspace => {
  const packages: WorkspacePackage[] = specs.map((spec) => ({
    name: spec.name,
    root: spec.root,
    manifest: {
      format: ASHFOX_PACKAGE_FORMAT,
      version: ASHFOX_WORKSPACE_VERSION,
      entries: spec.entries,
      modules: spec.modules,
      dependencies: (spec.dependencies ?? []).map((name) => ({ name })),
    },
  }));
  const plainLocks = packages.map((pkg) => {
    const files = specs.find((spec) => spec.name === pkg.name)?.files ?? [];
    return lockForPackage(pkg, files);
  });
  const lockByName = new Map(plainLocks.map((lock) => [lock.name, lock]));
  const locks = plainLocks.map((lock) => {
    const pkg = packages.find((item) => item.name === lock.name)!;
    return {
      ...lock,
      dependencies: pkg.manifest.dependencies.map((dependency) => {
        const target = lockByName.get(dependency.name);
        if (target === undefined) throw new Error(`Missing fixture dependency ${dependency.name}`);
        return {
          name: dependency.name,
          contentHash: target.contentHash,
          interfaceHash: target.interfaceHash,
        };
      }),
    };
  });
  return Object.freeze({
    files: Object.freeze(specs.flatMap((spec) => spec.files)),
    manifest: { format: ASHFOX_WORKSPACE_FORMAT, version: ASHFOX_WORKSPACE_VERSION, packages },
    lock: {
      format: ASHFOX_LOCK_FORMAT,
      version: ASHFOX_WORKSPACE_VERSION,
      compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
      packages: locks,
    },
  });
};
