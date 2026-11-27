import {
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  sealCanonicalBoneFrame,
  type ProjectDocument,
  type Revision,
  type SurfacePixelDensity,
} from '../model';
import type { CompiledModel } from '../model/compiled';

export interface CreateProjectDocumentInput {
  id: string;
  name: string;
  revision: Revision;
  createdAt: string;
}

export interface CompiledModelDocumentOptions {
  readonly id?: string;
  readonly name?: string;
  readonly revision?: Revision;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly sealBones?: boolean;
  readonly copyTextures?: boolean;
}

const DEFAULT_MODEL_TIMESTAMP = '2026-01-01T00:00:00.000Z';

const requiredText = (value: string, label: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} is required.`);
  return normalized;
};

export const createProjectDocument = ({
  id,
  name,
  revision,
  createdAt,
}: CreateProjectDocumentInput): ProjectDocument => {
  const timestamp = requiredText(createdAt, 'Creation timestamp');
  return {
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    id: requiredText(id, 'Project ID'),
    name: requiredText(name, 'Project name'),
    revision: requiredText(revision, 'Project revision'),
    settings: {
      forward: 'north',
      textureResolution: {
        width: 16,
        height: 16,
      },
      surfacePixelDensity: 1,
      coordinateSystem: {
        up: 'y',
        handedness: 'right',
        unit: 'pixel',
        rotationUnit: 'degree',
        rotationOrder: 'xyz',
      },
    },
    scene: {
      roots: [],
      nodes: {},
    },
    textures: {},
    animations: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

/** Adapts a compiled model product into a canonical runtime ProjectDocument view. */
export const compiledModelToProjectDocument = (
  model: CompiledModel,
  options: CompiledModelDocumentOptions = {},
): ProjectDocument => {
  const createdAt = options.createdAt ?? DEFAULT_MODEL_TIMESTAMP;
  const document = createProjectDocument({
    id: options.id ?? model.id,
    name: options.name ?? model.name,
    revision: options.revision ?? 'compiled-1',
    createdAt,
  });
  document.updatedAt = options.updatedAt ?? createdAt;
  document.settings.forward = model.forward;
  document.settings.textureResolution = {
    width: model.textureResolution[0],
    height: model.textureResolution[1],
  };
  document.settings.surfacePixelDensity = (model.textureDensity / 16) as SurfacePixelDensity;
  if (options.sealBones !== false) {
    for (const node of Object.values(model.scene.nodes)) {
      if (node.kind === 'bone') sealCanonicalBoneFrame(node);
    }
  }
  document.scene = model.scene;
  document.textures = options.copyTextures ? { ...model.textures } : model.textures;
  document.animations = model.animations;
  return document;
};
