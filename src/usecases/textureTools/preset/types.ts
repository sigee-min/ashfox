import type { TexturePresetResult } from '../../../domain/texturePresets';
import type { UvPaintRect } from '../../../domain/uv/paintTypes';
import type { UvPaintSpec } from '../../../domain/uv/paintSpec';

export type TextureTarget = { id?: string; name: string };

export type TexturePresetContext = {
  label: string;
  width: number;
  height: number;
  uvPaintSpec: UvPaintSpec;
  rects: UvPaintRect[];
  mode: 'create' | 'update';
  target: TextureTarget | null;
  preset: TexturePresetResult;
};

