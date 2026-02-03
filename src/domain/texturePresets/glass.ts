import type { TexturePresetSpec } from '../texturePresetTypes';
import { PRESET_PALETTES } from '../texturePresetPalettes';
import { createRng, parseHex, resolvePalette, resolveSeed, setPixel, shade } from '../texturePresetUtils';

export const generateGlass = (spec: TexturePresetSpec, data: Uint8ClampedArray) => {
  const palette = resolvePalette(PRESET_PALETTES.glass, spec.palette);
  const base = parseHex(palette.base, { r: 79, g: 134, b: 198 });
  const dark = parseHex(palette.dark, base);
  const light = parseHex(palette.light, base);
  const accent = parseHex(palette.accent, light);
  const accent2 = parseHex(palette.accent2, dark);
  const rand = createRng(resolveSeed(spec.seed, `glass:${spec.width}x${spec.height}`));
  for (let y = 0; y < spec.height; y += 1) {
    const gradient = 1 - y / Math.max(1, spec.height - 1);
    const tint = gradient > 0.7 ? 8 : gradient > 0.45 ? 4 : 0;
    for (let x = 0; x < spec.width; x += 1) {
      let color = shade(base, tint);
      if (x - y > 4 && x - y < 10) color = accent;
      if (x + y > spec.width + spec.height - 10) color = accent2;
      if (x === 0 || y === 0 || x === spec.width - 1 || y === spec.height - 1) color = dark;
      const n = rand();
      if (n < 0.03) color = light;
      else if (n > 0.98) color = dark;
      setPixel(data, spec.width, x, y, color);
    }
  }
};
