import type { JsonSchema } from '../types';
import { TEXTURE_PLAN_DETAILS, TEXTURE_PRESET_NAMES, UV_PAINT_MAPPINGS, UV_PAINT_SCOPES } from '../../texturePolicy';
import { cubeFaceSchema, numberArray } from './common';

export const texturePresetSchema: JsonSchema = {
  type: 'string',
  description: 'Texture preset id. Use generate_texture_preset for 64x64+ to avoid large payloads.',
  enum: TEXTURE_PRESET_NAMES
};

export const textureOpSchema: JsonSchema = {
  type: 'object',
  required: ['op'],
  additionalProperties: false,
  properties: {
    op: {
      type: 'string',
      enum: ['set_pixel', 'fill_rect', 'draw_rect', 'draw_line'],
      description: 'Drawing operation. Coordinates are in source-canvas pixels (not UV pixels). Prefer presets for large textures.'
    },
    x: { type: 'number', description: 'X coordinate (pixels).' },
    y: { type: 'number', description: 'Y coordinate (pixels).' },
    width: { type: 'number', description: 'Width (pixels).' },
    height: { type: 'number', description: 'Height (pixels).' },
    x1: { type: 'number', description: 'Line start X (pixels).' },
    y1: { type: 'number', description: 'Line start Y (pixels).' },
    x2: { type: 'number', description: 'Line end X (pixels).' },
    y2: { type: 'number', description: 'Line end Y (pixels).' },
    color: { type: 'string', description: 'Color in hex (e.g., \"#ff00aa\" or \"#ff00aaff\").' },
    lineWidth: { type: 'number', description: 'Stroke width (pixels).' }
  }
};

export const uvPaintSchema: JsonSchema = {
  type: 'object',
  description:
    'UV-first painting config. A source canvas is painted using ops/background, then stretched/tiled into target UV rects. Full-texture painting is not supported; map UVs to the full texture for whole-coverage results.',
  additionalProperties: false,
  properties: {
    scope: {
      type: 'string',
      enum: UV_PAINT_SCOPES,
      description: 'What to paint: per-face, per-UV-rect, or full UV bounds.'
    },
    mapping: {
      type: 'string',
      enum: UV_PAINT_MAPPINGS,
      description: 'How to map the source canvas into UV rects: stretch once or tile.'
    },
    padding: { type: 'number', description: 'Extra pixels around each UV rect to reduce seams (>= 0).' },
    anchor: {
      ...numberArray(2, 2),
      description: 'Anchor offset [x,y] in source pixels for stretch/tile alignment.'
    },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height'],
      properties: {
        width: { type: 'number', description: 'Source canvas width (pixels).' },
        height: { type: 'number', description: 'Source canvas height (pixels).' }
      }
    },
    target: {
      type: 'object',
      description: 'Optional target filter. Omit to paint all UV rects in the mapping table.',
      additionalProperties: false,
      properties: {
        cubeIds: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'Limit painting to these cube ids. If cubeNames is also provided, both must match.'
        },
        cubeNames: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'Limit painting to these cube names. If cubeIds is also provided, both must match.'
        },
        faces: {
          type: 'array',
          minItems: 1,
          items: cubeFaceSchema,
          description: 'Limit painting to these cube faces.'
        }
      }
    }
  }
};

const facePaintEntrySchema: JsonSchema = {
  type: 'object',
  description: 'Face-centric material paint instruction (maps to texture presets + UV targets).',
  additionalProperties: false,
  required: ['material'],
  properties: {
    material: { type: 'string', description: 'Material keyword (e.g., metal, wood, rubber).' },
    palette: { type: 'array', items: { type: 'string' } },
    seed: { type: 'number' },
    cubeIds: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: 'Limit painting to these cube ids. If cubeNames is also provided, both must match.'
    },
    cubeNames: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: 'Limit painting to these cube names. If cubeIds is also provided, both must match.'
    },
    faces: { type: 'array', minItems: 1, items: cubeFaceSchema },
    scope: { type: 'string', enum: UV_PAINT_SCOPES },
    mapping: { type: 'string', enum: UV_PAINT_MAPPINGS },
    padding: { type: 'number' },
    anchor: numberArray(2, 2)
  }
};

export const facePaintSchema: JsonSchema = {
  type: 'array',
  minItems: 1,
  items: facePaintEntrySchema
};

export const texturePlanSchema: JsonSchema = {
  type: 'object',
  description: 'Auto-plan textures + UVs from high-level intent. When provided, assignment/UV steps are generated automatically.',
  additionalProperties: false,
  properties: {
    name: { type: 'string', description: 'Base texture name for generated textures.' },
    detail: { type: 'string', enum: TEXTURE_PLAN_DETAILS },
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
