import type { TexturePresetSpec } from '../texturePresetTypes';
import { PRESET_PALETTES } from '../texturePresetPalettes';
import { createRng, parseHex, resolvePalette, resolveSeed, setPixel } from '../texturePresetUtils';

export const generateSand = (spec: TexturePresetSpec, data: Uint8ClampedArray) => {
  const palette = resolvePalette(PRESET_PALETTES.sand, spec.palette);
  const base = parseHex(palette.base, { r: 216, g: 192, b: 138 });
  const dark = parseHex(palette.dark, base);
  const light = parseHex(palette.light, base);
  const accent = parseHex(palette.accent, base);
  const accent2 = parseHex(palette.accent2, light);
  const rand = createRng(resolveSeed(spec.seed, `sand:${spec.width}x${spec.height}`));
  for (let y = 0; y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) {
      let color = base;
      const n = rand();
      if (n < 0.12) color = light;
      else if (n > 0.96) color = dark;
      if ((x + y) % 5 === 0 && rand() < 0.35) color = accent;
      if ((x * 2 - y + spec.width) % 11 === 0 && rand() < 0.2) color = accent2;
      setPixel(data, spec.width, x, y, color);
    }
  }
};
