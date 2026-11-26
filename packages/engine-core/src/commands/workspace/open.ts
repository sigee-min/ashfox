import {
  hasExactContractKeys,
  isCanonicalIsoDate,
  isClosedContractRecord,
} from '@ashfox/internal-contracts';

import { canonicalJsonString } from '../../canonicalJson';
import { compileAssetWorkspaceEntry } from '../../compiler/program/asset/compile';
import { deepFreeze } from '../../immutable';
import { createProjectDocument } from '../../project/create';
import { validateProjectDocument } from '../../validation/project/validate';
import type { WorkspaceDiagnostic } from '../../project/workspace/diagnostic';
import { errorDiagnostic, sourceRefAt, type SourceRef } from '../../project/workspace/diagnostic';
import type { WorkspaceEntrySelector } from '../../project/workspace/graph/contract';
import { readAuthoredAssetWorkspace } from '../../project/workspace/reader';
import type { AuthoredAssetWorkspace } from '../../project/workspace/contract';
import type {
  AssetBuildIdentity,
  AssetProject,
  AssetProjectIdentitySeed,
} from '../../project/asset';
import type { ProjectDocument } from '../../model';

export interface OpenAssetProjectInput {
  readonly workspace: AuthoredAssetWorkspace;
  readonly entry: WorkspaceEntrySelector;
  readonly identity: AssetProjectIdentitySeed;
}

export type OpenAssetProjectResult =
  | Readonly<{ readonly ok: true; readonly project: AssetProject }>
  | Readonly<{ readonly ok: false; readonly diagnostics: readonly WorkspaceDiagnostic[] }>;

export interface SealedAssetProjectAuthority {
  readonly project: AssetProject;
  readonly document: ProjectDocument;
  readonly build: AssetBuildIdentity;
}

const verifiedAssetProjects = new WeakSet<object>();
const sealedAssetProjects = new WeakMap<AssetProject, SealedAssetProjectAuthority>();

export const readSealedAssetProjectAuthority = (
  project: AssetProject,
): SealedAssetProjectAuthority | undefined => sealedAssetProjects.get(project);

const isDeepFrozen = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (value === null || typeof value !== 'object') return typeof value !== 'function';
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
      isDeepFrozen(descriptor.value, seen)
    );
  });
};

const invalidIdentity = (identity: AssetProjectIdentitySeed): string | null => {
  if (
    !isClosedContractRecord(identity) ||
    !(
      hasExactContractKeys(identity, new Set(['id', 'revision', 'createdAt'])) ||
      hasExactContractKeys(identity, new Set(['id', 'revision', 'createdAt', 'updatedAt']))
    )
  ) {
    return 'Asset project identity must be an object.';
  }
  if (
    typeof identity.id !== 'string' ||
    identity.id.trim() !== identity.id ||
    identity.id.length === 0 ||
    typeof identity.revision !== 'string' ||
    identity.revision.trim() !== identity.revision ||
    identity.revision.length === 0
  ) {
    return 'Asset project id and revision must be non-empty trimmed strings.';
  }
  if (
    typeof identity.createdAt !== 'string' ||
    !isCanonicalIsoDate(identity.createdAt) ||
    (identity.updatedAt !== undefined &&
      (typeof identity.updatedAt !== 'string' || !isCanonicalIsoDate(identity.updatedAt)))
  ) {
    return 'Asset project timestamps must be canonical ISO instants.';
  }
  return null;
};

const rootSourceRef = (
  workspace: AuthoredAssetWorkspace,
  packageName: string,
  path: string,
): SourceRef | undefined => {
  const file = workspace.files.find((candidate) => candidate.path === path);
  return file === undefined
    ? undefined
    : sourceRefAt(packageName, path, file.source, 0, Math.max(1, file.source.length));
};

const documentValidationDiagnostics = (
  document: ReturnType<typeof createProjectDocument>,
  workspace: AuthoredAssetWorkspace,
  packageName: string,
  path: string,
): readonly WorkspaceDiagnostic[] => {
  const report = validateProjectDocument(document);
  const root = rootSourceRef(workspace, packageName, path);
  return report.findings
    .filter((finding) => finding.severity === 'error')
    .map((finding) =>
      errorDiagnostic(
        `asset.document.${finding.code}`,
        `${finding.path}: ${finding.message}`,
        root,
      ),
    );
};

const buildCompiledDocument = (
  identity: AssetProjectIdentitySeed,
  model: Extract<ReturnType<typeof compileAssetWorkspaceEntry>, { ok: true }>['model'],
): ReturnType<typeof createProjectDocument> => {
  const document = createProjectDocument({
    id: identity.id,
    name: model.name,
    revision: identity.revision,
    createdAt: identity.createdAt,
  });
  document.updatedAt = identity.updatedAt ?? identity.createdAt;
  document.settings.textureResolution = {
    width: model.textureResolution[0],
    height: model.textureResolution[1],
  };
  document.settings.forward = model.forward;
  document.settings.surfacePixelDensity = (model.textureDensity / 16) as 1 | 2 | 4 | 8;
  document.scene = model.scene;
  document.textures = model.textures;
  document.animations = model.animations;
  return document;
};

const snapshotIdentitySeed = (
  identity: AssetProjectIdentitySeed,
): AssetProjectIdentitySeed | null => {
  if (
    !isClosedContractRecord(identity) ||
    !(
      hasExactContractKeys(identity, new Set(['id', 'revision', 'createdAt'])) ||
      hasExactContractKeys(identity, new Set(['id', 'revision', 'createdAt', 'updatedAt']))
    )
  ) {
    return null;
  }
  return Object.freeze({
    id: identity.id,
    revision: identity.revision,
    createdAt: identity.createdAt,
    ...(identity.updatedAt === undefined ? {} : { updatedAt: identity.updatedAt }),
  });
};

const sealOpenedAssetProject = (project: AssetProject): OpenAssetProjectResult => {
  const result = deepFreeze({ ok: true as const, project });
  verifiedAssetProjects.add(project);
  sealedAssetProjects.set(
    project,
    Object.freeze({
      project,
      document: project.document,
      build: project.build,
    }),
  );
  return result;
};

/** Build one selected entry into a transient host session. */
export const openAssetProject = (input: OpenAssetProjectInput): OpenAssetProjectResult => {
  try {
    if (
      !isClosedContractRecord(input) ||
      !hasExactContractKeys(input, new Set(['workspace', 'entry', 'identity']))
    )
      return deepFreeze({
        ok: false as const,
        diagnostics: [
          errorDiagnostic('asset-project.invalid-input', 'Asset project input must be an object.'),
        ],
      });
    const identity = snapshotIdentitySeed(input.identity);
    const identityFailure =
      identity === null ? 'Asset project identity must be an object.' : invalidIdentity(identity);
    if (identity === null || identityFailure !== null)
      return deepFreeze({
        ok: false as const,
        diagnostics: [errorDiagnostic('asset-project.invalid-identity', identityFailure!)],
      });
    const opened = readAuthoredAssetWorkspace(input.workspace);
    if (!opened.ok) return deepFreeze({ ok: false as const, diagnostics: opened.diagnostics });
    const compiled = compileAssetWorkspaceEntry(opened.value, input.entry);
    if (!compiled.ok) return deepFreeze({ ok: false as const, diagnostics: compiled.diagnostics });
    const document = buildCompiledDocument(identity, compiled.model);
    const validationDiagnostics = documentValidationDiagnostics(
      document,
      opened.value,
      compiled.build.packageName,
      compiled.build.path,
    );
    if (validationDiagnostics.length > 0)
      return deepFreeze({ ok: false as const, diagnostics: validationDiagnostics });
    const project: AssetProject = {
      id: identity.id,
      revision: identity.revision,
      createdAt: identity.createdAt,
      updatedAt: identity.updatedAt ?? identity.createdAt,
      workspace: opened.value,
      entry: deepFreeze({
        packageName: compiled.build.packageName,
        entryName: compiled.build.entryName,
      }),
      build: compiled.build,
      document: deepFreeze(document),
    };
    return sealOpenedAssetProject(project);
  } catch {
    return deepFreeze({
      ok: false as const,
      diagnostics: [
        errorDiagnostic('asset-project.failure', 'Asset project materialization failed closed.'),
      ],
    });
  }
};

/** Rebuilds the project authority and rejects any forged or stale projection. */
export const isAssetProjectAuthorityValid = (project: AssetProject): boolean => {
  try {
    if (verifiedAssetProjects.has(project)) return true;
    const opened = openAssetProject({
      workspace: project.workspace,
      entry: project.entry,
      identity: {
        id: project.id,
        revision: project.revision,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    });
    const valid = opened.ok && canonicalJsonString(opened.project) === canonicalJsonString(project);
    if (valid && isDeepFrozen(project)) verifiedAssetProjects.add(project);
    return valid;
  } catch {
    return false;
  }
};
