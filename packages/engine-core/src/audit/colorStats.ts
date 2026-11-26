import { ramp } from './contract';

export interface ColorStatsAcc {
  totalOpaque: number;
  darkCrushed: number;
  chromaticTotal: number;
  neonCount: number;
  readonly hueBuckets: Uint32Array;
}

export const createColorStatsAcc = (): ColorStatsAcc => ({
  totalOpaque: 0,
  darkCrushed: 0,
  chromaticTotal: 0,
  neonCount: 0,
  hueBuckets: new Uint32Array(12),
});

const hslHueDegrees = (rn: number, gn: number, bn: number, max: number, d: number): number => {
  if (max === rn) return ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  if (max === gn) return ((bn - rn) / d + 2) * 60;
  return ((rn - gn) / d + 4) * 60;
};

const recordHslSample = (acc: ColorStatsAcc, r: number, g: number, b: number): void => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) * 0.5;
  const d = max - min;
  if (d <= 1e-5) return;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  if (s > 0.85) acc.neonCount += 1;
  if (s < 0.2 || l < 0.12 || l > 0.9) return;
  const deg = hslHueDegrees(rn, gn, bn, max, d);
  acc.chromaticTotal += 1;
  const bucket = Math.floor((((deg % 360) + 360) % 360) / 30) % 12;
  acc.hueBuckets[bucket] = (acc.hueBuckets[bucket] ?? 0) + 1;
};

export const recordColorPixelWithLuma = (
  acc: ColorStatsAcc,
  r: number,
  g: number,
  b: number,
  luma: number,
  isEmissive: boolean,
): void => {
  acc.totalOpaque += 1;
  if (luma < 0.14) acc.darkCrushed += 1;
  if (!isEmissive) recordHslSample(acc, r, g, b);
};

export const finalizeColorStats = (
  acc: ColorStatsAcc,
): { readonly darkCrushRate: number; readonly paletteHarmonyScore: number } => {
  if (acc.totalOpaque === 0) return { darkCrushRate: 0, paletteHarmonyScore: 0 };
  const darkCrushRate = acc.darkCrushed / acc.totalOpaque;
  const neonRate = acc.neonCount / acc.totalOpaque;
  let activeBuckets = 0;
  if (acc.chromaticTotal > 0) {
    for (let i = 0; i < 12; i += 1) {
      if (acc.hueBuckets[i]! / acc.chromaticTotal >= 0.02) activeBuckets += 1;
    }
  }
  const bucketPenalty = ramp(activeBuckets, 3, 6) * 0.55;
  const neonPenalty = ramp(neonRate, 0.05, 0.3) * 0.45;
  return {
    darkCrushRate,
    paletteHarmonyScore: Math.max(0, 1 - bucketPenalty - neonPenalty),
  };
};
