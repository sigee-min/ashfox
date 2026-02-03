import { PRESET_GENERATORS } from './texturePresetGenerators';
import type { TexturePresetResult, TexturePresetSpec } from './texturePresetTypes';
import { computeCoverage, resolveSeed } from './texturePresetUtils';

export type { TexturePresetName, TexturePresetResult, TexturePresetSpec, TextureCoverage } from './texturePresetTypes';
export { computeCoverage } from './texturePresetUtils';

export const generateTexturePreset = (spec: TexturePresetSpec): TexturePresetResult => {
  const width = Math.max(1, Math.floor(spec.width));
  const height = Math.max(1, Math.floor(spec.height));
  const seed = resolveSeed(spec.seed, `${spec.preset}:${width}x${height}`);
  const data = new Uint8ClampedArray(width * height * 4);
  const presetSpec = { ...spec, width, height, seed };
  const generator = PRESET_GENERATORS[spec.preset] ?? PRESET_GENERATORS.painted_metal;
  generator(presetSpec, data);
  const coverage = computeCoverage(data, width, height);
  return { width, height, seed, data, coverage };
};
