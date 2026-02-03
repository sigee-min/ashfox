import type { TexturePresetSpec } from '../texturePresetTypes';
import { PRESET_PALETTES } from '../texturePresetPalettes';
import { createRng, parseHex, resolvePalette, resolveSeed, setPixel } from '../texturePresetUtils';

export const generateRubber = (spec: TexturePresetSpec, data: Uint8ClampedArray) => {
  const palette = resolvePalette(PRESET_PALETTES.rubber, spec.palette);
  const base = parseHex(palette.base, { r: 47, g: 47, b: 47 });
  const dark = parseHex(palette.dark, base);
  const light = parseHex(palette.light, base);
  const accent = parseHex(palette.accent, light);
  const rand = createRng(resolveSeed(spec.seed, `rubber:${spec.width}x${spec.height}`));
  for (let y = 0; y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) {
      let color = base;
      if ((x + y) % 10 < 2 || (x - y + spec.width) % 12 < 2) color = dark;
      if (x % 8 === 0 || y % 8 === 0) color = accent;
      const n = rand();
      if (n < 0.04) color = light;
      else if (n > 0.97) color = dark;
      setPixel(data, spec.width, x, y, color);
    }
  }
};
