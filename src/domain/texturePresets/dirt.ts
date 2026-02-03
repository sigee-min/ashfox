import type { TexturePresetSpec } from '../texturePresetTypes';
import { PRESET_PALETTES } from '../texturePresetPalettes';
import { createRng, parseHex, resolvePalette, resolveSeed, setPixel } from '../texturePresetUtils';

export const generateDirt = (spec: TexturePresetSpec, data: Uint8ClampedArray) => {
  const palette = resolvePalette(PRESET_PALETTES.dirt, spec.palette);
  const base = parseHex(palette.base, { r: 75, g: 47, b: 26 });
  const dark = parseHex(palette.dark, base);
  const light = parseHex(palette.light, base);
  const accent = parseHex(palette.accent, dark);
  const rand = createRng(resolveSeed(spec.seed, `dirt:${spec.width}x${spec.height}`));
  for (let y = 0; y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) {
      let color = base;
      const n = rand();
      if (n < 0.08) color = light;
      else if (n > 0.93) color = dark;
      if ((x + y) % 7 === 0 && rand() < 0.4) color = accent;
      setPixel(data, spec.width, x, y, color);
    }
  }
};
