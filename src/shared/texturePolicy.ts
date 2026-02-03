export const TEXTURE_PRESET_NAMES = [
  'painted_metal',
  'rubber',
  'glass',
  'wood',
  'dirt',
  'plant',
  'stone',
  'sand',
  'leather',
  'fabric',
  'ceramic'
] as const;

export const TEXTURE_PLAN_DETAILS = ['low', 'medium', 'high'] as const;
export const UV_PAINT_SCOPES = ['faces', 'rects', 'bounds'] as const;
export const UV_PAINT_MAPPINGS = ['stretch', 'tile'] as const;

export const AUTO_PLAN_MAX_RESOLUTION = 512;
export const AUTO_PLAN_DEFAULT_MAX_TEXTURES = 4;
export const AUTO_PLAN_MAX_TEXTURES = 16;

export type TexturePresetName = typeof TEXTURE_PRESET_NAMES[number];
export type TexturePlanDetail = typeof TEXTURE_PLAN_DETAILS[number];
export type UvPaintScope = typeof UV_PAINT_SCOPES[number];
export type UvPaintMapping = typeof UV_PAINT_MAPPINGS[number];

export const TEXTURE_PRESET_NAME_SET = new Set<string>(TEXTURE_PRESET_NAMES);
export const TEXTURE_PLAN_DETAIL_SET = new Set<string>(TEXTURE_PLAN_DETAILS);
export const UV_PAINT_SCOPE_SET = new Set<string>(UV_PAINT_SCOPES);
export const UV_PAINT_MAPPING_SET = new Set<string>(UV_PAINT_MAPPINGS);
