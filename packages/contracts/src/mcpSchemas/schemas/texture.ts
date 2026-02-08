import type { JsonSchema } from '../types';

export const textureOpSchema: JsonSchema = {
  type: 'object',
  required: ['op'],
  additionalProperties: false,
  properties: {
    op: {
      type: 'string',
      enum: ['set_pixel', 'fill_rect', 'draw_rect', 'draw_line'],
      description: 'Drawing operation. Coordinates are in source-canvas pixels (not UV pixels).'
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
    lineWidth: { type: 'number', description: 'Stroke width (pixels).' },
    shade: {
      description:
        'Fill shading for fill_rect. Defaults to enabled; set false (or enabled:false) to disable. Object values tune the effect.',
      anyOf: [
        { type: 'boolean' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean', description: 'Enable/disable shading.' },
            intensity: { type: 'number', description: 'Directional shading intensity (0..1).' },
            edge: { type: 'number', description: 'Edge darkening strength (0..1).' },
            noise: { type: 'number', description: 'Per-pixel tonal noise strength (0..1).' },
            seed: { type: 'number', description: 'Deterministic shading seed.' },
            lightDir: {
              type: 'string',
              enum: ['tl_br', 'tr_bl', 'top_bottom', 'left_right'],
              description: 'Light direction for directional gradient.'
            }
          }
        }
      ]
    }
  }
};



