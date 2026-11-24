import {
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  isSurfacePixelDensity,
  type ProjectDocument,
} from '../../model';
import type { FindingSink } from '../contract';
import { isNonEmptyString } from '../shared/value';

const validateIdentity = (document: ProjectDocument, add: FindingSink): void => {
  for (const [path, value] of [
    ['id', document.id],
    ['name', document.name],
    ['revision', document.revision],
  ] as const)
    if (!isNonEmptyString(value))
      add({
        code: 'document.required_value',
        severity: 'error',
        message: `${path} must be a non-empty string.`,
        path,
      });
};

const FORWARD_DIRECTIONS = ['north', 'south', 'east', 'west'] as const;

const validateSettings = (document: ProjectDocument, add: FindingSink): void => {
  const { width, height } = document.settings.textureResolution;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0)
    add({
      code: 'document.invalid_setting',
      severity: 'error',
      message: 'Texture resolution must use positive integer dimensions.',
      path: 'settings.textureResolution',
    });
  if (!isSurfacePixelDensity(document.settings.surfacePixelDensity))
    add({
      code: 'document.invalid_setting',
      severity: 'error',
      message: 'Surface pixel density must be 1, 2, 4, or 8.',
      path: 'settings.surfacePixelDensity',
    });
  if (!FORWARD_DIRECTIONS.includes(document.settings.forward))
    add({
      code: 'document.invalid_setting',
      severity: 'error',
      message: 'Project forward direction must be north, south, east, or west.',
      path: 'settings.forward',
    });
  const coordinate = document.settings.coordinateSystem;
  if (
    coordinate.up !== 'y' ||
    coordinate.handedness !== 'right' ||
    coordinate.unit !== 'pixel' ||
    coordinate.rotationUnit !== 'degree' ||
    coordinate.rotationOrder !== 'xyz'
  ) {
    add({
      code: 'document.invalid_setting',
      severity: 'error',
      message: 'Projects require right-handed Y-up degree-XYZ coordinates.',
      path: 'settings.coordinateSystem',
    });
  }
};

export const validateDocument = (document: ProjectDocument, add: FindingSink): void => {
  if (document.schemaVersion !== PROJECT_DOCUMENT_SCHEMA_VERSION)
    add({
      code: 'document.schema_version',
      severity: 'error',
      message: `Unsupported project schema version "${document.schemaVersion}".`,
      path: 'schemaVersion',
    });
  validateIdentity(document, add);
  validateSettings(document, add);
};
