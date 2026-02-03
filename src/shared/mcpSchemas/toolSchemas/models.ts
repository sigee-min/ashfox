import type { JsonSchema } from '../types';
import { PREVIEW_MODES, PREVIEW_OUTPUTS } from '../../toolConstants';
import { metaProps, mutationRevisionProp, numberArray, revisionProp, stateProps } from '../schemas/common';
import { modelSpecSchema, modelStageSchema } from '../schemas/model';
import { ensureProjectSchema } from '../schemas/project';

export const modelToolSchemas: Record<string, JsonSchema> = {
  add_bone: {
    type: 'object',
    required: ['name', 'pivot'],
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      parent: { type: 'string' },
      parentId: { type: 'string' },
      pivot: numberArray(3, 3),
      rotation: numberArray(3, 3),
      scale: numberArray(3, 3),
      visibility: { type: 'boolean' },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  update_bone: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      newName: { type: 'string' },
      parent: { type: 'string' },
      parentId: { type: 'string' },
      parentRoot: { type: 'boolean' },
      pivot: numberArray(3, 3),
      rotation: numberArray(3, 3),
      scale: numberArray(3, 3),
      visibility: { type: 'boolean' },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  delete_bone: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  add_cube: {
    type: 'object',
    required: ['name', 'from', 'to'],
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      from: numberArray(3, 3),
      to: numberArray(3, 3),
      origin: numberArray(3, 3),
      rotation: numberArray(3, 3),
      bone: { type: 'string' },
      boneId: { type: 'string' },
      inflate: { type: 'number' },
      mirror: { type: 'boolean' },
      visibility: { type: 'boolean' },
      boxUv: { type: 'boolean' },
      uvOffset: numberArray(2, 2),
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  update_cube: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      newName: { type: 'string' },
      bone: { type: 'string' },
      boneId: { type: 'string' },
      boneRoot: { type: 'boolean' },
      from: numberArray(3, 3),
      to: numberArray(3, 3),
      origin: numberArray(3, 3),
      rotation: numberArray(3, 3),
      inflate: { type: 'number' },
      mirror: { type: 'boolean' },
      visibility: { type: 'boolean' },
      boxUv: { type: 'boolean' },
      uvOffset: numberArray(2, 2),
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  delete_cube: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  export: {
    type: 'object',
    required: ['format', 'destPath'],
    additionalProperties: false,
    properties: {
      format: { enum: ['java_block_item_json', 'gecko_geo_anim', 'animated_java'] },
      destPath: { type: 'string' },
      ...stateProps
    }
  },
  validate: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...stateProps
    }
  },
  model_pipeline: {
    type: 'object',
    additionalProperties: false,
    properties: {
      model: modelSpecSchema,
      stages: {
        type: 'array',
        minItems: 1,
        items: modelStageSchema
      },
      stagePreview: {
        type: 'boolean',
        description: 'If true, run preview after each stage when stages are used (defaults to true when preview is set).'
      },
      stageValidate: {
        type: 'boolean',
        description: 'If true, run validate after each stage when stages are used (defaults to true when validate is set).'
      },
      mode: {
        type: 'string',
        enum: ['create', 'merge', 'replace', 'patch'],
        description:
          'create: fail if exists; merge: add/update without deleting; replace: match desired state; patch: update only if target exists.'
      },
      ensureProject: {
        ...ensureProjectSchema({ includeFormat: true })
      },
      deleteOrphans: {
        type: 'boolean',
        description: 'Delete bones/cubes not in the spec. Defaults to true when mode=replace.'
      },
      planOnly: { type: 'boolean', description: 'Compute and return the plan without applying changes.' },
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
      export: {
        type: 'object',
        required: ['format', 'destPath'],
        additionalProperties: false,
        properties: {
          format: { enum: ['java_block_item_json', 'gecko_geo_anim', 'animated_java'] },
          destPath: { type: 'string' }
        }
      },
      ifRevision: mutationRevisionProp,
      ...metaProps
    }
  }
};
