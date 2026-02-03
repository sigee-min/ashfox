import type { TexturePresetSpec } from '../texturePresetTypes';
import { PRESET_PALETTES } from '../texturePresetPalettes';
import { createRng, parseHex, resolvePalette, resolveSeed, setPixel } from '../texturePresetUtils';

export const generateFabric = (spec: TexturePresetSpec, data: Uint8ClampedArray) => {
  const palette = resolvePalette(PRESET_PALETTES.fabric, spec.palette);
  const base = parseHex(palette.base, { r: 123, g: 127, b: 138 });
  const dark = parseHex(palette.dark, base);
  const light = parseHex(palette.light, base);
  const accent = parseHex(palette.accent, light);
  const accent2 = parseHex(palette.accent2, dark);
  const rand = createRng(resolveSeed(spec.seed, `fabric:${spec.width}x${spec.height}`));
  for (let y = 0; y < spec.height; y += 1) {
    const weaveY = y % 4;
    for (let x = 0; x < spec.width; x += 1) {
      const weaveX = x % 4;
      let color = base;
      if (weaveX === 0 || weaveY === 0) color = dark;
      if (weaveX === 2 && weaveY === 2) color = accent;
      if (weaveX === 0 && weaveY === 0) color = accent2;
      const n = rand();
      if (n < 0.05) color = light;
      else if (n > 0.98) color = dark;
      setPixel(data, spec.width, x, y, color);
    }
  }
};
