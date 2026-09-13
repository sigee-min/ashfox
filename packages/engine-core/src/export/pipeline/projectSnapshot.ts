import { canonicalJsonString } from '../../canonicalJson';
import { sealCanonicalBoneFrame, type ProjectDocument } from '../../model';
import type { CompiledModel } from '../../model/compiled';
import { compileAssetWorkspaceEntry } from '../../compiler/program/asset/compile';
import { createProjectDocument } from '../../project/create';
import type {
  AssetBuildIdentity,
  AssetProject
} from '../../project/asset';
import { sha256Digest } from '../../provenance/digest';
import { snapshotExportData } from './dataSnapshot';

export interface AssetProjectSnapshot {
  readonly document: ProjectDocument;
  readonly build: AssetBuildIdentity;
  readonly documentDigest: string;
  readonly buildDigest: string;
}

const immutableSnapshots = new WeakMap<AssetProject, AssetProjectSnapshot>();

// A shallow freeze is insufficient: mutable descendants and accessors must
// continue through authority validation on every export.
const isImmutableData = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (value === null || typeof value !== 'object') return typeof value !== 'function';
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
      isImmutableData(descriptor.value, seen);
  });
};

const snapshotDocument = (document: ProjectDocument): ProjectDocument => {
  const snapshot = snapshotExportData(document, 'project.document',
    'Project export document snapshot failed.');
  for (const node of Object.values(snapshot.scene.nodes)) {
    if (node.kind === 'bone') sealCanonicalBoneFrame(node);
  }
  return snapshot;
};

const documentForCompiledModel = (
  project: AssetProject,
  model: CompiledModel
): ProjectDocument => {
  const document = createProjectDocument({
    id: project.id,
    name: model.name,
    revision: project.revision,
    createdAt: project.createdAt
  });
  document.updatedAt = project.updatedAt;
  document.settings.textureResolution = {
    width: model.textureResolution[0]!,
    height: model.textureResolution[1]!
  };
  document.settings.forward = model.forward;
  document.settings.surfacePixelDensity = (model.textureDensity / 16) as
    1 | 2 | 4 | 8;
  document.scene = model.scene;
  document.textures = model.textures;
  document.animations = model.animations;
  return document;
};

const assertProjectAuthority = (
  project: AssetProject,
  document: ProjectDocument,
  build: AssetBuildIdentity
): void => {
  const workspace = snapshotExportData(project.workspace, 'project.workspace',
    'Asset workspace authority snapshot failed.');
  const entry = snapshotExportData(project.entry, 'project.entry',
    'Asset entry authority snapshot failed.');
  const compiled = compileAssetWorkspaceEntry(workspace, entry);
  if (!compiled.ok || canonicalJsonString(compiled.build) !==
      canonicalJsonString(build)) {
    throw new TypeError(
      'Asset project workspace, entry, and build identity do not agree.');
  }
  const expected = documentForCompiledModel(project, compiled.model);
  if (canonicalJsonString(expected) !== canonicalJsonString(document)) {
    throw new TypeError(
      'Asset project workspace, entry, and document do not agree.');
  }
};

/** Copies the exact runtime project authorities before export work begins. */
export const snapshotAssetProject = (
  project: AssetProject
): AssetProjectSnapshot => {
  if (project === null || typeof project !== 'object') {
    throw new TypeError('Asset export requires one project authority.');
  }
  const cached = immutableSnapshots.get(project);
  if (cached !== undefined) return cached;
  const ownAuthority = ['id', 'revision', 'createdAt', 'updatedAt', 'workspace', 'entry', 'build', 'document']
    .every(key => Object.prototype.hasOwnProperty.call(project, key));
  const immutable = ownAuthority && isImmutableData(project);
  const build = snapshotExportData(project.build, 'project.build',
    'Asset build identity snapshot failed.');
  const document = snapshotDocument(project.document);
  assertProjectAuthority(project, document, build);
  const snapshot = Object.freeze({
    document,
    build,
    documentDigest: sha256Digest(canonicalJsonString(document)),
    buildDigest: sha256Digest(canonicalJsonString(build))
  });
  if (immutable) immutableSnapshots.set(project, snapshot);
  return snapshot;
};
