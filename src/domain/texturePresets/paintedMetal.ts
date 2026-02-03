import type { TexturePresetSpec } from '../texturePresetTypes';
import { PRESET_PALETTES } from '../texturePresetPalettes';
import { createRng, parseHex, resolvePalette, resolveSeed, setPixel, shade } from '../texturePresetUtils';

export const generatePaintedMetal = (spec: TexturePresetSpec, data: Uint8ClampedArray) => {
  const palette = resolvePalette(PRESET_PALETTES.painted_metal, spec.palette);
  const base = parseHex(palette.base, { r: 198, g: 55, b: 46 });
  const dark = parseHex(palette.dark, base);
  const light = parseHex(palette.light, base);
  const accent = parseHex(palette.accent, dark);
  const accent2 = parseHex(palette.accent2, dark);
  const rand = createRng(resolveSeed(spec.seed, `painted_metal:${spec.width}x${spec.height}`));
  const highlightRows = Math.max(2, Math.floor(spec.height * 0.15));
  const bandStart = Math.floor(spec.height * 0.35);
  const bandEnd = Math.min(spec.height, bandStart + Math.max(2, Math.floor(spec.height * 0.12)));
  for (let y = 0; y < spec.height; y += 1) {
    const inHighlight = y < highlightRows;
    const inBand = y >= bandStart && y <= bandEnd;
    for (let x = 0; x < spec.width; x += 1) {
      let color = base;
      const n = rand();
      if (n < 0.05) color = light;
      else if (n > 0.95) color = dark;
      if (inHighlight && x % 6 < 4) color = shade(light, 8);
      if (inBand && x % 6 < 3) color = shade(dark, -8);
      if (x % 12 === 0) color = accent;
      if (x % 24 === 0 && y % 8 < 2) color = accent2;
      setPixel(data, spec.width, x, y, color);
    }
  }
};
