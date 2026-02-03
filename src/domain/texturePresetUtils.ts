import { hashTextToInt } from '../shared/hash';
import type { TextureCoverage } from './texturePresetTypes';

export type Rgb = { r: number; g: number; b: number };

export const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export const resolveSeed = (seed: number | undefined, fallback: string) =>
  Number.isFinite(seed) ? (seed as number) : hashTextToInt(fallback);

export const createRng = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
};

export const parseHex = (value: string, fallback: Rgb): Rgb => {
  const hex = String(value ?? '').replace('#', '');
  if (hex.length !== 6) return fallback;
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return fallback;
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
};

export const shade = (color: Rgb, delta: number): Rgb => ({
  r: clampByte(color.r + delta),
  g: clampByte(color.g + delta),
  b: clampByte(color.b + delta)
});

export const setPixel = (data: Uint8ClampedArray, width: number, x: number, y: number, color: Rgb) => {
  const idx = (y * width + x) * 4;
  data[idx] = color.r;
  data[idx + 1] = color.g;
  data[idx + 2] = color.b;
  data[idx + 3] = 255;
};

export const resolvePalette = (defaults: Record<string, string>, palette?: string[]) => ({
  base: palette?.[0] ?? defaults.base,
  dark: palette?.[1] ?? defaults.dark,
  light: palette?.[2] ?? defaults.light,
  accent: palette?.[3] ?? defaults.accent,
  accent2: palette?.[4] ?? defaults.accent2
});

export const computeCoverage = (data: Uint8ClampedArray, width: number, height: number): TextureCoverage => {
  const totalPixels = width * height;
  let opaquePixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    opaquePixels += 1;
    const idx = i / 4;
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const bounds =
    opaquePixels > 0 ? { x1: minX, y1: minY, x2: maxX, y2: maxY } : undefined;
  return {
    opaquePixels,
    totalPixels,
    opaqueRatio: totalPixels > 0 ? opaquePixels / totalPixels : 0,
    bounds
  };
};
