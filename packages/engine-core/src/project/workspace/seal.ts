import { compareText } from '@ashfox/internal-contracts';
import { deepFreeze } from '../../immutable';
import type {
  AuthoredAssetWorkspace,
  LockedPackage,
  WorkspaceFile,
  WorkspaceManifest,
  WorkspaceModuleAbi,
  WorkspacePackage,
} from './contract';
import {
  errorDiagnostic,
  syntheticSourceRef,
  type WorkspaceDiagnostic,
  type WorkspaceReadResult,
} from './diagnostic';
import {
  computePackageContentHash,
  computePackageInterfaceHash,
  computePackageManifestHash,
  computeSourceContentHash,
} from './hash';
import {
  makeIndexes,
  parseWorkspaceSources,
  keyFor,
  sourcePath,
  type ParsedState,
} from './graphSource';
import type { WorkspaceLimits } from './limits';
import { readAuthoredAssetWorkspace } from './reader';
import { pathsForManifestPackage, validateWorkspaceStructure } from './validation';

const checkDeclaredDependencies = (
  packages: readonly (WorkspacePackage | LockedPackage)[],
): WorkspaceDiagnostic | undefined => {
  const names = new Set(packages.map((pkg) => pkg.name));
  for (const pkg of packages) {
    for (const dependency of pkg.manifest.dependencies) {
      if (!names.has(dependency.name)) {
        return errorDiagnostic(
          'workspace.lock.dependency_missing',
          `Package ${pkg.name} has no dependency ${dependency.name}.`,
          syntheticSourceRef('ashfox.workspace.json', pkg.name),
        );
      }
    }
  }
  return undefined;
};

const rootsOverlap = (left: string, right: string): boolean =>
  left === right ||
  left === '' ||
  right === '' ||
  left.startsWith(`${right}/`) ||
  right.startsWith(`${left}/`);

const checkCasImmutability = (
  embedded: readonly LockedPackage[],
  byPath: ReadonlyMap<string, WorkspaceFile>,
  original: ReadonlyMap<string, WorkspaceFile>,
  localPackages: readonly WorkspacePackage[],
): WorkspaceDiagnostic | undefined => {
  for (const pkg of embedded) {
    for (const locked of pkg.files) {
      if (byPath.get(locked.path)?.source !== original.get(locked.path)?.source) {
        return errorDiagnostic(
          'workspace.cas.immutable',
          `Embedded CAS file cannot be changed: ${locked.path}.`,
          syntheticSourceRef(locked.path, pkg.name),
        );
      }
    }
    const root = pkg.root.toLowerCase();
    for (const local of localPackages) {
      if (rootsOverlap(root, local.root.toLowerCase())) {
        return errorDiagnostic(
          'workspace.cas.immutable',
          `Local package root cannot take over CAS root ${pkg.root}.`,
          syntheticSourceRef('ashfox.workspace.json', local.name),
        );
      }
    }
  }
  return undefined;
};

const buildProvisionalLocalPackages = (
  packages: readonly WorkspacePackage[],
  byPath: ReadonlyMap<string, WorkspaceFile>,
): LockedPackage[] =>
  packages.map((pkg) => {
    const packageFiles = pathsForManifestPackage(pkg).map((path) => byPath.get(path)!);
    return {
      name: pkg.name,
      root: pkg.root,
      manifest: pkg.manifest,
      source: 'workspace',
      digest: null,
      contentHash: computePackageContentHash(pkg, packageFiles),
      manifestHash: computePackageManifestHash(pkg),
      interfaceHash: computePackageInterfaceHash(pkg),
      files: packageFiles.map((file) => ({
        path: file.path,
        contentHash: computeSourceContentHash(file.source),
      })),
      dependencies: [],
    };
  });

const attachModuleAbis = (
  local: readonly LockedPackage[],
  parsed: ReadonlyMap<string, ParsedState>,
): LockedPackage[] =>
  local.map((pkg) => {
    const abis: WorkspaceModuleAbi[] = pkg.manifest.modules.map((module) => {
      const abi = parsed.get(keyFor(pkg.name, sourcePath(pkg, module.path)))?.abi;
      if (abi === undefined) throw new TypeError('Parsed declared module omitted its ABI.');
      return { ...abi, subpath: module.subpath };
    });
    return { ...pkg, interfaceHash: computePackageInterfaceHash(pkg, abis) };
  });

const pinLocalDependencies = (
  withAbi: readonly LockedPackage[],
  embedded: readonly LockedPackage[],
): WorkspaceReadResult<readonly LockedPackage[]> => {
  const targets = new Map([...withAbi, ...embedded].map((pkg) => [pkg.name, pkg]));
  const sealed: LockedPackage[] = [];
  for (const pkg of withAbi) {
    const dependencies: LockedPackage['dependencies'][number][] = [];
    for (const dependency of pkg.manifest.dependencies) {
      const target = targets.get(dependency.name);
      if (target === undefined) {
        return {
          ok: false,
          diagnostics: [
            errorDiagnostic(
              'workspace.lock.dependency_missing',
              `Local package ${pkg.name} has no dependency ${dependency.name}.`,
              syntheticSourceRef('ashfox.workspace.json', pkg.name),
            ),
          ],
        };
      }
      dependencies.push({
        name: target.name,
        contentHash: target.contentHash,
        interfaceHash: target.interfaceHash,
      });
    }
    sealed.push({ ...pkg, dependencies });
  }
  return { ok: true, value: sealed };
};

/** Compiler-owned local metadata. Embedded content-addressed packages retain
 * their complete records and bytes; this is not a package installation API. */
export const sealWorkspaceCandidate = (
  base: AuthoredAssetWorkspace,
  files: readonly WorkspaceFile[],
  manifest: WorkspaceManifest,
  limits: WorkspaceLimits,
): WorkspaceReadResult<AuthoredAssetWorkspace> => {
  const embedded = base.lock.packages.filter((pkg) => pkg.source === 'cas');
  const candidate = { files, manifest, lock: { ...base.lock, packages: embedded } };
  const structural = validateWorkspaceStructure(candidate, limits);
  if (structural.length > 0) return { ok: false, diagnostics: structural };
  const depError = checkDeclaredDependencies([...manifest.packages, ...embedded]);
  if (depError !== undefined) return { ok: false, diagnostics: [depError] };
  const byPath = new Map(files.map((file) => [file.path, file]));
  const original = new Map(base.files.map((file) => [file.path, file]));
  const casError = checkCasImmutability(embedded, byPath, original, manifest.packages);
  if (casError !== undefined) return { ok: false, diagnostics: [casError] };
  // Provisional local indexes contain exact content hashes but no authoritative
  // ABI yet. They never escape; the canonical parser supplies every module ABI.
  const local = buildProvisionalLocalPackages(manifest.packages, byPath);
  const provisional = {
    ...candidate,
    lock: { ...candidate.lock, packages: [...local, ...embedded] },
  };
  const diagnostics: Parameters<typeof parseWorkspaceSources>[1] = [];
  const parsed = parseWorkspaceSources(makeIndexes(provisional), diagnostics, limits);
  if (diagnostics.length > 0 || parsed === undefined) return { ok: false, diagnostics };
  const withAbi = attachModuleAbis(local, parsed);
  const sealed = pinLocalDependencies(withAbi, embedded);
  if (!sealed.ok) return sealed;
  return readAuthoredAssetWorkspace(
    deepFreeze({
      ...candidate,
      lock: {
        ...candidate.lock,
        packages: [...sealed.value, ...embedded].sort((a, b) => compareText(a.name, b.name)),
      },
    }),
    { limits },
  );
};
