import { JsonSchema } from './types';
import {
  ENTITY_FORMATS,
  ENSURE_PROJECT_ACTIONS,
  ENSURE_PROJECT_MATCHES,
  ENSURE_PROJECT_ON_MISMATCH,
  ENSURE_PROJECT_ON_MISSING,
  FORMAT_KINDS,
  GECKOLIB_TARGET_VERSIONS,
  PREVIEW_MODES,
  PREVIEW_OUTPUTS,
  PROJECT_STATE_DETAILS
} from '../shared/toolConstants';
import {
  BLOCK_PIPELINE_MODES,
  BLOCK_PIPELINE_ON_CONFLICT,
  BLOCK_VARIANTS
} from '../types/blockPipeline';
import { cubeFaceSchema, emptyObject, metaProps, numberArray, stateProps } from './schemas/common';
import { entityAnimationSchema } from './schemas/entity';
import { faceUvSchema, modelSpecSchema } from './schemas/model';
import { facePaintSchema, textureOpSchema, texturePresetSchema, uvPaintSchema } from './schemas/texture';

const ensureProjectBaseProperties: Record<string, JsonSchema> = {
  name: { type: 'string' },
  match: { type: 'string', enum: ENSURE_PROJECT_MATCHES },
  onMismatch: { type: 'string', enum: ENSURE_PROJECT_ON_MISMATCH },
  onMissing: { type: 'string', enum: ENSURE_PROJECT_ON_MISSING },
  confirmDiscard: { type: 'boolean' },
  confirmDialog: { type: 'boolean' },
  dialog: { type: 'object', additionalProperties: true }
};

const ensureProjectSchema = (options?: { includeFormat?: boolean }): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    ...(options?.includeFormat ? { format: { type: 'string', enum: FORMAT_KINDS } } : {}),
    ...ensureProjectBaseProperties
  }
});

const texturePlanSchema: JsonSchema = {
  type: 'object',
  description: 'Auto-plan textures + UVs from high-level intent. When provided, assignment/UV steps are generated automatically.',
  additionalProperties: false,
  properties: {
    name: { type: 'string', description: 'Base texture name for generated textures.' },
    detail: { type: 'string', enum: ['low', 'medium', 'high'] },
    maxTextures: { type: 'number', description: 'Max number of textures to split into (>=1).' },
    allowSplit: { type: 'boolean', description: 'Allow splitting cubes across multiple textures.' },
    padding: { type: 'number', description: 'UV atlas padding in pixels.' },
    resolution: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'number' },
        height: { type: 'number' }
      }
    },
    paint: {
      type: 'object',
      additionalProperties: false,
      properties: {
        preset: texturePresetSchema,
        palette: { type: 'array', items: { type: 'string' } },
        seed: { type: 'number' },
        background: { type: 'string', description: 'Optional base fill color (hex).' }
      }
    }
  }
};

export const toolSchemas: Record<string, JsonSchema> = {
  list_capabilities: emptyObject,
  get_project_state: {
    type: 'object',
    additionalProperties: false,
    properties: {
      detail: { type: 'string', enum: PROJECT_STATE_DETAILS },
      includeUsage: {
        type: 'boolean',
        description: 'Include textureUsage in the response (defaults to true when detail=full).'
      }
    }
  },
  read_texture: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      saveToTmp: { type: 'boolean' },
      tmpName: { type: 'string' },
      tmpPrefix: { type: 'string' }
    }
  },
  reload_plugins: {
    type: 'object',
    required: ['confirm'],
    additionalProperties: false,
    properties: {
      confirm: { type: 'boolean' },
      delayMs: { type: 'number' }
    }
  },
  generate_texture_preset: {
    type: 'object',
    required: ['preset', 'width', 'height', 'uvUsageId'],
    additionalProperties: false,
    properties: {
      preset: texturePresetSchema,
      width: { type: 'number' },
      height: { type: 'number' },
      uvUsageId: { type: 'string' },
      autoRecover: {
        type: 'boolean',
        description:
          'If true (default), attempts a single auto_uv_atlas + preflight retry when UV overlap/scale/missing issues are detected.'
      },
      name: { type: 'string' },
      targetId: { type: 'string' },
      targetName: { type: 'string' },
      mode: { type: 'string', enum: ['create', 'update'] },
      seed: { type: 'number' },
      palette: { type: 'array', items: { type: 'string' } },
      uvPaint: uvPaintSchema,
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  auto_uv_atlas: {
    type: 'object',
    additionalProperties: false,
    properties: {
      padding: { type: 'number' },
      apply: { type: 'boolean' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
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
      ifRevision: { type: 'string' },
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
      ifRevision: { type: 'string' }
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
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  preflight_texture: {
    type: 'object',
    description:
      'Build a UV mapping table and compute uvUsageId. Call WITHOUT texture filters for a stable uvUsageId. Use this before apply_uv_spec/apply_texture_spec/generate_texture_preset.',
    additionalProperties: false,
    properties: {
      textureId: { type: 'string', description: 'Optional: filter the report to one texture id.' },
      textureName: { type: 'string', description: 'Optional: filter the report to one texture name.' },
      includeUsage: { type: 'boolean', description: 'Include full textureUsage mapping table (can be large).' }
    }
  },
  delete_texture: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  assign_texture: {
    type: 'object',
    additionalProperties: false,
    properties: {
      textureId: { type: 'string' },
      textureName: { type: 'string' },
      cubeIds: { type: 'array', items: { type: 'string' } },
      cubeNames: { type: 'array', items: { type: 'string' } },
      faces: { type: 'array', minItems: 1, items: cubeFaceSchema },
      ifRevision: { type: 'string' },
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
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
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
      ifRevision: { type: 'string' },
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
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  delete_bone: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      ifRevision: { type: 'string' },
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
      ifRevision: { type: 'string' },
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
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  delete_cube: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      ifRevision: { type: 'string' },
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
  render_preview: {
    type: 'object',
    required: ['mode'],
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
      tmpPrefix: { type: 'string' },
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
    required: ['model'],
    additionalProperties: false,
    properties: {
      model: modelSpecSchema,
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
      ifRevision: { type: 'string', description: 'Required for mutations. Get the latest revision from get_project_state.' },
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
        items: {
          type: 'object',
          required: ['width', 'height'],
          additionalProperties: false,
          properties: {
            mode: { type: 'string', enum: ['create', 'update'] },
            id: { type: 'string', description: 'Optional id to request for create.' },
            targetId: { type: 'string', description: 'For update: existing texture id.' },
            targetName: { type: 'string', description: 'For update: existing texture name.' },
            name: { type: 'string', description: 'For create: new texture name.' },
            width: {
              type: 'number',
              description: 'Texture width (pixels). Must match intended project textureResolution.'
            },
            height: {
              type: 'number',
              description: 'Texture height (pixels). Must match intended project textureResolution.'
            },
            background: { type: 'string', description: 'Optional fill color (hex). Applied before ops.' },
            useExisting: { type: 'boolean', description: 'For update: read the existing texture and paint on top of it.' },
            detectNoChange: {
              type: 'boolean',
              description: 'For update: detect no-change by comparing the rendered image against the base (higher cost).'
            },
            uvPaint: uvPaintSchema,
            ops: {
              type: 'array',
              items: textureOpSchema
            }
          }
        }
      },
      uvUsageId: {
        type: 'string',
        description:
          'UV usage id from preflight_texture (call without texture filters). If UVs change, preflight again and retry with the new uvUsageId.'
      },
      autoRecover: {
        type: 'boolean',
        description:
          'If true (default), attempts a single auto_uv_atlas + preflight retry for UV overlap/scale/missing issues.'
      },
      ifRevision: { type: 'string', description: 'Required for mutations. Get the latest revision from get_project_state.' },
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
        items: {
          type: 'object',
          required: ['faces'],
          additionalProperties: false,
          properties: {
            cubeId: { type: 'string' },
            cubeName: { type: 'string', description: 'Alternative to cubeId (less stable).' },
            cubeIds: { type: 'array', minItems: 1, items: { type: 'string' } },
            cubeNames: { type: 'array', minItems: 1, items: { type: 'string' } },
            faces: {
              ...faceUvSchema,
              description:
                'Face UV updates. Values are [x1,y1,x2,y2] in texture pixels. UVs must fit within project textureResolution.'
            }
          }
        }
      },
      uvUsageId: {
        type: 'string',
        description:
          'UV usage id from preflight_texture (call without texture filters). If UVs change, preflight again and use the refreshed uvUsageId.'
      },
      ifRevision: { type: 'string', description: 'Required for mutations. Get the latest revision from get_project_state.' },
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
            cubeIds: { type: 'array', minItems: 1, items: { type: 'string' } },
            cubeNames: { type: 'array', minItems: 1, items: { type: 'string' } },
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
            items: {
              type: 'object',
              required: ['faces'],
              additionalProperties: false,
              properties: {
                cubeId: { type: 'string' },
                cubeName: { type: 'string', description: 'Alternative to cubeId (less stable).' },
                cubeIds: { type: 'array', minItems: 1, items: { type: 'string' } },
                cubeNames: { type: 'array', minItems: 1, items: { type: 'string' } },
                faces: {
                  ...faceUvSchema,
                  description:
                    'Face UV updates. Values are [x1,y1,x2,y2] in texture pixels. UVs must fit within project textureResolution.'
                }
              }
            }
          }
        }
      },
      textures: {
        type: 'array',
        minItems: 1,
        description: 'Optional: paint/create/update textures after UV preflight.',
        items: {
          type: 'object',
          required: ['width', 'height'],
          additionalProperties: false,
          properties: {
            mode: { type: 'string', enum: ['create', 'update'] },
            id: { type: 'string', description: 'Optional id to request for create.' },
            targetId: { type: 'string', description: 'For update: existing texture id.' },
            targetName: { type: 'string', description: 'For update: existing texture name.' },
            name: { type: 'string', description: 'For create: new texture name.' },
            width: { type: 'number', description: 'Texture width (pixels).' },
            height: { type: 'number', description: 'Texture height (pixels).' },
            background: { type: 'string', description: 'Optional fill color (hex). Applied before ops.' },
            useExisting: { type: 'boolean', description: 'For update: paint on top of the existing texture.' },
            detectNoChange: {
              type: 'boolean',
              description: 'For update: detect no-change by comparing the rendered image against the base (higher cost).'
            },
            uvPaint: uvPaintSchema,
            ops: {
              type: 'array',
              items: textureOpSchema
            }
          }
        }
      },
      presets: {
        type: 'array',
        minItems: 1,
        description: 'Optional: generate procedural preset textures (preferred for 64x64+).',
        items: {
          type: 'object',
          required: ['preset', 'width', 'height'],
          additionalProperties: false,
          properties: {
            preset: texturePresetSchema,
            width: { type: 'number', description: 'Preset texture width (pixels).' },
            height: { type: 'number', description: 'Preset texture height (pixels).' },
            name: { type: 'string', description: 'For create: new texture name.' },
            targetId: { type: 'string', description: 'For update: existing texture id.' },
            targetName: { type: 'string', description: 'For update: existing texture name.' },
            mode: { type: 'string', enum: ['create', 'update'] },
            seed: { type: 'number' },
            palette: { type: 'array', items: { type: 'string' } },
            uvPaint: uvPaintSchema
          }
        }
      },
      facePaint: {
        ...facePaintSchema,
        description:
          'Optional: face-centric painting. Maps material keywords to presets and targets cube faces without manual UVs.'
      },
      autoRecover: {
        type: 'boolean',
        description:
          'If true, runs a single plan-based UV recovery (no auto_uv_atlas) on overlap/scale/uvUsageId mismatch, then continue.'
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
      ifRevision: { type: 'string', description: 'Required for mutations. Get the latest revision from get_project_state.' },
      ...metaProps
    }
  },
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
      model: modelSpecSchema,
      texturePlan: {
        ...texturePlanSchema,
        description: 'Auto-plan textures + UVs from high-level intent (bootstrap for textures/UVs).'
      },
      textures: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['width', 'height'],
          additionalProperties: false,
          properties: {
            mode: { type: 'string', enum: ['create', 'update'] },
            id: { type: 'string' },
            targetId: { type: 'string' },
            targetName: { type: 'string' },
            name: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            background: { type: 'string' },
            useExisting: { type: 'boolean' },
            detectNoChange: {
              type: 'boolean',
              description: 'For update: detect no-change by comparing the rendered image against the base (higher cost).'
            },
            uvPaint: uvPaintSchema,
            ops: {
              type: 'array',
              items: textureOpSchema
            }
          }
        }
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
      autoRecover: { type: 'boolean' },
      animations: {
        type: 'array',
        items: entityAnimationSchema
      },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  }
};
