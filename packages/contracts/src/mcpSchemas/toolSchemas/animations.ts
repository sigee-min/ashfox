import type { JsonSchema } from '../types';
import { metaProps, numberArray, revisionProp } from '../schemas/common';

const poseBoneSchema: JsonSchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    rot: numberArray(3, 3),
    pos: numberArray(3, 3),
    scale: numberArray(3, 3),
    interp: { type: 'string', enum: ['linear', 'step', 'catmullrom'] }
  },
  anyOf: [{ required: ['rot'] }, { required: ['pos'] }, { required: ['scale'] }]
};

export const animationToolSchemas: Record<string, JsonSchema> = {
  create_animation_clip: {
    type: 'object',
    required: ['name', 'length', 'loop', 'fps'],
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      length: { type: 'number' },
      loop: { type: 'boolean' },
      fps: { type: 'number' },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  update_animation_clip: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      newName: { type: 'string' },
      length: { type: 'number' },
      loop: { type: 'boolean' },
      fps: { type: 'number' },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  delete_animation_clip: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      ids: { type: 'array', minItems: 1, items: { type: 'string' } },
      names: { type: 'array', minItems: 1, items: { type: 'string' } },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  set_frame_pose: {
    type: 'object',
    required: ['clip', 'frame', 'bones'],
    additionalProperties: false,
    properties: {
      clipId: { type: 'string' },
      clip: { type: 'string' },
      frame: { type: 'number' },
      bones: { type: 'array', minItems: 1, items: poseBoneSchema },
      interp: { type: 'string', enum: ['linear', 'step', 'catmullrom'] },
      ifRevision: revisionProp,
      ...metaProps
    }
  },
  set_trigger_keyframes: {
    type: 'object',
    required: ['clip', 'channel', 'keys'],
    additionalProperties: false,
    properties: {
      clipId: { type: 'string' },
      clip: { type: 'string' },
      channel: { type: 'string', enum: ['sound', 'particle', 'timeline'] },
      keys: {
        type: 'array',
        minItems: 1,
        maxItems: 1,
        items: {
          type: 'object',
          required: ['time', 'value'],
          additionalProperties: false,
          properties: {
            time: { type: 'number' },
            value: {}
          }
        }
      },
      ifRevision: revisionProp,
      ...metaProps
    }
  }
};


