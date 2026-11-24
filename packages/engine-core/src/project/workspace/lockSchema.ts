import {
  ASHFOX_LOCK_FORMAT,
  type LockedDependency,
  type LockedFile,
  type LockedPackage,
  type Sha256Digest,
  type WorkspaceLock,
} from './contract';
import { errorMessage, type WorkspaceReadResult } from './diagnostic';
import { normalizeLogicalPath } from './path';
import {
  exactSchemaRecord,
  findDuplicateName,
  readContractList,
  readContractVersion,
  readOptionalDigest,
  readPackageManifest,
  readPackageName,
  readRequiredDigest,
  readRootPath,
  readSchemaText,
  schemaFail,
  type SchemaRecordValue,
} from './schema';

const readLockedFile = (value: unknown): WorkspaceReadResult<LockedFile> => {
  if (!exactSchemaRecord(value, ['path', 'contentHash'])) {
    return schemaFail(
      'workspace.contract.lock_file',
      'Each locked file must contain exactly path and contentHash.',
    );
  }
  if (typeof value.path !== 'string') {
    return schemaFail('workspace.contract.path', 'Locked file path must be text.');
  }
  let path: string;
  try {
    path = normalizeLogicalPath(value.path);
  } catch (error) {
    return schemaFail(
      'workspace.contract.path',
      errorMessage(error, 'Locked file path is invalid.'),
    );
  }
  const contentHash = readRequiredDigest(
    value.contentHash,
    'locked_file.contentHash',
    'Locked file contentHash is required.',
  );
  if (!contentHash.ok) return contentHash;
  return { ok: true, value: Object.freeze({ path, contentHash: contentHash.value }) };
};

const readLockedDependency = (value: unknown): WorkspaceReadResult<LockedDependency> => {
  if (!exactSchemaRecord(value, ['name', 'contentHash', 'interfaceHash'])) {
    return schemaFail(
      'workspace.contract.lock_dependency',
      'Each locked dependency must contain exactly name, contentHash, interfaceHash.',
    );
  }
  const name = readPackageName(value.name, 'locked_dependency.name');
  if (!name.ok) return name;
  const contentHash = readRequiredDigest(
    value.contentHash,
    'locked_dependency.contentHash',
    'Locked dependency contentHash is required.',
  );
  if (!contentHash.ok) return contentHash;
  const interfaceHash = readRequiredDigest(
    value.interfaceHash,
    'locked_dependency.interfaceHash',
    'Locked dependency interfaceHash is required.',
  );
  if (!interfaceHash.ok) return interfaceHash;
  return {
    ok: true,
    value: Object.freeze({
      name: name.value,
      contentHash: contentHash.value,
      interfaceHash: interfaceHash.value,
    }),
  };
};

const readLockedPackageOrigin = (
  value: SchemaRecordValue,
): WorkspaceReadResult<{
  readonly source: 'workspace' | 'cas';
  readonly digest: Sha256Digest | null;
  readonly root: string;
}> => {
  if (value.source !== 'workspace' && value.source !== 'cas') {
    return schemaFail(
      'workspace.contract.lock_source',
      'Locked package source must be workspace or cas.',
    );
  }
  const packageDigest = readOptionalDigest(value.digest, 'locked_package.digest', true);
  if (!packageDigest.ok) return packageDigest;
  if (value.source === 'workspace' && packageDigest.value !== null) {
    return schemaFail(
      'workspace.contract.lock_source',
      'Workspace lock packages must not carry a CAS digest.',
    );
  }
  if (value.source === 'cas' && packageDigest.value === null) {
    return schemaFail(
      'workspace.contract.lock_source',
      'CAS lock packages need an embedded content digest.',
    );
  }
  const root = readRootPath(value.root, 'locked_package.root');
  if (!root.ok) return root;
  if (value.source === 'cas' && root.value === '') {
    return schemaFail(
      'workspace.contract.lock_root',
      'CAS packages need a non-empty embedded root.',
    );
  }
  return {
    ok: true,
    value: { source: value.source, digest: packageDigest.value, root: root.value },
  };
};

const readLockedPackageHashes = (
  value: SchemaRecordValue,
): WorkspaceReadResult<{
  readonly contentHash: Sha256Digest;
  readonly manifestHash: Sha256Digest;
  readonly interfaceHash: Sha256Digest;
}> => {
  const contentHash = readRequiredDigest(
    value.contentHash,
    'locked_package.contentHash',
    'Locked package contentHash is required.',
  );
  if (!contentHash.ok) return contentHash;
  const manifestHash = readRequiredDigest(
    value.manifestHash,
    'locked_package.manifestHash',
    'Locked package manifestHash is required.',
  );
  if (!manifestHash.ok) return manifestHash;
  const interfaceHash = readRequiredDigest(
    value.interfaceHash,
    'locked_package.interfaceHash',
    'Locked package interfaceHash is required.',
  );
  if (!interfaceHash.ok) return interfaceHash;
  return {
    ok: true,
    value: {
      contentHash: contentHash.value,
      manifestHash: manifestHash.value,
      interfaceHash: interfaceHash.value,
    },
  };
};

const checkLockedPackageDuplicates = (
  files: readonly LockedFile[],
  dependencies: readonly LockedDependency[],
): WorkspaceReadResult<never> | undefined => {
  const duplicateFile = findDuplicateName(
    files.map((file) => file.path),
    true,
  );
  if (duplicateFile !== undefined) {
    return schemaFail(
      'workspace.contract.duplicate_lock_file',
      `Duplicate or case-colliding locked file path: ${duplicateFile}.`,
    );
  }
  const duplicateDependency = findDuplicateName(
    dependencies.map((item) => item.name),
    true,
  );
  if (duplicateDependency !== undefined) {
    return schemaFail(
      'workspace.contract.duplicate_lock_dependency',
      `Duplicate locked dependency: ${duplicateDependency}.`,
    );
  }
  return undefined;
};

const readLockedPackage = (value: unknown): WorkspaceReadResult<LockedPackage> => {
  if (
    !exactSchemaRecord(value, [
      'name',
      'source',
      'digest',
      'root',
      'manifest',
      'contentHash',
      'manifestHash',
      'files',
      'interfaceHash',
      'dependencies',
    ])
  ) {
    return schemaFail(
      'workspace.contract.lock_package',
      'Locked packages use a closed package identity and embedded-content schema.',
    );
  }
  const name = readPackageName(value.name, 'locked_package.name');
  if (!name.ok) return name;
  const origin = readLockedPackageOrigin(value);
  if (!origin.ok) return origin;
  const manifest = readPackageManifest(value.manifest);
  if (!manifest.ok) return manifest;
  const hashes = readLockedPackageHashes(value);
  if (!hashes.ok) return hashes;
  const files = readContractList(value.files, 'locked_package.files', readLockedFile);
  if (!files.ok) return files;
  const dependencies = readContractList(
    value.dependencies,
    'locked_package.dependencies',
    readLockedDependency,
  );
  if (!dependencies.ok) return dependencies;
  const dup = checkLockedPackageDuplicates(files.value, dependencies.value);
  if (dup !== undefined) return dup;
  return {
    ok: true,
    value: Object.freeze({
      name: name.value,
      source: origin.value.source,
      digest: origin.value.digest,
      root: origin.value.root,
      manifest: manifest.value,
      contentHash: hashes.value.contentHash,
      manifestHash: hashes.value.manifestHash,
      files: Object.freeze(files.value.sort((a, b) => (a.path < b.path ? -1 : 1))),
      interfaceHash: hashes.value.interfaceHash,
      dependencies: Object.freeze(dependencies.value.sort((a, b) => (a.name < b.name ? -1 : 1))),
    }),
  };
};

/** Validates and freezes a workspace lock contract. */
export const readWorkspaceLock = (value: unknown): WorkspaceReadResult<WorkspaceLock> => {
  if (!exactSchemaRecord(value, ['format', 'version', 'compilerFingerprint', 'packages'])) {
    return schemaFail(
      'workspace.contract.lock',
      'Workspace locks have a closed format/version/compilerFingerprint/packages schema.',
    );
  }
  if (value.format !== ASHFOX_LOCK_FORMAT) {
    return schemaFail('workspace.contract.format', 'Workspace lock format is invalid.');
  }
  const lockVersion = readContractVersion(value.version, 'lock.version');
  if (!lockVersion.ok) return lockVersion;
  const fingerprint = readSchemaText(value.compilerFingerprint, 'lock.compilerFingerprint');
  if (!fingerprint.ok) return fingerprint;
  const packages = readContractList(value.packages, 'lock.packages', readLockedPackage);
  if (!packages.ok) return packages;
  const duplicatePackage = findDuplicateName(
    packages.value.map((pkg) => pkg.name),
    true,
  );
  if (duplicatePackage !== undefined) {
    return schemaFail(
      'workspace.contract.duplicate_lock_package',
      `Duplicate or case-colliding locked package: ${duplicatePackage}.`,
    );
  }
  return {
    ok: true,
    value: Object.freeze({
      format: ASHFOX_LOCK_FORMAT,
      version: 1,
      compilerFingerprint: fingerprint.value,
      packages: Object.freeze(packages.value.sort((a, b) => (a.name < b.name ? -1 : 1))),
    }),
  };
};
