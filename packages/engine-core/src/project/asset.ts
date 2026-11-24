import type { ProjectDocument, Revision } from '../model';
import type { AuthoredAssetWorkspace, Sha256Digest } from './workspace/contract';
import type { WorkspaceEntrySelector } from './workspace/graph/contract';

/** Immutable identity of one concrete product built from a workspace entry. */
export interface AssetBuildIdentity {
  readonly packageName: string;
  readonly entryName: string;
  readonly path: string;
  readonly workspaceHash: Sha256Digest;
  readonly closureHash: Sha256Digest;
  readonly buildKey: Sha256Digest;
  readonly compilerFingerprint: string;
  readonly productHash: Sha256Digest;
}

/** Host-owned identity; it is never serialized into the workspace authority. */
export interface AssetProjectIdentitySeed {
  readonly id: string;
  readonly revision: Revision;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

/**
 * Runtime projection joining one immutable workspace head to one selected,
 * validated concrete document. It is not a portable file or a second source
 * authority.
 */
export interface AssetProject {
  readonly id: string;
  readonly revision: Revision;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workspace: AuthoredAssetWorkspace;
  readonly entry: WorkspaceEntrySelector;
  readonly build: AssetBuildIdentity;
  readonly document: ProjectDocument;
}
