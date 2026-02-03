import type { JsonSchema } from '../types';
import { PREVIEW_MODES, PREVIEW_OUTPUTS } from '../../toolConstants';
import { cubeFaceSchema, metaProps, mutationRevisionProp, numberArray, revisionProp } from '../schemas/common';
import { faceUvSchema } from '../schemas/model';
import { facePaintSchema, texturePresetSchema, uvPaintSchema, texturePlanSchema } from '../schemas/texture';
import { presetItemSchema, texturePaintItemSchema, uvAssignmentItemSchema } from './texture/shared';

const applyTextureItemSchema: JsonSchema = {
  ...texturePaintItemSchema,
  properties: {
    ...texturePaintItemSchema.properties,
    width: {
      type: 'number',
      description: 'Texture width (pixels). Must match intended project textureResolution.'
    },
    height: {
      type: 'number',
      description: 'Texture height (pixels). Must match intended project textureResolution.'
    }
  }
};

export const textureToolSchemas: Record<string, JsonSchema> = {
  generate_texture_preset: {
    type: 'object',
    required: ['preset', 'width', 'height', 'uvUsageId'],
    additionalProperties: false,
    properties: {
      preset: texturePresetSchema,
      width: { type: 'number' },
      height: { type: 'number' },
      uvUsageId: { type: 'string' },
      name: { type: 'string' },
      targetId: { type: 'string' },
      targetName: { type: 'string' },
      mode: { type: 'string', enum: ['create', 'update'] },
      seed: { type: 'number' },
      palette: { type: 'array', items: { type: 'string' } },
      uvPaint: uvPaintSchema,
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  auto_uv_atlas: {
    type: 'object',
    additionalProperties: false,
    properties: {
      padding: { type: 'number' },
      apply: { type: 'boolean' },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  set_project_texture_resolution: {
    type: 'object',
    required: ['width', 'height'],
    additionalProperties: false,
    properties: {
      width: { type: 'number' },
      height: { type: 'number' },
      modifyUv: { type: 'boolean' },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  delete_texture: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  assign_texture: {
    type: 'object',
    additionalProperties: false,
    properties: {
      textureId: { type: 'string' },
      textureName: { type: 'string' },
      cubeIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Limit to these cube ids. If cubeNames is also provided, both must match.'
      },
      cubeNames: {
        type: 'array',
        items: { type: 'string' },
        description: 'Limit to these cube names. If cubeIds is also provided, both must match.'
      },
      faces: { type: 'array', minItems: 1, items: cubeFaceSchema },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  set_face_uv: {
    type: 'object',
    required: ['faces'],
    additionalProperties: false,
    properties: {
      cubeId: { type: 'string' },
      cubeName: { type: 'string' },
      faces: faceUvSchema,
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  apply_texture_spec: {
    type: 'object',
    required: ['textures', 'uvUsageId'],
    additionalProperties: false,
    properties: {
      textures: {
        type: 'array',
        minItems: 1,
        items: applyTextureItemSchema
      },
      uvUsageId: {
        type: 'string',
        description:
          'UV usage id from preflight_texture (call without texture filters). If UVs change, preflight again and retry with the new uvUsageId.'
      },
      ifRevision: mutationRevisionProp,
      ...metaProps
    }
  },
  apply_uv_spec: {
    type: 'object',
    required: ['assignments', 'uvUsageId'],
    additionalProperties: false,
    properties: {
      assignments: {
        type: 'array',
        minItems: 1,
        items: uvAssignmentItemSchema
      },
      uvUsageId: {
        type: 'string',
        description:
          'UV usage id from preflight_texture (call without texture filters). If UVs change, preflight again and use the refreshed uvUsageId.'
      },
      ifRevision: mutationRevisionProp,
      ...metaProps
    }
  },
  texture_pipeline: {
    type: 'object',
    description:
      'Macro workflow: assign_texture -> preflight_texture -> apply_uv_spec -> preflight_texture -> apply_texture_spec/generate_texture_preset -> render_preview. Prefer this when you can express the task in one chain.',
    additionalProperties: false,
    properties: {
      plan: {
        ...texturePlanSchema
      },
      assign: {
        type: 'array',
        minItems: 1,
        description: 'Optional: bind textures to cubes/faces before UV/painting steps.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            textureId: { type: 'string' },
            textureName: { type: 'string', description: 'Alternative to textureId (less stable).' },
            cubeIds: {
              type: 'array',
              minItems: 1,
              items: { type: 'string' },
              description: 'Limit to these cube ids. If cubeNames is also provided, both must match.'
            },
            cubeNames: {
              type: 'array',
              minItems: 1,
              items: { type: 'string' },
              description: 'Limit to these cube names. If cubeIds is also provided, both must match.'
            },
            faces: { type: 'array', minItems: 1, items: cubeFaceSchema }
          }
        }
      },
      uv: {
        type: 'object',
        required: ['assignments'],
        additionalProperties: false,
        properties: {
          assignments: {
            type: 'array',
            minItems: 1,
            items: uvAssignmentItemSchema
          }
        }
      },
      textures: {
        type: 'array',
        minItems: 1,
        description: 'Optional: paint/create/update textures after UV preflight.',
        items: texturePaintItemSchema
      },
      presets: {
        type: 'array',
        minItems: 1,
        description: 'Optional: generate procedural preset textures (preferred for 64x64+).',
        items: presetItemSchema
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
      preflight: {
        type: 'object',
        additionalProperties: false,
        properties: {
          includeUsage: { type: 'boolean', description: 'Include full textureUsage mapping table (can be large).' }
        }
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
      planOnly: { type: 'boolean', description: 'Skip mutations and return plan/clarification actions only.' },
      autoStage: {
        type: 'boolean',
        description:
          'Automatically stage pipeline steps (plan/assign/uv/paint) with preflight refreshes. Defaults to true.'
      },
      ifRevision: mutationRevisionProp,
      ...metaProps
    }
  }
};
