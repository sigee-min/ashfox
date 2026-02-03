import type { JsonSchema } from '../types';
import {
  ENSURE_PROJECT_MATCHES,
  ENSURE_PROJECT_ON_MISMATCH,
  ENSURE_PROJECT_ON_MISSING,
  FORMAT_KINDS
} from '../../toolConstants';

export const ensureProjectBaseProperties: Record<string, JsonSchema> = {
  name: { type: 'string' },
  match: { type: 'string', enum: ENSURE_PROJECT_MATCHES },
  onMismatch: { type: 'string', enum: ENSURE_PROJECT_ON_MISMATCH },
  onMissing: { type: 'string', enum: ENSURE_PROJECT_ON_MISSING },
  confirmDiscard: { type: 'boolean' },
  dialog: { type: 'object', additionalProperties: true }
};

export const ensureProjectSchema = (options?: { includeFormat?: boolean }): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    ...(options?.includeFormat ? { format: { type: 'string', enum: FORMAT_KINDS } } : {}),
    ...ensureProjectBaseProperties
  }
});
