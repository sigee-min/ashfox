import type { JsonSchema } from '../../types';
import { faceUvSchema } from '../../schemas/model';
import { textureOpSchema, texturePresetSchema, uvPaintSchema } from '../../schemas/texture';

export const texturePaintItemSchema: JsonSchema = {
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
};

export const presetItemSchema: JsonSchema = {
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
};

export const uvAssignmentItemSchema: JsonSchema = {
  type: 'object',
  required: ['faces'],
  additionalProperties: false,
  properties: {
    cubeId: { type: 'string' },
    cubeName: { type: 'string', description: 'Alternative to cubeId (less stable).' },
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
    faces: {
      ...faceUvSchema,
      description: 'Face UV updates. Values are [x1,y1,x2,y2] in texture pixels. UVs must fit within project textureResolution.'
    }
  }
};
