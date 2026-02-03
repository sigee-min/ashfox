import type { JsonSchema } from '../types';
import { ENSURE_PROJECT_ACTIONS, FORMAT_KINDS } from '../../toolConstants';
import { BLOCK_PIPELINE_MODES, BLOCK_PIPELINE_ON_CONFLICT, BLOCK_VARIANTS } from '../../../types/blockPipeline';
import { metaProps, revisionProp } from '../schemas/common';
import { ensureProjectBaseProperties } from '../schemas/project';

export const projectToolSchemas: Record<string, JsonSchema> = {
  ensure_project: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ENSURE_PROJECT_ACTIONS },
      target: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' }
        }
      },
      format: { type: 'string', enum: FORMAT_KINDS },
      ...ensureProjectBaseProperties,
      force: { type: 'boolean' },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  block_pipeline: {
    type: 'object',
    required: ['name', 'texture'],
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      texture: { type: 'string' },
      namespace: { type: 'string' },
      variants: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', enum: BLOCK_VARIANTS }
      },
      textures: {
        type: 'object',
        additionalProperties: false,
        properties: {
          top: { type: 'string' },
          side: { type: 'string' },
          bottom: { type: 'string' }
        }
      },
      onConflict: { type: 'string', enum: BLOCK_PIPELINE_ON_CONFLICT },
      mode: { type: 'string', enum: BLOCK_PIPELINE_MODES },
      ifRevision: revisionProp
    }
  }
};
