import type { TexturePresetSpec } from '../texturePresetTypes';
import { PRESET_PALETTES } from '../texturePresetPalettes';
import { createRng, parseHex, resolvePalette, resolveSeed, setPixel, shade } from '../texturePresetUtils';

export const generateWood = (spec: TexturePresetSpec, data: Uint8ClampedArray) => {
  const palette = resolvePalette(PRESET_PALETTES.wood, spec.palette);
  const base = parseHex(palette.base, { r: 182, g: 134, b: 84 });
  const dark = parseHex(palette.dark, base);
  const light = parseHex(palette.light, base);
  const seam = parseHex(palette.accent, dark);
  const rand = createRng(resolveSeed(spec.seed, `wood:${spec.width}x${spec.height}`));
  const planks = Math.max(2, Math.floor(spec.width / 12));
  const plankWidth = Math.floor(spec.width / planks);
  const plankBases = Array.from({ length: planks }, () =>
    rand() < 0.5 ? base : shade(base, rand() < 0.5 ? -8 : 8)
  );
  for (let y = 0; y < spec.height; y += 1) {
    const grain = y % 6 === 0 || y % 7 === 0;
    for (let x = 0; x < spec.width; x += 1) {
      const plank = Math.min(planks - 1, Math.floor(x / plankWidth));
      const xIn = x % plankWidth;
      let color = plankBases[plank];
      if (xIn === 0) color = seam;
      if (grain && rand() < 0.5) color = dark;
      const n = rand();
      if (n < 0.06) color = light;
      else if (n > 0.94) color = dark;
      setPixel(data, spec.width, x, y, color);
    }
  }
};
