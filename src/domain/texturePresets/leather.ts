import type { TexturePresetSpec } from '../texturePresetTypes';
import { PRESET_PALETTES } from '../texturePresetPalettes';
import { createRng, parseHex, resolvePalette, resolveSeed, setPixel } from '../texturePresetUtils';

export const generateLeather = (spec: TexturePresetSpec, data: Uint8ClampedArray) => {
  const palette = resolvePalette(PRESET_PALETTES.leather, spec.palette);
  const base = parseHex(palette.base, { r: 123, g: 75, b: 42 });
  const dark = parseHex(palette.dark, base);
  const light = parseHex(palette.light, base);
  const accent = parseHex(palette.accent, dark);
  const accent2 = parseHex(palette.accent2, light);
  const rand = createRng(resolveSeed(spec.seed, `leather:${spec.width}x${spec.height}`));
  for (let y = 0; y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) {
      let color = base;
      if ((x + y) % 9 === 0 && rand() < 0.5) color = dark;
      if (x % 11 === 0 && rand() < 0.2) color = accent;
      const n = rand();
      if (n < 0.06) color = light;
      else if (n > 0.95) color = dark;
      if (y % 8 === 0 && rand() < 0.25) color = accent2;
      setPixel(data, spec.width, x, y, color);
    }
  }
};
