import { deepFreeze } from '../../immutable';
import type {
  AuthoredAssetWorkspace, LockedPackage, WorkspaceFile, WorkspaceManifest, WorkspaceModuleAbi
} from './contract';
import { errorDiagnostic, syntheticSourceRef, type WorkspaceReadResult } from './diagnostic';
import {
  computePackageContentHash, computePackageInterfaceHash,
  computePackageManifestHash, computeSourceContentHash
} from './hash';
import { makeIndexes, parseWorkspaceSources, keyFor, sourcePath } from './graphSource';
import type { WorkspaceLimits } from './limits';
import { readAuthoredAssetWorkspace } from './reader';
import { pathsForManifestPackage, validateWorkspaceStructure } from './validation';

/** Compiler-owned local metadata. Embedded content-addressed packages retain
 * their complete records and bytes; this is not a package installation API. */
export const sealWorkspaceCandidate = (
  base: AuthoredAssetWorkspace,
  files: readonly WorkspaceFile[],
  manifest: WorkspaceManifest,
  limits: WorkspaceLimits
): WorkspaceReadResult<AuthoredAssetWorkspace> => {
  const embedded = base.lock.packages.filter((pkg) => pkg.source === 'cas');
  const candidate = { files, manifest, lock: { ...base.lock, packages: embedded } };
  const structural = validateWorkspaceStructure(candidate, limits);
  if (structural.length > 0) return { ok: false, diagnostics: structural };
  const packages = [...manifest.packages, ...embedded];
  const names = new Set(packages.map((pkg) => pkg.name));
  for (const pkg of packages) for (const dependency of pkg.manifest.dependencies) {
    if (!names.has(dependency.name)) return { ok: false, diagnostics: [errorDiagnostic(
      'workspace.lock.dependency_missing', `Package ${pkg.name} has no dependency ${dependency.name}.`,
      syntheticSourceRef('ashfox.workspace.json', pkg.name))] };
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  const original = new Map(base.files.map((file) => [file.path, file]));
  for (const pkg of embedded) {
    for (const locked of pkg.files) if (byPath.get(locked.path)?.source !== original.get(locked.path)?.source) {
      return { ok: false, diagnostics: [errorDiagnostic('workspace.cas.immutable',
        `Embedded CAS file cannot be changed: ${locked.path}.`, syntheticSourceRef(locked.path, pkg.name))] };
    }
    const root = pkg.root.toLowerCase();
    for (const local of manifest.packages) {
      const other = local.root.toLowerCase();
      if (root === other || root === '' || other === '' || root.startsWith(other + '/') ||
        other.startsWith(root + '/')) return { ok: false, diagnostics: [errorDiagnostic(
        'workspace.cas.immutable', `Local package root cannot take over CAS root ${pkg.root}.`,
        syntheticSourceRef('ashfox.workspace.json', local.name))] };
    }
  }
  // Provisional local indexes contain exact content hashes but no authoritative
  // ABI yet. They never escape; the canonical parser supplies every module ABI.
  const local: LockedPackage[] = manifest.packages.map((pkg) => {
    const packageFiles = pathsForManifestPackage(pkg).map((path) => byPath.get(path)!);
    return { name: pkg.name, root: pkg.root, manifest: pkg.manifest,
      source: 'workspace', digest: null,
      contentHash: computePackageContentHash(pkg, packageFiles),
      manifestHash: computePackageManifestHash(pkg),
      interfaceHash: computePackageInterfaceHash(pkg),
      files: packageFiles.map((file) => ({ path: file.path, contentHash: computeSourceContentHash(file.source) })),
      dependencies: [] };
  });
  const provisional = { ...candidate, lock: { ...candidate.lock, packages: [...local, ...embedded] } };
  const diagnostics: Parameters<typeof parseWorkspaceSources>[1] = [];
  const parsed = parseWorkspaceSources(makeIndexes(provisional), diagnostics, limits);
  if (diagnostics.length > 0 || parsed === undefined) return { ok: false, diagnostics };
  const withAbi = local.map((pkg): LockedPackage => {
    const abis: WorkspaceModuleAbi[] = pkg.manifest.modules.map((module) => {
      const abi = parsed.get(keyFor(pkg.name, sourcePath(pkg, module.path)))?.abi;
      if (abi === undefined) throw new TypeError('Parsed declared module omitted its ABI.');
      return { ...abi, subpath: module.subpath };
    });
    return { ...pkg, interfaceHash: computePackageInterfaceHash(pkg, abis) };
  });
  const targets = new Map([...withAbi, ...embedded].map((pkg) => [pkg.name, pkg]));
  const sealed: LockedPackage[] = [];
  for (const pkg of withAbi) {
    const dependencies: LockedPackage['dependencies'][number][] = [];
    for (const dependency of pkg.manifest.dependencies) {
      const target = targets.get(dependency.name);
      if (target === undefined) return { ok: false, diagnostics: [errorDiagnostic(
        'workspace.lock.dependency_missing', `Local package ${pkg.name} has no dependency ${dependency.name}.`,
        syntheticSourceRef('ashfox.workspace.json', pkg.name))] };
      dependencies.push({ name: target.name, contentHash: target.contentHash, interfaceHash: target.interfaceHash });
    }
    sealed.push({ ...pkg, dependencies });
  }
  return readAuthoredAssetWorkspace(deepFreeze({ ...candidate,
    lock: { ...candidate.lock, packages: [...sealed, ...embedded].sort((a, b) => a.name < b.name ? -1 : 1) }
  }), { limits });
};
