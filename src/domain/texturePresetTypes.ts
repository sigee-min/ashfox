import type { TexturePresetName } from '../shared/toolConstants';
export type { TexturePresetName } from '../shared/toolConstants';

export type TexturePresetSpec = {
  preset: TexturePresetName;
  width: number;
  height: number;
  seed?: number;
  palette?: string[];
};

export type TextureCoverage = {
  opaquePixels: number;
  totalPixels: number;
  opaqueRatio: number;
  bounds?: { x1: number; y1: number; x2: number; y2: number };
};

export type TexturePresetResult = {
  width: number;
  height: number;
  seed: number;
  data: Uint8ClampedArray;
  coverage: TextureCoverage;
};
