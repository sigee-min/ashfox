import type { JsonSchema } from '../types';
import { ENTITY_ANIMATION_CHANNELS, ENTITY_ANIMATION_TRIGGER_TYPES } from '../../toolConstants';
import { numberArray } from './common';

const entityAnimationChannelSchema: JsonSchema = {
  type: 'object',
  required: ['bone', 'channel', 'keys'],
  additionalProperties: false,
  properties: {
    bone: { type: 'string' },
    channel: { type: 'string', enum: ENTITY_ANIMATION_CHANNELS },
    keys: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['time', 'value'],
        additionalProperties: false,
        properties: {
          time: { type: 'number' },
          value: numberArray(3, 3),
          interp: { type: 'string', enum: ['linear', 'step', 'catmullrom'] }
        }
      }
    }
  }
};

const entityAnimationTriggerSchema: JsonSchema = {
  type: 'object',
  required: ['type', 'keys'],
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ENTITY_ANIMATION_TRIGGER_TYPES },
    keys: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['time', 'value'],
        additionalProperties: false,
        properties: {
          time: { type: 'number' },
          value: {}
        }
      }
    }
  }
};

export const entityAnimationSchema: JsonSchema = {
  type: 'object',
  required: ['name', 'length', 'loop'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    length: { type: 'number' },
    loop: { type: 'boolean' },
    fps: { type: 'number' },
    mode: { type: 'string', enum: ['create', 'update'] },
    channels: {
      type: 'array',
      items: entityAnimationChannelSchema
    },
    triggers: {
      type: 'array',
      items: entityAnimationTriggerSchema
    }
  }
};
