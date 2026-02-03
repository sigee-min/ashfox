import type { TexturePresetSpec } from '../texturePresetTypes';
import { PRESET_PALETTES } from '../texturePresetPalettes';
import { createRng, parseHex, resolvePalette, resolveSeed, setPixel } from '../texturePresetUtils';

export const generatePlant = (spec: TexturePresetSpec, data: Uint8ClampedArray) => {
  const palette = resolvePalette(PRESET_PALETTES.plant, spec.palette);
  const base = parseHex(palette.base, { r: 63, g: 138, b: 58 });
  const dark = parseHex(palette.dark, base);
  const light = parseHex(palette.light, base);
  const accent = parseHex(palette.accent, light);
  const rand = createRng(resolveSeed(spec.seed, `plant:${spec.width}x${spec.height}`));
  for (let y = 0; y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) {
      let color = base;
      if (x % 7 === 0 && rand() < 0.6) color = accent;
      if (y % 6 === 0 && rand() < 0.5) color = dark;
      const n = rand();
      if (n < 0.05) color = light;
      else if (n > 0.95) color = dark;
      setPixel(data, spec.width, x, y, color);
    }
  }
};
