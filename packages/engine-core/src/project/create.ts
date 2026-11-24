import { PROJECT_DOCUMENT_SCHEMA_VERSION, type ProjectDocument, type Revision } from '../model';

export interface CreateProjectDocumentInput {
  id: string;
  name: string;
  revision: Revision;
  createdAt: string;
}

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
