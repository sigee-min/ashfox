import type { SpriteMaterial } from '../../project/sprite/contract';
import { expandRampFive, generateHueShiftedRamp } from '../../textures/oklch';

export type FiveToneRamp = readonly [string, string, string, string, string];

/** Build a 5-stop perceptual OKLCH ramp for a Sprite v2 material. */
export const materialRamp = (material: SpriteMaterial): FiveToneRamp => {
  if (material.ramp.mode === 'explicit') {
    const c = material.ramp.colors;
    return c.length === 5 ? c : expandRampFive(c);
  }
  return expandRampFive(generateHueShiftedRamp(material.ramp.base, material.ramp.preset));
};

export const buildMaterialRamps = (
  materials: readonly SpriteMaterial[],
): ReadonlyMap<string, FiveToneRamp> => {
  const map = new Map<string, FiveToneRamp>();
  for (const m of materials) map.set(m.id, materialRamp(m));
  return map;
};
