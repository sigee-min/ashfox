import { isCanonicalIsoDate } from '@ashfox/internal-contracts';

import type { ProjectDocument } from '../../model';
import { validateAnimations } from './animations';
import { validateSettings } from './settings';
import { validateScene } from './scene';
import {
  closedRecord,
  expectFiniteNumber,
  expectString,
  reject,
  type ContractContext,
} from './shared';
import { validateTextures } from './textures';
import type { FindingSink } from '../contract';

/** Structural guard for the current-only ProjectDocument wire contract. */
export const validateProjectDocumentContract = (
  value: unknown,
  add: FindingSink,
): value is ProjectDocument => {
  const context: ContractContext = { add, valid: true };
  const record = closedRecord(
    value,
    '',
    [
      'schemaVersion',
      'id',
      'name',
      'revision',
      'settings',
      'scene',
      'textures',
      'animations',
      'createdAt',
      'updatedAt',
    ],
    [],
    context,
  );
  if (!record) return false;
  expectFiniteNumber(record.schemaVersion, 'schemaVersion', context);
  expectString(record.id, 'id', context);
  expectString(record.name, 'name', context);
  expectString(record.revision, 'revision', context);
  for (const key of ['createdAt', 'updatedAt'] as const)
    if (!isCanonicalIsoDate(record[key]))
      reject(
        context,
        key,
        `${key} must be a canonical UTC ISO timestamp.`,
        'document.invalid_timestamp',
      );
  validateSettings(record.settings, context);
  validateScene(record.scene, context);
  validateTextures(record.textures, context);
  validateAnimations(record.animations, context);
  return context.valid;
};
