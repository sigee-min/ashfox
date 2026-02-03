import type { TexturePresetSpec } from '../texturePresetTypes';
import { PRESET_PALETTES } from '../texturePresetPalettes';
import { createRng, parseHex, resolvePalette, resolveSeed, setPixel, shade } from '../texturePresetUtils';

export const generateCeramic = (spec: TexturePresetSpec, data: Uint8ClampedArray) => {
  const palette = resolvePalette(PRESET_PALETTES.ceramic, spec.palette);
  const base = parseHex(palette.base, { r: 215, g: 215, b: 209 });
  const dark = parseHex(palette.dark, base);
  const light = parseHex(palette.light, base);
  const accent = parseHex(palette.accent, base);
  const accent2 = parseHex(palette.accent2, light);
  const rand = createRng(resolveSeed(spec.seed, `ceramic:${spec.width}x${spec.height}`));
  const denom = Math.max(1, spec.width + spec.height - 2);
  for (let y = 0; y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) {
      const gradient = 1 - (x + y) / denom;
      const tint = gradient > 0.7 ? 6 : gradient > 0.45 ? 3 : 0;
      let color = shade(base, tint);
      if (x === 0 || y === 0 || x === spec.width - 1 || y === spec.height - 1) color = dark;
      const n = rand();
      if (n < 0.04) color = light;
      else if (n > 0.98) color = accent;
      if ((x + y) % 13 === 0 && rand() < 0.08) color = accent2;
      setPixel(data, spec.width, x, y, color);
    }
  }
};
