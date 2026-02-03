import type { JsonSchema } from '../types';
import { ENTITY_FORMATS, GECKOLIB_TARGET_VERSIONS, PREVIEW_MODES, PREVIEW_OUTPUTS } from '../../toolConstants';
import { metaProps, numberArray, revisionProp } from '../schemas/common';
import { entityAnimationSchema } from '../schemas/entity';
import { modelSpecSchema, modelStageSchema } from '../schemas/model';
import { ensureProjectSchema } from '../schemas/project';
import { facePaintSchema, texturePlanSchema } from '../schemas/texture';
import { texturePaintItemSchema } from './texture/shared';

export const entityToolSchemas: Record<string, JsonSchema> = {
  entity_pipeline: {
    type: 'object',
    required: ['format'],
    additionalProperties: false,
    properties: {
      format: { type: 'string', enum: ENTITY_FORMATS },
      targetVersion: { type: 'string', enum: GECKOLIB_TARGET_VERSIONS },
      ensureProject: {
        ...ensureProjectSchema()
      },
      planOnly: { type: 'boolean', description: 'Skip mutations and return clarification actions only.' },
      autoStage: {
        type: 'boolean',
        description:
          'Automatically stage texture steps (plan/uv/paint) with preflight refreshes. Defaults to true.'
      },
      model: modelSpecSchema,
      modelStages: {
        type: 'array',
        minItems: 1,
        items: modelStageSchema
      },
      mode: {
        type: 'string',
        enum: ['create', 'merge', 'replace', 'patch'],
        description:
          'create: fail if exists; merge: add/update without deleting; replace: match desired state; patch: update only if target exists.'
      },
      deleteOrphans: {
        type: 'boolean',
        description: 'Delete bones/cubes not in the spec. Defaults to true when mode=replace.'
      },
      stagePreview: {
        type: 'boolean',
        description: 'If true, run preview after each stage when stages are used (defaults to true when preview is set).'
      },
      stageValidate: {
        type: 'boolean',
        description: 'If true, run validate after each stage when stages are used (defaults to true when validate is set).'
      },
      preview: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { enum: PREVIEW_MODES },
          angle: numberArray(2, 3),
          clip: { type: 'string' },
          timeSeconds: { type: 'number' },
          durationSeconds: { type: 'number' },
          fps: { type: 'number' },
          output: { enum: PREVIEW_OUTPUTS },
          saveToTmp: { type: 'boolean' },
          tmpName: { type: 'string' },
          tmpPrefix: { type: 'string' }
        }
      },
      validate: { type: 'boolean' },
      texturePlan: {
        ...texturePlanSchema,
        description: 'Auto-plan textures + UVs from high-level intent (bootstrap for textures/UVs).'
      },
      textures: {
        type: 'array',
        minItems: 1,
        items: texturePaintItemSchema
      },
      facePaint: {
        ...facePaintSchema,
        description:
          'Optional: face-centric painting. Maps material keywords to presets and targets cube faces without manual UVs.'
      },
      cleanup: {
        type: 'object',
        additionalProperties: false,
        properties: {
          delete: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' }
              }
            }
          },
          force: {
            type: 'boolean',
            description: 'If true, allow deletion of textures still assigned to cubes.'
          }
        }
      },
      uvUsageId: { type: 'string' },
      animations: {
        type: 'array',
        items: entityAnimationSchema
      },
      ifRevision: revisionProp,
      ...metaProps
    }
  }
};
