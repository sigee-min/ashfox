import type { SpriteProduct } from '../../compiler/sprite/contract';
import { hexToOklch, relativeLuminance } from '../../textures/oklch';

export interface SpriteRasterStats {
  readonly width: number;
  readonly height: number;
  readonly opaqueCount: number;
  readonly opaqueRatio: number;
  readonly boundsFillRatio: number;
  readonly centerOffset: number;
  readonly strayPixelCount: number;
  readonly lumRange: number;
  readonly lumP10: number;
  readonly lumP90: number;
  readonly darkCrushRate: number;
  readonly topBottomContrast: number;
  readonly hueShiftDegrees: number;
  readonly uniqueColors: number;
  readonly isolatedNoiseRate: number;
  readonly checkerRate: number;
  readonly wrapSeamJump: number;
}

const hexAt = (rgba: Uint8Array, i: number): string =>
  '#' +
  [rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('');

const colorDist = (rgba: Uint8Array, a: number, b: number): number => {
  const ia = a * 4,
    ib = b * 4;
  return (
    (Math.abs(rgba[ia]! - rgba[ib]!) +
      Math.abs(rgba[ia + 1]! - rgba[ib + 1]!) +
      Math.abs(rgba[ia + 2]! - rgba[ib + 2]!)) /
    765
  );
};

const hasOpaqueNeighbor = (rgba: Uint8Array, w: number, h: number, x: number, y: number): boolean =>
  (x > 0 && rgba[(y * w + x - 1) * 4 + 3]! > 0) ||
  (x + 1 < w && rgba[(y * w + x + 1) * 4 + 3]! > 0) ||
  (y > 0 && rgba[((y - 1) * w + x) * 4 + 3]! > 0) ||
  (y + 1 < h && rgba[((y + 1) * w + x) * 4 + 3]! > 0);

const countStrayPixels = (rgba: Uint8Array, w: number, h: number): number => {
  let stray = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (rgba[(y * w + x) * 4 + 3]! > 0 && !hasOpaqueNeighbor(rgba, w, h, x, y)) stray += 1;
    }
  }
  return stray;
};

const computeWrapSeamJump = (rgba: Uint8Array, w: number, h: number): number => {
  let internalSum = 0,
    internalCount = 0;
  for (let y = 0; y < h - 1; y += 1) {
    for (let x = 0; x < w - 1; x += 1) {
      const i = y * w + x;
      internalSum += colorDist(rgba, i, i + 1) + colorDist(rgba, i, i + w);
      internalCount += 2;
    }
  }
  let seamSum = 0,
    seamCount = 0;
  for (let x = 0; x < w; x += 1) {
    seamSum += colorDist(rgba, x, (h - 1) * w + x);
    seamCount += 1;
  }
  for (let y = 0; y < h; y += 1) {
    seamSum += colorDist(rgba, y * w, y * w + w - 1);
    seamCount += 1;
  }
  const meanInternal = internalCount > 0 ? internalSum / internalCount : 0;
  const meanSeam = seamCount > 0 ? seamSum / seamCount : 0;
  return Math.max(0, meanSeam - meanInternal * 1.15);
};

const isOpaque = (rgba: Uint8Array, idx: number): boolean => rgba[idx * 4 + 3]! > 0;

const isIsolatedNoisyPixel = (rgba: Uint8Array, w: number, i: number): boolean =>
  isOpaque(rgba, i - 1) &&
  isOpaque(rgba, i + 1) &&
  isOpaque(rgba, i - w) &&
  isOpaque(rgba, i + w) &&
  colorDist(rgba, i, i - 1) > 0.04 &&
  colorDist(rgba, i, i + 1) > 0.04 &&
  colorDist(rgba, i, i - w) > 0.04 &&
  colorDist(rgba, i, i + w) > 0.04;

const isCheckerPixel = (rgba: Uint8Array, w: number, i: number): boolean =>
  isOpaque(rgba, i - w - 1) &&
  isOpaque(rgba, i + w + 1) &&
  isOpaque(rgba, i - 1) &&
  isOpaque(rgba, i + 1) &&
  colorDist(rgba, i, i - w - 1) < 0.03 &&
  colorDist(rgba, i, i + w + 1) < 0.03 &&
  colorDist(rgba, i, i - 1) > 0.07 &&
  colorDist(rgba, i, i + 1) > 0.07;

const computeNoiseAndChecker = (
  rgba: Uint8Array,
  w: number,
  h: number,
): { readonly isolatedNoiseRate: number; readonly checkerRate: number } => {
  let active = 0,
    isolated = 0,
    checker = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      if (rgba[i * 4 + 3] === 0) continue;
      active += 1;
      if (isIsolatedNoisyPixel(rgba, w, i)) isolated += 1;
      if (isCheckerPixel(rgba, w, i)) checker += 1;
    }
  }
  return {
    isolatedNoiseRate: active > 0 ? isolated / active : 0,
    checkerRate: active > 0 ? checker / active : 0,
  };
};

const hueDelta = (a: number, b: number): number => {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
};

interface PixelAccum {
  readonly lums: number[];
  readonly colors: Set<string>;
  readonly darkHues: number[];
  readonly lightHues: number[];
  sumX: number;
  sumY: number;
  crushed: number;
  topSum: number;
  topN: number;
  botSum: number;
  botN: number;
}

const recordOpaquePixel = (
  acc: PixelAccum,
  rgba: Uint8Array,
  w: number,
  x: number,
  y: number,
  midY: number,
): void => {
  const i = y * w + x;
  if (rgba[i * 4 + 3] === 0) return;
  const hex = hexAt(rgba, i);
  const lum = relativeLuminance(hex);
  acc.colors.add(hex);
  acc.lums.push(lum);
  acc.sumX += x + 0.5;
  acc.sumY += y + 0.5;
  if (lum < 0.14) acc.crushed += 1;
  if (y < midY) {
    acc.topSum += lum;
    acc.topN += 1;
  } else {
    acc.botSum += lum;
    acc.botN += 1;
  }
  const oklch = hexToOklch(hex);
  if (oklch.c > 0.025) {
    if (lum < 0.35) acc.darkHues.push(oklch.h);
    if (lum > 0.45) acc.lightHues.push(oklch.h);
  }
};

const collectPixelAccum = (rgba: Uint8Array, w: number, h: number, midY: number): PixelAccum => {
  const acc: PixelAccum = {
    lums: [],
    colors: new Set(),
    darkHues: [],
    lightHues: [],
    sumX: 0,
    sumY: 0,
    crushed: 0,
    topSum: 0,
    topN: 0,
    botSum: 0,
    botN: 0,
  };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) recordOpaquePixel(acc, rgba, w, x, y, midY);
  }
  return acc;
};

const meanOf = (vals: readonly number[], fallback = 0): number =>
  vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : fallback;

export const analyzeSpriteRaster = (sprite: SpriteProduct): SpriteRasterStats => {
  const w = sprite.raster.width,
    h = sprite.raster.height;
  const rgba = sprite.raster.rgba.copy();
  const [bx0, by0, bx1, by1] = sprite.receipt.bounds;
  const acc = collectPixelAccum(rgba, w, h, (by0 + by1) * 0.5);
  const n = acc.lums.length;
  acc.lums.sort((a, b) => a - b);
  const avgDarkHue = meanOf(acc.darkHues);
  const avgLightHue = meanOf(acc.lightHues, avgDarkHue);
  const cx = n > 0 ? acc.sumX / n : w / 2,
    cy = n > 0 ? acc.sumY / n : h / 2;
  const { isolatedNoiseRate, checkerRate } = computeNoiseAndChecker(rgba, w, h);
  return {
    width: w,
    height: h,
    opaqueCount: n,
    opaqueRatio: n / (w * h),
    boundsFillRatio: n / (Math.max(1, bx1 - bx0) * Math.max(1, by1 - by0)),
    centerOffset: Math.hypot((cx - w / 2) / (w / 2), (cy - h / 2) / (h / 2)),
    strayPixelCount: countStrayPixels(rgba, w, h),
    lumRange: n > 0 ? acc.lums[n - 1]! - acc.lums[0]! : 0,
    lumP10: n > 0 ? acc.lums[Math.floor(n * 0.1)]! : 0,
    lumP90: n > 0 ? acc.lums[Math.min(n - 1, Math.floor(n * 0.9))]! : 0,
    darkCrushRate: n > 0 ? acc.crushed / n : 0,
    topBottomContrast:
      acc.topN > 0 && acc.botN > 0 ? Math.max(0, acc.topSum / acc.topN - acc.botSum / acc.botN) : 0,
    hueShiftDegrees:
      acc.darkHues.length && acc.lightHues.length ? hueDelta(avgDarkHue, avgLightHue) : 0,
    uniqueColors: acc.colors.size,
    isolatedNoiseRate,
    checkerRate,
    wrapSeamJump: computeWrapSeamJump(rgba, w, h),
  };
};
