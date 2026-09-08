/**
 * The source authority for a multi-entry Ashfox asset workspace.
 *
 * This contract deliberately contains source, manifest, and lock data only.
 * Compiled scene data, render receipts, and caches are derived products and do
 * not belong in this authority.
 */

export const ASHFOX_WORKSPACE_FORMAT = 'ashfox-workspace' as const;
export const ASHFOX_PACKAGE_FORMAT = 'ashfox-package' as const;
export const ASHFOX_LOCK_FORMAT = 'ashfox-lock' as const;
export const ASHFOX_WORKSPACE_VERSION = 1 as const;
export const ASHFOX_MODEL_GRAMMAR = 'ashfox-model 1' as const;
/**
 * Exact build-policy identity. The source grammar deliberately remains v1,
 * while compiler semantics may still hard-cut. A lock produced for a prior
 * semantic pipeline must therefore never be accepted merely because its
 * source header is unchanged.
 */
export const ASHFOX_WORKSPACE_COMPILER_FINGERPRINT =
  'ashfox-asset-compiler:workspace+design+anchored-pixels+typed-hir+instantiation+canonical:v1' as const;

export type Sha256Digest = `sha256:${string}`;

export interface WorkspaceFile {
  readonly path: string;
  readonly source: string;
}

export interface AssetEntry {
  readonly name: string;
  /** Path relative to the owning package root. */
  readonly path: string;
}

export interface ModuleDeclaration {
  /** Import specifier exposed by the package, for example `./anatomy`. */
  readonly subpath: string;
  /** Path relative to the owning package root. */
  readonly path: string;
}

export interface PackageDependency {
  readonly name: string;
}

export interface PackageManifest {
  readonly format: typeof ASHFOX_PACKAGE_FORMAT;
  readonly version: typeof ASHFOX_WORKSPACE_VERSION;
  readonly entries: readonly AssetEntry[];
  readonly modules: readonly ModuleDeclaration[];
  readonly dependencies: readonly PackageDependency[];
}

export interface WorkspacePackage {
  readonly name: string;
  /** Normalized logical path. An empty root denotes the workspace root. */
  readonly root: string;
  readonly manifest: PackageManifest;
}

export interface WorkspaceManifest {
  readonly format: typeof ASHFOX_WORKSPACE_FORMAT;
  readonly version: typeof ASHFOX_WORKSPACE_VERSION;
  readonly packages: readonly WorkspacePackage[];
}

export interface LockedFile {
  /** Full workspace logical path, matching a WorkspaceFile path. */
  readonly path: string;
  readonly contentHash: Sha256Digest;
}

export interface LockedDependency {
  readonly name: string;
  readonly contentHash: Sha256Digest;
  readonly interfaceHash: Sha256Digest;
}

export type LockPackageSource = 'workspace' | 'cas';

export interface LockedPackage {
  readonly name: string;
  readonly source: LockPackageSource;
  /** Null for workspace packages; a content address for CAS packages. */
  readonly digest: Sha256Digest | null;
  /** Full logical root used to bind embedded CAS bytes without I/O. */
  readonly root: string;
  /** The package manifest is duplicated in the lock for CAS packages. */
  readonly manifest: PackageManifest;
  readonly contentHash: Sha256Digest;
  readonly manifestHash: Sha256Digest;
  readonly files: readonly LockedFile[];
  /** Hash of all declared exported ABI signatures in this package. */
  readonly interfaceHash: Sha256Digest;
  readonly dependencies: readonly LockedDependency[];
}

export interface WorkspaceLock {
  readonly format: typeof ASHFOX_LOCK_FORMAT;
  readonly version: typeof ASHFOX_WORKSPACE_VERSION;
  /** Compiler/build fingerprint; it is an input to build keys, not source. */
  readonly compilerFingerprint: string;
  readonly packages: readonly LockedPackage[];
}

export interface AuthoredAssetWorkspace {
  readonly files: readonly WorkspaceFile[];
  readonly manifest: WorkspaceManifest;
  readonly lock: WorkspaceLock;
}

export interface WorkspaceFileWrite {
  readonly path: string;
  readonly source: string;
  /** Optional per-file compare-and-swap guard. */
  readonly expectedHash?: Sha256Digest | null;
}

export interface WorkspaceFileDelete {
  readonly path: string;
  /** Optional per-file compare-and-swap guard. */
  readonly expectedHash?: Sha256Digest;
}

export interface WorkspaceChangeSet {
  readonly expectedWorkspaceHash: Sha256Digest;
  readonly writes: readonly WorkspaceFileWrite[];
  readonly deletes: readonly WorkspaceFileDelete[];
  /** Full replacement; omission preserves the current value. */
  readonly manifest?: WorkspaceManifest;
}

/** Compiler-derived ABI input. It is intentionally not part of the source authority. */
export interface WorkspaceAbiExport {
  readonly name: string;
  readonly signature: string;
}

export interface WorkspaceModuleAbi {
  readonly packageName: string;
  readonly subpath: string;
  readonly exports: readonly WorkspaceAbiExport[];
}

/** Import records produced by the canonical Ashfox parser, not re-parsed here. */
export interface WorkspaceParsedImport {
  readonly packageName: string;
  readonly path: string;
  readonly specifier: string;
  readonly alias: string | null;
  readonly source: SourceRef;
}
import type { SourceRef } from './diagnostic';
