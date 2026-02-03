import type { TexturePresetSpec } from '../texturePresetTypes';
import { PRESET_PALETTES } from '../texturePresetPalettes';
import { createRng, parseHex, resolvePalette, resolveSeed, setPixel } from '../texturePresetUtils';

export const generateStone = (spec: TexturePresetSpec, data: Uint8ClampedArray) => {
  const palette = resolvePalette(PRESET_PALETTES.stone, spec.palette);
  const base = parseHex(palette.base, { r: 122, g: 122, b: 122 });
  const dark = parseHex(palette.dark, base);
  const light = parseHex(palette.light, base);
  const accent = parseHex(palette.accent, dark);
  const accent2 = parseHex(palette.accent2, light);
  const rand = createRng(resolveSeed(spec.seed, `stone:${spec.width}x${spec.height}`));
  for (let y = 0; y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) {
      let color = base;
      const n = rand();
      if (n < 0.08) color = light;
      else if (n > 0.93) color = dark;
      if ((x * 3 + y * 5) % 37 === 0 && rand() < 0.6) color = accent;
      if ((x + y) % 17 === 0 && rand() < 0.35) color = accent2;
      if (((x >> 2) + (y >> 2)) % 3 === 0 && rand() < 0.12) color = dark;
      setPixel(data, spec.width, x, y, color);
    }
  }
};
