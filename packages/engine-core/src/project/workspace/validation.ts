import {
  type AuthoredAssetWorkspace,
  type LockedPackage,
  type WorkspaceFile,
  type WorkspacePackage,
} from './contract';
import {
  errorDiagnostic,
  errorMessage,
  sortWorkspaceDiagnostics,
  syntheticSourceRef,
  type WorkspaceDiagnostic,
} from './diagnostic';
import { resolveWorkspaceLimits, type WorkspaceLimitsOverride } from './limits';
import { assertUniqueLogicalPaths, assertWellFormedSourceText, sourceByteLength } from './path';
import {
  addValidationDiagnostic,
  checkLockIntegrity,
  enforceValidationRule,
  pathsForManifestPackage,
  type ValidationState,
  type WorkspacePackageView,
} from './lockCheck';

export { pathsForManifestPackage, type WorkspacePackageView } from './lockCheck';

const manifestRef = syntheticSourceRef('ashfox.workspace.json');

export const workspacePackageFromLock = (pkg: LockedPackage): WorkspacePackageView => ({
  name: pkg.name,
  root: pkg.root,
  manifest: pkg.manifest,
  source: pkg.source,
});

export const workspacePackageFromManifest = (pkg: WorkspacePackage): WorkspacePackageView => ({
  name: pkg.name,
  root: pkg.root,
  manifest: pkg.manifest,
  source: 'workspace',
});

const asciiFold = (value: string): string =>
  value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());

const rootsOverlap = (left: WorkspacePackageView, right: WorkspacePackageView): boolean => {
  const same =
    left.root === right.root ||
    (left.root.length > 0 && asciiFold(left.root) === asciiFold(right.root));
  const nested =
    left.root.length === 0
      ? right.root.length > 0
      : right.root === left.root || right.root.startsWith(`${left.root}/`);
  return same || nested;
};

const addPackageRootFindings = (
  packages: readonly WorkspacePackageView[],
  state: ValidationState,
): boolean => {
  const roots = [...packages].sort(
    (left, right) => left.root.length - right.root.length || (left.root < right.root ? -1 : 1),
  );
  for (let index = 0; index < roots.length; index += 1) {
    for (let next = index + 1; next < roots.length; next += 1) {
      const left = roots[index]!;
      const right = roots[next]!;
      if (!rootsOverlap(left, right)) continue;
      const ok = addValidationDiagnostic(
        state,
        errorDiagnostic(
          'workspace.package.overlap',
          `Package roots overlap: ${left.root || '<workspace>'} and ${right.root || '<workspace>'}.`,
          manifestRef,
        ),
      );
      if (!ok) return false;
    }
  }
  return true;
};

const checkUniquePaths = (files: readonly WorkspaceFile[], state: ValidationState): boolean => {
  try {
    assertUniqueLogicalPaths(files.map((file) => file.path));
    return true;
  } catch (error) {
    return addValidationDiagnostic(
      state,
      errorDiagnostic(
        'workspace.file.duplicate',
        errorMessage(error, 'Duplicate logical file path.'),
        manifestRef,
      ),
    );
  }
};

const collectLockedPackageView = (
  locked: LockedPackage,
  manifestPackages: readonly WorkspacePackage[],
  packageViews: WorkspacePackageView[],
  state: ValidationState,
): boolean => {
  const existing = manifestPackages.find((pkg) => pkg.name === locked.name);
  if (locked.source === 'workspace' && existing === undefined) {
    return addValidationDiagnostic(
      state,
      errorDiagnostic(
        'workspace.lock.extra',
        `Lock contains an unlisted workspace package: ${locked.name}.`,
        manifestRef,
      ),
    );
  }
  if (locked.source === 'cas' && existing === undefined) {
    packageViews.push(workspacePackageFromLock(locked));
  }
  if (existing !== undefined && locked.source === 'cas') {
    return addValidationDiagnostic(
      state,
      errorDiagnostic(
        'workspace.lock.mixed_source',
        `Package ${locked.name} is both workspace and CAS.`,
        manifestRef,
      ),
    );
  }
  return true;
};

const collectPackageViews = (
  workspace: Pick<AuthoredAssetWorkspace, 'manifest' | 'lock'>,
  state: ValidationState,
): readonly WorkspacePackageView[] | undefined => {
  const packageViews: WorkspacePackageView[] = workspace.manifest.packages.map(
    workspacePackageFromManifest,
  );
  for (const locked of workspace.lock.packages) {
    if (!collectLockedPackageView(locked, workspace.manifest.packages, packageViews, state)) {
      return undefined;
    }
  }
  return packageViews;
};

const checkPackageBudgets = (
  filesCount: number,
  packageViews: readonly WorkspacePackageView[],
  state: ValidationState,
): boolean => {
  const { limits } = state;
  const entries = packageViews.reduce((sum, pkg) => sum + pkg.manifest.entries.length, 0);
  const modules = packageViews.reduce((sum, pkg) => sum + pkg.manifest.modules.length, 0);
  return (
    enforceValidationRule(
      state,
      packageViews.length > limits.maxPackages,
      'workspace.budget.packages',
      `Workspace contains more than ${limits.maxPackages} packages.`,
    ) &&
    enforceValidationRule(
      state,
      entries > limits.maxEntries,
      'workspace.budget.entries',
      `Workspace contains more than ${limits.maxEntries} entries.`,
    ) &&
    enforceValidationRule(
      state,
      modules > limits.maxModules,
      'workspace.budget.modules',
      `Workspace contains more than ${limits.maxModules} modules.`,
    ) &&
    enforceValidationRule(
      state,
      filesCount > limits.maxFiles,
      'workspace.budget.files',
      `Workspace contains more than ${limits.maxFiles} files.`,
    )
  );
};

const checkWorkspaceSources = (
  files: readonly WorkspaceFile[],
  state: ValidationState,
): boolean => {
  const { limits } = state;
  let sourceCodeUnits = 0;
  let sourceBytes = 0;
  for (const file of files) {
    try {
      assertWellFormedSourceText(file.source);
      sourceCodeUnits += file.source.length;
      sourceBytes += sourceByteLength(file.source);
    } catch (error) {
      const ok = addValidationDiagnostic(
        state,
        errorDiagnostic(
          'workspace.file.utf8',
          errorMessage(error, `Invalid source: ${file.path}.`),
          syntheticSourceRef(file.path),
        ),
      );
      if (!ok) return false;
    }
    if (sourceCodeUnits > limits.maxSourceCodeUnits || sourceBytes > limits.maxSourceBytes) break;
  }
  return (
    enforceValidationRule(
      state,
      sourceCodeUnits > limits.maxSourceCodeUnits,
      'workspace.budget.source_code_units',
      `Workspace source exceeds ${limits.maxSourceCodeUnits} UTF-16 code units.`,
    ) &&
    enforceValidationRule(
      state,
      sourceBytes > limits.maxSourceBytes,
      'workspace.budget.source_bytes',
      `Workspace source exceeds ${limits.maxSourceBytes} UTF-8 bytes.`,
    )
  );
};

const checkDeclaredFiles = (
  files: readonly WorkspaceFile[],
  packageViews: readonly WorkspacePackageView[],
  state: ValidationState,
): ReadonlyMap<string, WorkspaceFile> | undefined => {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const expectedPaths = new Set<string>();
  for (const pkg of packageViews) {
    for (const path of pathsForManifestPackage(pkg)) expectedPaths.add(path);
  }
  for (const file of files) {
    if (expectedPaths.has(file.path)) continue;
    const ok = addValidationDiagnostic(
      state,
      errorDiagnostic(
        'workspace.file.undeclared',
        `Source file is not declared by a package manifest: ${file.path}.`,
        syntheticSourceRef(file.path),
      ),
    );
    if (!ok) return undefined;
  }
  for (const path of expectedPaths) {
    if (filesByPath.has(path)) continue;
    const ok = addValidationDiagnostic(
      state,
      errorDiagnostic(
        'workspace.file.missing',
        `Declared source file is missing from workspace files: ${path}.`,
        syntheticSourceRef(path),
      ),
    );
    if (!ok) return undefined;
  }
  return filesByPath;
};

const validateContents = (
  workspace: Pick<AuthoredAssetWorkspace, 'files' | 'manifest' | 'lock'>,
  override: WorkspaceLimitsOverride | undefined,
  integrity: boolean,
): readonly WorkspaceDiagnostic[] => {
  const resolved = resolveWorkspaceLimits(override);
  if (!resolved.ok) {
    return [errorDiagnostic('workspace.budget.invalid', resolved.message, manifestRef)];
  }
  const state: ValidationState = { diagnostics: [], limits: resolved.limits };
  if (!checkUniquePaths(workspace.files, state)) return state.diagnostics;
  const packageViews = collectPackageViews(workspace, state);
  if (packageViews === undefined) return state.diagnostics;
  if (!checkPackageBudgets(workspace.files.length, packageViews, state)) return state.diagnostics;
  if (!checkWorkspaceSources(workspace.files, state)) return state.diagnostics;
  if (!addPackageRootFindings(packageViews, state)) return state.diagnostics;
  const filesByPath = checkDeclaredFiles(workspace.files, packageViews, state);
  if (filesByPath === undefined) return state.diagnostics;

  // Candidate structure and budgets must be accepted before parsing bytes or
  // deriving a new local lock. Persisted authority always checks integrity.
  if (!integrity) return sortWorkspaceDiagnostics(state.diagnostics);
  const locks = new Map(workspace.lock.packages.map((pkg) => [pkg.name, pkg]));
  if (!checkLockIntegrity(packageViews, locks, filesByPath, state)) return state.diagnostics;
  return sortWorkspaceDiagnostics(state.diagnostics);
};

export const validateWorkspaceContents = (
  workspace: Pick<AuthoredAssetWorkspace, 'files' | 'manifest' | 'lock'>,
  override?: WorkspaceLimitsOverride,
): readonly WorkspaceDiagnostic[] => validateContents(workspace, override, true);

/** Internal pre-seal gate. Local lock records may be absent, never CAS records. */
export const validateWorkspaceStructure = (
  workspace: Pick<AuthoredAssetWorkspace, 'files' | 'manifest' | 'lock'>,
  override?: WorkspaceLimitsOverride,
): readonly WorkspaceDiagnostic[] => validateContents(workspace, override, false);
