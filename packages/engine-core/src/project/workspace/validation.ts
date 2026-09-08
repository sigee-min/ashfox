import { canonicalJsonString } from '../../canonicalJson';

import {
  type AuthoredAssetWorkspace,
  type LockedFile,
  type LockedPackage,
  type WorkspaceFile,
  type WorkspacePackage
} from './contract';
import {
  errorDiagnostic,
  sortWorkspaceDiagnostics,
  syntheticSourceRef,
  type WorkspaceDiagnostic
} from './diagnostic';
import {
  withWorkspaceLimits,
  type WorkspaceLimits,
  type WorkspaceLimitsOverride
} from './limits';
import {
  assertUniqueLogicalPaths,
  assertWellFormedSourceText,
  joinLogicalPath,
  sourceByteLength
} from './path';
import {
  computePackageContentHash,
  computePackageManifestHash,
  computeSourceContentHash
} from './hash';

export interface WorkspacePackageView {
  readonly name: string;
  readonly root: string;
  readonly manifest: WorkspacePackage['manifest'];
  readonly source: 'workspace' | 'cas';
}

export const workspacePackageFromLock = (
  pkg: LockedPackage
): WorkspacePackageView => ({
  name: pkg.name,
  root: pkg.root,
  manifest: pkg.manifest,
  source: pkg.source
});

export const workspacePackageFromManifest = (
  pkg: WorkspacePackage
): WorkspacePackageView => ({
  name: pkg.name,
  root: pkg.root,
  manifest: pkg.manifest,
  source: 'workspace'
});

export const pathsForManifestPackage = (
  pkg: Pick<WorkspacePackageView, 'root' | 'manifest'>
): readonly string[] => [
  ...pkg.manifest.entries.map((entry) => joinLogicalPath(pkg.root, entry.path)),
  ...pkg.manifest.modules.map((module) => joinLogicalPath(pkg.root, module.path))
];

const asciiFold = (value: string): string => value.replace(/[A-Z]/gu,
  (letter) => letter.toLowerCase());

const add = (
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits,
  diagnostic: WorkspaceDiagnostic
): boolean => {
  if (diagnostics.length >= limits.maxDiagnostics) return false;
  diagnostics.push(diagnostic);
  return true;
};

const lockFilesMatch = (
  lockFiles: readonly LockedFile[],
  filesByPath: ReadonlyMap<string, WorkspaceFile>,
  expectedPaths: readonly string[]
): boolean => {
  if (lockFiles.length !== expectedPaths.length) return false;
  const expected = new Set(expectedPaths);
  if (new Set(lockFiles.map((file) => file.path)).size !== lockFiles.length) return false;
  for (const locked of lockFiles) {
    const file = filesByPath.get(locked.path);
    if (file === undefined || !expected.has(locked.path) ||
        computeSourceContentHash(file.source) !== locked.contentHash) return false;
  }
  return lockFiles.every((file) => expected.has(file.path));
};

const addPackageRootFindings = (
  packages: readonly WorkspacePackageView[],
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits
): boolean => {
  const roots = [...packages].sort((left, right) =>
    left.root.length - right.root.length || (left.root < right.root ? -1 : 1));
  for (let index = 0; index < roots.length; index += 1) {
    for (let next = index + 1; next < roots.length; next += 1) {
      const left = roots[index];
      const right = roots[next];
      const same = left.root === right.root ||
        (left.root.length > 0 && asciiFold(left.root) === asciiFold(right.root));
      const nested = left.root.length === 0
        ? right.root.length > 0
        : right.root === left.root || right.root.startsWith(`${left.root}/`);
      if (same || nested) {
        if (!add(diagnostics, limits, errorDiagnostic('workspace.package.overlap',
          `Package roots overlap: ${left.root || '<workspace>'} and ${right.root || '<workspace>'}.`,
          syntheticSourceRef('ashfox.workspace.json')))) return false;
      }
    }
  }
  return true;
};

const checkDependencyPins = (
  packages: readonly WorkspacePackageView[],
  locks: ReadonlyMap<string, LockedPackage>,
  diagnostics: WorkspaceDiagnostic[],
  limits: WorkspaceLimits
): boolean => {
  const packageNames = new Set(packages.map((pkg) => pkg.name));
  for (const pkg of packages) {
    const lock = locks.get(pkg.name);
    if (lock === undefined) continue;
    const declared = pkg.manifest.dependencies.map((dependency) => dependency.name);
    const pinned = lock.dependencies.map((dependency) => dependency.name);
    if (declared.length !== pinned.length ||
        declared.some((name) => !pinned.includes(name))) {
      if (!add(diagnostics, limits, errorDiagnostic('workspace.lock.dependency_set',
        `Dependency pins for ${pkg.name} do not match its manifest.`,
        syntheticSourceRef('ashfox.workspace.json')))) return false;
    }
    for (const dependency of lock.dependencies) {
      const target = locks.get(dependency.name);
      if (target === undefined ||
          (!packageNames.has(dependency.name) && target.source !== 'cas')) {
        if (!add(diagnostics, limits, errorDiagnostic('workspace.lock.dependency_missing',
          `Lock dependency ${dependency.name} of ${pkg.name} has no target package.`,
          syntheticSourceRef('ashfox.workspace.json')))) return false;
        continue;
      }
      if (target.contentHash !== dependency.contentHash ||
          target.interfaceHash !== dependency.interfaceHash) {
        if (!add(diagnostics, limits, errorDiagnostic('workspace.lock.dependency_stale',
          `Dependency pin ${pkg.name} -> ${dependency.name} is stale.`,
          syntheticSourceRef('ashfox.workspace.json')))) return false;
      }
    }
  }
  return true;
};

const validateContents = (
  workspace: Pick<AuthoredAssetWorkspace, 'files' | 'manifest' | 'lock'>,
  override: WorkspaceLimitsOverride | undefined,
  integrity: boolean
): readonly WorkspaceDiagnostic[] => {
  let limits: WorkspaceLimits;
  try {
    limits = withWorkspaceLimits(override);
  } catch (error) {
    return [errorDiagnostic('workspace.budget.invalid',
      error instanceof Error ? error.message : 'Workspace limits are invalid.',
      syntheticSourceRef('ashfox.workspace.json'))];
  }
  const diagnostics: WorkspaceDiagnostic[] = [];
  const push = (diagnostic: WorkspaceDiagnostic): boolean =>
    add(diagnostics, limits, diagnostic);
  try {
    assertUniqueLogicalPaths(workspace.files.map((file) => file.path));
  } catch (error) {
    if (!push(errorDiagnostic('workspace.file.duplicate',
      error instanceof Error ? error.message : 'Duplicate logical file path.',
      syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
  }
  const packageViews: WorkspacePackageView[] = workspace.manifest.packages.map(
    workspacePackageFromManifest
  );
  const locks = new Map(workspace.lock.packages.map((pkg) => [pkg.name, pkg]));
  for (const locked of workspace.lock.packages) {
    const existing = workspace.manifest.packages.find((pkg) => pkg.name === locked.name);
    if (locked.source === 'workspace' && existing === undefined) {
      if (!push(errorDiagnostic('workspace.lock.extra',
        `Lock contains an unlisted workspace package: ${locked.name}.`,
        syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
    }
    if (locked.source === 'cas' && existing === undefined) {
      packageViews.push(workspacePackageFromLock(locked));
    }
    if (existing !== undefined && locked.source === 'cas') {
      if (!push(errorDiagnostic('workspace.lock.mixed_source',
        `Package ${locked.name} is both workspace and CAS.`,
        syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
    }
  }
  if (packageViews.length > limits.maxPackages) {
    if (!push(errorDiagnostic('workspace.budget.packages',
      `Workspace contains more than ${limits.maxPackages} packages.`,
      syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
  }
  const entries = packageViews.reduce((sum, pkg) => sum + pkg.manifest.entries.length, 0);
  const modules = packageViews.reduce((sum, pkg) => sum + pkg.manifest.modules.length, 0);
  if (entries > limits.maxEntries && !push(errorDiagnostic('workspace.budget.entries',
    `Workspace contains more than ${limits.maxEntries} entries.`,
    syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
  if (modules > limits.maxModules && !push(errorDiagnostic('workspace.budget.modules',
    `Workspace contains more than ${limits.maxModules} modules.`,
    syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
  if (workspace.files.length > limits.maxFiles && !push(errorDiagnostic('workspace.budget.files',
    `Workspace contains more than ${limits.maxFiles} files.`,
    syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
  let sourceCodeUnits = 0;
  let sourceBytes = 0;
  for (const file of workspace.files) {
    try {
      assertWellFormedSourceText(file.source);
      sourceCodeUnits += file.source.length;
      sourceBytes += sourceByteLength(file.source);
    } catch (error) {
      if (!push(errorDiagnostic('workspace.file.utf8',
        error instanceof Error ? error.message : `Invalid source: ${file.path}.`,
        syntheticSourceRef(file.path)))) return diagnostics;
    }
    if (sourceCodeUnits > limits.maxSourceCodeUnits || sourceBytes > limits.maxSourceBytes) break;
  }
  if (sourceCodeUnits > limits.maxSourceCodeUnits && !push(errorDiagnostic(
    'workspace.budget.source_code_units',
    `Workspace source exceeds ${limits.maxSourceCodeUnits} UTF-16 code units.`,
    syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
  if (sourceBytes > limits.maxSourceBytes && !push(errorDiagnostic(
    'workspace.budget.source_bytes',
    `Workspace source exceeds ${limits.maxSourceBytes} UTF-8 bytes.`,
    syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
  if (!addPackageRootFindings(packageViews, diagnostics, limits)) return diagnostics;

  const filesByPath = new Map(workspace.files.map((file) => [file.path, file]));
  const expectedPaths = new Set<string>();
  for (const pkg of packageViews) {
    for (const path of pathsForManifestPackage(pkg)) expectedPaths.add(path);
  }
  for (const file of workspace.files) {
    if (!expectedPaths.has(file.path) && !push(errorDiagnostic('workspace.file.undeclared',
      `Source file is not declared by a package manifest: ${file.path}.`,
      syntheticSourceRef(file.path)))) return diagnostics;
  }
  for (const path of expectedPaths) {
    if (!filesByPath.has(path) && !push(errorDiagnostic('workspace.file.missing',
      `Declared source file is missing from workspace files: ${path}.`,
      syntheticSourceRef(path)))) return diagnostics;
  }

  // Candidate structure and budgets must be accepted before parsing bytes or
  // deriving a new local lock. Persisted authority always checks integrity.
  if (!integrity) return sortWorkspaceDiagnostics(diagnostics);

  for (const pkg of packageViews) {
    const lock = locks.get(pkg.name);
    if (lock === undefined) {
      if (!push(errorDiagnostic('workspace.lock.missing',
        `Package ${pkg.name} has no lock record.`, syntheticSourceRef('ashfox.workspace.json')))) {
        return diagnostics;
      }
      continue;
    }
    const paths = pathsForManifestPackage(pkg);
    const packageFiles = paths.map((path) => filesByPath.get(path))
      .filter((file): file is WorkspaceFile => file !== undefined);
    if (lock.root !== pkg.root ||
        canonicalJsonString(lock.manifest) !== canonicalJsonString(pkg.manifest)) {
      if (!push(errorDiagnostic('workspace.lock.stale_manifest',
        `Lock manifest for ${pkg.name} does not match its package manifest.`,
        syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
    }
    const expectedManifestHash = computePackageManifestHash({
      name: pkg.name, root: pkg.root, manifest: pkg.manifest
    });
    const expectedContentHash = computePackageContentHash({
      name: pkg.name, root: pkg.root, manifest: pkg.manifest
    }, packageFiles);
    if (lock.manifestHash !== expectedManifestHash && !push(errorDiagnostic(
      'workspace.lock.stale_manifest', `Manifest digest for ${pkg.name} is stale.`,
      syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
    if (lock.contentHash !== expectedContentHash && !push(errorDiagnostic(
      'workspace.lock.stale_content', `Content digest for ${pkg.name} is stale.`,
      syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
    if (!lockFilesMatch(lock.files, filesByPath, paths) && !push(errorDiagnostic(
      'workspace.lock.stale_file', `File digests for ${pkg.name} are stale or incomplete.`,
      syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
    if (lock.source === 'cas' && (lock.digest === null || lock.digest !== lock.contentHash)) {
      if (!push(errorDiagnostic('workspace.lock.cas_digest',
        `CAS package ${pkg.name} digest must equal its content hash.`,
        syntheticSourceRef('ashfox.workspace.json')))) return diagnostics;
    }
  }
  if (!checkDependencyPins(packageViews, locks, diagnostics, limits)) return diagnostics;
  return sortWorkspaceDiagnostics(diagnostics);
};

export const validateWorkspaceContents = (
  workspace: Pick<AuthoredAssetWorkspace, 'files' | 'manifest' | 'lock'>,
  override?: WorkspaceLimitsOverride
): readonly WorkspaceDiagnostic[] => validateContents(workspace, override, true);

/** Internal pre-seal gate. Local lock records may be absent, never CAS records. */
export const validateWorkspaceStructure = (
  workspace: Pick<AuthoredAssetWorkspace, 'files' | 'manifest' | 'lock'>,
  override?: WorkspaceLimitsOverride
): readonly WorkspaceDiagnostic[] => validateContents(workspace, override, false);
