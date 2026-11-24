export type TextureRenderMode = 'default' | 'emissive' | 'additive' | 'layered' | string;

export type TextureRenderSides = 'auto' | 'front' | 'double' | string;

export const TEXTURE_PBR_CHANNELS = Object.freeze(['color', 'normal', 'height', 'mer'] as const);
export type TexturePbrChannel = (typeof TEXTURE_PBR_CHANNELS)[number];

export const TEXTURE_FRAME_ORDER_TYPES = Object.freeze([
  'custom',
  'loop',
  'backwards',
  'back_and_forth',
] as const);
export type TextureFrameOrderType = (typeof TEXTURE_FRAME_ORDER_TYPES)[number];

export type TextureMeta = {
  readonly namespace?: string;
  readonly folder?: string;
  readonly particle?: boolean;
  readonly visible?: boolean;
  readonly renderMode?: TextureRenderMode;
  readonly renderSides?: TextureRenderSides;
  readonly pbrChannel?: TexturePbrChannel;
  readonly group?: string;
  readonly frameTime?: number;
  readonly frameOrderType?: TextureFrameOrderType;
  readonly frameOrder?: string;
  readonly frameInterpolate?: boolean;
  readonly internal?: boolean;
  readonly keepSize?: boolean;
};
