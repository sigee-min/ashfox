import type { JsonSchema } from '../types';

export const TEXTURE_HEX_COLOR_PATTERN = '^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$';

export const TEXTURE_OP_LIMITS = Object.freeze({
  coordinateMagnitude: 65_536,
  extent: 65_536,
  lineWidth: 2_048,
});

const coordinateSchema: JsonSchema = {
  type: 'number',
  minimum: -TEXTURE_OP_LIMITS.coordinateMagnitude,
  maximum: TEXTURE_OP_LIMITS.coordinateMagnitude,
  description: 'Coordinate in source-canvas pixels (not UV pixels).',
};

const extentSchema: JsonSchema = {
  type: 'number',
  minimum: 1,
  maximum: TEXTURE_OP_LIMITS.extent,
  description: 'Positive extent in source-canvas pixels.',
};

const colorSchema: JsonSchema = {
  type: 'string',
  pattern: TEXTURE_HEX_COLOR_PATTERN,
  description: 'Color in hex (for example, "#ff00aa" or "#ff00aaff").',
};

const lineWidthSchema: JsonSchema = {
  type: 'number',
  minimum: 1,
  maximum: TEXTURE_OP_LIMITS.lineWidth,
  description: 'Positive stroke width in source-canvas pixels.',
};

const opSchema = (op: string): JsonSchema => ({
  type: 'string',
  enum: [op],
});

export const textureOpSchema: JsonSchema = {
  type: 'object',
  anyOf: [
    {
      type: 'object',
      required: ['op', 'x', 'y', 'color'],
      additionalProperties: false,
      properties: {
        op: opSchema('set_pixel'),
        x: coordinateSchema,
        y: coordinateSchema,
        color: colorSchema,
      },
    },
    {
      type: 'object',
      required: ['op', 'x', 'y', 'width', 'height', 'color'],
      additionalProperties: false,
      properties: {
        op: opSchema('fill_rect'),
        x: coordinateSchema,
        y: coordinateSchema,
        width: extentSchema,
        height: extentSchema,
        color: colorSchema,
      },
    },
    {
      type: 'object',
      required: ['op', 'x', 'y', 'width', 'height', 'color'],
      additionalProperties: false,
      properties: {
        op: opSchema('draw_rect'),
        x: coordinateSchema,
        y: coordinateSchema,
        width: extentSchema,
        height: extentSchema,
        color: colorSchema,
        lineWidth: lineWidthSchema,
      },
    },
    {
      type: 'object',
      required: ['op', 'x1', 'y1', 'x2', 'y2', 'color'],
      additionalProperties: false,
      properties: {
        op: opSchema('draw_line'),
        x1: coordinateSchema,
        y1: coordinateSchema,
        x2: coordinateSchema,
        y2: coordinateSchema,
        color: colorSchema,
        lineWidth: lineWidthSchema,
      },
    },
  ],
};
