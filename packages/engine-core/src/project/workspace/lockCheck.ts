import { canonicalJsonString } from '../../canonicalJson';

import {
  type LockedDependency,
  type LockedFile,
  type LockedPackage,
  type WorkspaceFile,
  type WorkspacePackage,
} from './contract';
import { errorDiagnostic, syntheticSourceRef, type WorkspaceDiagnostic } from './diagnostic';
import {
  computePackageContentHash,
  computePackageManifestHash,
  computeSourceContentHash,
} from './hash';
import { joinLogicalPath } from './path';
import type { WorkspaceLimits } from './limits';

export interface WorkspacePackageView {
  readonly name: string;
  readonly root: string;
  readonly manifest: WorkspacePackage['manifest'];
  readonly source: 'workspace' | 'cas';
}

export interface ValidationState {
  readonly diagnostics: WorkspaceDiagnostic[];
  readonly limits: WorkspaceLimits;
}

const manifestRef = syntheticSourceRef('ashfox.workspace.json');

export const pathsForManifestPackage = (
  pkg: Pick<WorkspacePackageView, 'root' | 'manifest'>,
): readonly string[] => [
  ...pkg.manifest.entries.map((entry) => joinLogicalPath(pkg.root, entry.path)),
  ...pkg.manifest.modules.map((module) => joinLogicalPath(pkg.root, module.path)),
];

export const addValidationDiagnostic = (
  state: ValidationState,
  diagnostic: WorkspaceDiagnostic,
): boolean => {
  if (state.diagnostics.length >= state.limits.maxDiagnostics) return false;
  state.diagnostics.push(diagnostic);
  return true;
};

/** Emits a manifest-scoped diagnostic when `failed`; false only when the budget is exhausted. */
export const enforceValidationRule = (
  state: ValidationState,
  failed: boolean,
  code: string,
  message: string,
): boolean =>
  !failed || addValidationDiagnostic(state, errorDiagnostic(code, message, manifestRef));

const lockFilesMatch = (
  lockFiles: readonly LockedFile[],
  filesByPath: ReadonlyMap<string, WorkspaceFile>,
  expectedPaths: readonly string[],
): boolean => {
  if (lockFiles.length !== expectedPaths.length) return false;
  const expected = new Set(expectedPaths);
  if (new Set(lockFiles.map((file) => file.path)).size !== lockFiles.length) return false;
  for (const locked of lockFiles) {
    const file = filesByPath.get(locked.path);
    if (
      file === undefined ||
      !expected.has(locked.path) ||
      computeSourceContentHash(file.source) !== locked.contentHash
    ) {
      return false;
    }
  }
  return lockFiles.every((file) => expected.has(file.path));
};

const checkDependencyPin = (
  pkg: WorkspacePackageView,
  dependency: LockedDependency,
  packageNames: ReadonlySet<string>,
  locks: ReadonlyMap<string, LockedPackage>,
  state: ValidationState,
): boolean => {
  const target = locks.get(dependency.name);
  if (target === undefined || (!packageNames.has(dependency.name) && target.source !== 'cas')) {
    return addValidationDiagnostic(
      state,
      errorDiagnostic(
        'workspace.lock.dependency_missing',
        `Lock dependency ${dependency.name} of ${pkg.name} has no target package.`,
        manifestRef,
      ),
    );
  }
  if (
    target.contentHash !== dependency.contentHash ||
    target.interfaceHash !== dependency.interfaceHash
  ) {
    return addValidationDiagnostic(
      state,
      errorDiagnostic(
        'workspace.lock.dependency_stale',
        `Dependency pin ${pkg.name} -> ${dependency.name} is stale.`,
        manifestRef,
      ),
    );
  }
  return true;
};

const checkDependencyPins = (
  packages: readonly WorkspacePackageView[],
  locks: ReadonlyMap<string, LockedPackage>,
  state: ValidationState,
): boolean => {
  const packageNames = new Set(packages.map((pkg) => pkg.name));
  for (const pkg of packages) {
    const lock = locks.get(pkg.name);
    if (lock === undefined) continue;
    const declared = pkg.manifest.dependencies.map((dependency) => dependency.name);
    const pinned = lock.dependencies.map((dependency) => dependency.name);
    const mismatch =
      declared.length !== pinned.length || declared.some((name) => !pinned.includes(name));
    if (
      !enforceValidationRule(
        state,
        mismatch,
        'workspace.lock.dependency_set',
        `Dependency pins for ${pkg.name} do not match its manifest.`,
      )
    ) {
      return false;
    }
    for (const dependency of lock.dependencies) {
      if (!checkDependencyPin(pkg, dependency, packageNames, locks, state)) return false;
    }
  }
  return true;
};

const checkPackageLock = (
  pkg: WorkspacePackageView,
  lock: LockedPackage,
  filesByPath: ReadonlyMap<string, WorkspaceFile>,
  state: ValidationState,
): boolean => {
  const paths = pathsForManifestPackage(pkg);
  const packageFiles = paths
    .map((path) => filesByPath.get(path))
    .filter((file): file is WorkspaceFile => file !== undefined);
  const manifestMismatch =
    lock.root !== pkg.root ||
    canonicalJsonString(lock.manifest) !== canonicalJsonString(pkg.manifest);
  if (
    !enforceValidationRule(
      state,
      manifestMismatch,
      'workspace.lock.stale_manifest',
      `Lock manifest for ${pkg.name} does not match its package manifest.`,
    )
  ) {
    return false;
  }
  const identity = { name: pkg.name, root: pkg.root, manifest: pkg.manifest };
  const expectedManifestHash = computePackageManifestHash(identity);
  const expectedContentHash = computePackageContentHash(identity, packageFiles);
  return (
    enforceValidationRule(
      state,
      lock.manifestHash !== expectedManifestHash,
      'workspace.lock.stale_manifest',
      `Manifest digest for ${pkg.name} is stale.`,
    ) &&
    enforceValidationRule(
      state,
      lock.contentHash !== expectedContentHash,
      'workspace.lock.stale_content',
      `Content digest for ${pkg.name} is stale.`,
    ) &&
    enforceValidationRule(
      state,
      !lockFilesMatch(lock.files, filesByPath, paths),
      'workspace.lock.stale_file',
      `File digests for ${pkg.name} are stale or incomplete.`,
    ) &&
    enforceValidationRule(
      state,
      lock.source === 'cas' && (lock.digest === null || lock.digest !== lock.contentHash),
      'workspace.lock.cas_digest',
      `CAS package ${pkg.name} digest must equal its content hash.`,
    )
  );
};

/** Verifies lock records, file hashes, CAS digests, and dependency pins for every package. */
export const checkLockIntegrity = (
  packageViews: readonly WorkspacePackageView[],
  locks: ReadonlyMap<string, LockedPackage>,
  filesByPath: ReadonlyMap<string, WorkspaceFile>,
  state: ValidationState,
): boolean => {
  for (const pkg of packageViews) {
    const lock = locks.get(pkg.name);
    if (lock === undefined) {
      const ok = addValidationDiagnostic(
        state,
        errorDiagnostic(
          'workspace.lock.missing',
          `Package ${pkg.name} has no lock record.`,
          manifestRef,
        ),
      );
      if (!ok) return false;
      continue;
    }
    if (!checkPackageLock(pkg, lock, filesByPath, state)) return false;
  }
  return checkDependencyPins(packageViews, locks, state);
};
