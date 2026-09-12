import {
  hasExactContractKeys,
  isCanonicalIsoDate,
  isClosedContractRecord
} from '@ashfox/internal-contracts';

import { canonicalJsonString } from '../../canonicalJson';
import { compileAssetWorkspaceEntry } from '../../compiler/program/asset/compile';
import { deepFreeze } from '../../immutable';
import { createProjectDocument } from '../../project/create';
import { validateProjectDocument } from '../../validation/project/validate';
import type { WorkspaceDiagnostic } from '../../project/workspace/diagnostic';
import {
  errorDiagnostic,
  sourceRefAt,
  type SourceRef
} from '../../project/workspace/diagnostic';
import type { WorkspaceEntrySelector } from '../../project/workspace/graph/contract';
import { readAuthoredAssetWorkspace } from '../../project/workspace/reader';
import type { AuthoredAssetWorkspace } from '../../project/workspace/contract';
import type {
  AssetProject,
  AssetProjectIdentitySeed
} from '../../project/asset';

export interface OpenAssetProjectInput {
  readonly workspace: AuthoredAssetWorkspace;
  readonly entry: WorkspaceEntrySelector;
  readonly identity: AssetProjectIdentitySeed;
}

export type OpenAssetProjectResult =
  | Readonly<{ readonly ok: true; readonly project: AssetProject }>
  | Readonly<{ readonly ok: false; readonly diagnostics: readonly WorkspaceDiagnostic[] }>;

const verifiedAssetProjects = new WeakSet<object>();

const isDeepFrozen = (
  value: unknown,
  seen = new WeakSet<object>()
): boolean => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.values(value).every((child) => isDeepFrozen(child, seen));
};

const invalidIdentity = (
  identity: AssetProjectIdentitySeed
): string | null => {
  if (!isClosedContractRecord(identity) ||
      !(hasExactContractKeys(identity, new Set(['id', 'revision', 'createdAt'])) ||
        hasExactContractKeys(identity,
          new Set(['id', 'revision', 'createdAt', 'updatedAt'])))) {
    return 'Asset project identity must be an object.';
  }
  if (typeof identity.id !== 'string' || identity.id.trim() !== identity.id ||
      identity.id.length === 0 || typeof identity.revision !== 'string' ||
      identity.revision.trim() !== identity.revision || identity.revision.length === 0) {
    return 'Asset project id and revision must be non-empty trimmed strings.';
  }
  if (typeof identity.createdAt !== 'string' || !isCanonicalIsoDate(identity.createdAt) ||
      (identity.updatedAt !== undefined && (typeof identity.updatedAt !== 'string' ||
        !isCanonicalIsoDate(identity.updatedAt)))) {
    return 'Asset project timestamps must be canonical ISO instants.';
  }
  return null;
};

const rootSourceRef = (
  workspace: AuthoredAssetWorkspace,
  packageName: string,
  path: string
): SourceRef | undefined => {
  const file = workspace.files.find((candidate) => candidate.path === path);
  return file === undefined ? undefined : sourceRefAt(
    packageName,
    path,
    file.source,
    0,
    Math.max(1, file.source.length)
  );
};

const documentValidationDiagnostics = (
  document: ReturnType<typeof createProjectDocument>,
  workspace: AuthoredAssetWorkspace,
  packageName: string,
  path: string
): readonly WorkspaceDiagnostic[] => {
  const report = validateProjectDocument(document);
  const root = rootSourceRef(workspace, packageName, path);
  return report.findings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => errorDiagnostic(
      `asset.document.${finding.code}`,
      `${finding.path}: ${finding.message}`,
      root
    ));
};

/** Build one selected entry into a transient host session. */
export const openAssetProject = (
  input: OpenAssetProjectInput
): OpenAssetProjectResult => {
  try {
    if (!isClosedContractRecord(input) || !hasExactContractKeys(input,
      new Set(['workspace', 'entry', 'identity']))) return deepFreeze({
      ok: false as const,
      diagnostics: [errorDiagnostic('asset-project.invalid-input',
        'Asset project input must be an object.')]
    });
    const identityFailure = invalidIdentity(input.identity);
    if (identityFailure !== null) return deepFreeze({ ok: false as const,
      diagnostics: [errorDiagnostic('asset-project.invalid-identity', identityFailure)] });
    const opened = readAuthoredAssetWorkspace(input.workspace);
    if (!opened.ok) return deepFreeze({ ok: false as const,
      diagnostics: opened.diagnostics });
    const compiled = compileAssetWorkspaceEntry(opened.value, input.entry);
    if (!compiled.ok) return deepFreeze({ ok: false as const,
      diagnostics: compiled.diagnostics });
    const document = createProjectDocument({
      id: input.identity.id,
      name: compiled.model.name,
      revision: input.identity.revision,
      createdAt: input.identity.createdAt
    });
    document.updatedAt = input.identity.updatedAt ?? input.identity.createdAt;
    document.settings.textureResolution = {
      width: compiled.model.textureResolution[0],
      height: compiled.model.textureResolution[1]
    };
    document.settings.forward = compiled.model.forward;
    document.settings.surfacePixelDensity = (compiled.model.textureDensity / 16) as
      1 | 2 | 4 | 8;
    document.scene = compiled.model.scene;
    document.textures = compiled.model.textures;
    document.animations = compiled.model.animations;
    const validationDiagnostics = documentValidationDiagnostics(
      document,
      opened.value,
      compiled.build.packageName,
      compiled.build.path
    );
    if (validationDiagnostics.length > 0) return deepFreeze({ ok: false as const,
      diagnostics: validationDiagnostics });
    const project: AssetProject = {
      id: input.identity.id,
      revision: input.identity.revision,
      createdAt: input.identity.createdAt,
      updatedAt: input.identity.updatedAt ?? input.identity.createdAt,
      workspace: opened.value,
      entry: deepFreeze({ ...input.entry }),
      build: compiled.build,
      document: deepFreeze(document)
    };
    return deepFreeze({ ok: true as const, project });
  } catch {
    return deepFreeze({ ok: false as const,
      diagnostics: [errorDiagnostic('asset-project.failure',
        'Asset project materialization failed closed.')] });
  }
};

/** Rebuilds the project authority and rejects any forged or stale projection. */
export const isAssetProjectAuthorityValid = (
  project: AssetProject
): boolean => {
  try {
    if (verifiedAssetProjects.has(project)) return true;
    const opened = openAssetProject({
      workspace: project.workspace,
      entry: project.entry,
      identity: {
        id: project.id,
        revision: project.revision,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      }
    });
    const valid = opened.ok && canonicalJsonString(opened.project) ===
      canonicalJsonString(project);
    if (valid && isDeepFrozen(project)) verifiedAssetProjects.add(project);
    return valid;
  } catch {
    return false;
  }
};
