import {
  expandRampFive,
  generateHueShiftedRamp,
  lerpOklchHex,
  relativeLuminance,
  type RampPreset,
} from '../../textures/oklch';

export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: string;
  readonly alpha: 0 | 255;
}

export type FiveToneRamp = readonly [string, string, string, string, string];

const RAMP_CACHE = new Map<string, FiveToneRamp>();

export const ramp = (hex: string, preset: RampPreset): FiveToneRamp => {
  const key = `${hex}:${preset}`;
  const cached = RAMP_CACHE.get(key);
  if (cached) return cached;
  const built = expandRampFive(generateHueShiftedRamp(hex, preset));
  RAMP_CACHE.set(key, built);
  return built;
};

export const hash3 = (a: number, b: number, c: number): number => {
  let h = (a * 374761393 + b * 668265263 + c * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
};

export const r = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: 0 | 255 = 255,
): TileRect => ({ x, y, w, h, color, alpha });

export const deepTone = (tone: string, amount = 0.42): string =>
  lerpOklchHex(tone, '#1b1d24', amount);

const calmTone = (base: string, target: string, weight: number, maxRelDelta = 0.11): string => {
  const blended = lerpOklchHex(base, target, weight);
  const la = relativeLuminance(base);
  const lb = relativeLuminance(blended);
  const diff = Math.abs(la - lb) / Math.max(la, lb, 0.05);
  if (diff <= maxRelDelta) return blended;
  return lerpOklchHex(base, blended, maxRelDelta / diff);
};

export const paintPlanks = (
  baseHex: string,
  seed: number,
  variant: number,
  darkBias = false,
): readonly TileRect[] => {
  const [t0, t1, t2, t3] = ramp(baseHex, 'wood');
  const mid = darkBias ? lerpOklchHex(t1, t2, 0.45) : t2;
  const alt = calmTone(mid, t1, 0.35, 0.08);
  const lift = calmTone(mid, t3, 0.28, 0.08);
  const joint = calmTone(mid, t0, 0.55, 0.11);
  const grain = calmTone(mid, t1, 0.25, 0.07);
  const peg = calmTone(joint, t0, 0.35, 0.11);
  const out: TileRect[] = [r(0, 0, 16, 16, mid)];
  const vSeed = seed + variant * 31;
  for (let row = 0; row < 2; row += 1) {
    const y = row * 8;
    const tone = (hash3(row, variant, seed) & 1) === 0 ? mid : alt;
    out.push(r(0, y, 16, 8, tone), r(0, y, 16, 1, lift), r(0, y + 7, 16, 1, joint));
    const jx = (hash3(row + 7, vSeed, 3) % 10) + 3;
    out.push(r(jx, y, 1, 8, joint), r((jx + 1) % 16, y + 2, 1, 1, peg));
    out.push(r((jx + 14) % 16, y + 5, 1, 1, peg));
    const gx = (hash3(row + 13, vSeed, 5) % 8) + 1;
    out.push(r(gx, y + 3, 5, 1, grain), r((gx + 7) % 10, y + 5, 4, 1, lift));
  }
  return out;
};

export const paintWash = (
  tones: readonly string[],
  seed: number,
  variant: number,
): readonly TileRect[] => {
  const base = tones[variant % tones.length]!;
  const out: TileRect[] = [r(0, 0, 16, 16, base)];
  for (let i = 0; i < 6; i += 1) {
    const x = hash3(i, variant, seed + 17) % 12;
    const y = hash3(i + 11, variant, seed + 29) % 13;
    const w = i % 2 === 0 ? 8 : 6;
    const h = 4;
    const tone = tones[hash3(i + 23, variant, seed + 43) % tones.length]!;
    out.push(r(x, y, Math.min(w, 16 - x), Math.min(h, 16 - y), tone));
  }
  return out;
};

export const paintLogSide = (
  baseHex: string,
  seed: number,
  variant: number,
): readonly TileRect[] => {
  const [t0, t1, t2, t3] = ramp(baseHex, 'wood');
  const furrow = deepTone(t0, 0.34);
  const out: TileRect[] = [r(0, 0, 16, 16, t1)];
  for (let x = 0; x < 16; x += 2) {
    const h = hash3(x, variant, seed) % 3;
    out.push(r(x, 0, 1, 16, h === 0 ? furrow : h === 1 ? t2 : t0));
  }
  const ky = (hash3(variant, seed, 19) % 10) + 2;
  const kx = (hash3(seed, variant, 23) % 10) + 3;
  out.push(r(kx, ky, 2, 3, furrow), r(kx + 1, ky + 1, 1, 1, t3));
  return out;
};

export const paintLogTop = (barkHex: string, coreHex: string): readonly TileRect[] => {
  const [b0, b1] = ramp(barkHex, 'wood');
  const [c0, c1, c2, c3] = ramp(coreHex, 'wood');
  return [
    r(0, 0, 16, 16, deepTone(b0, 0.28)),
    r(1, 1, 14, 14, b1),
    r(2, 2, 12, 12, c2),
    r(3, 3, 10, 10, c1),
    r(5, 5, 6, 6, c3),
    r(7, 7, 2, 2, c0),
  ];
};

const paintMossOverlay = (out: TileRect[], seed: number, variant: number): void => {
  const [m0, m1, m2] = ramp('#55873f', 'organic');
  for (let i = 0; i < 4; i += 1) {
    const mx = hash3(i, variant, seed + 41) % 12;
    const my = hash3(i + 5, variant, seed + 59) % 13;
    out.push(r(mx, my, 4, 2, m1), r(mx + 1, my, 2, 1, m2), r(mx + 1, my + 2, 2, 1, m0));
  }
};

const pushBrick = (
  out: TileRect[],
  bx: number,
  y0: number,
  h: number,
  tone: string,
  hi: string,
  lo: string,
): void => {
  const bw = 7;
  const end = Math.min(16, bx + bw);
  const bh = Math.max(1, h - 1);
  out.push(r(bx, y0 + 1, end - bx, bh, tone), r(bx, y0 + 1, end - bx, 1, hi));
  if (bx + bw > 16) {
    const wrapW = bx + bw - 16;
    out.push(r(0, y0 + 1, wrapW, bh, tone), r(0, y0 + 1, wrapW, 1, hi));
  }
  if (h >= 3) out.push(r((bx + 2) % 16, y0 + h - 1, 3, 1, lo));
};

export const paintMasonry = (
  baseHex: string,
  preset: RampPreset,
  mortarHex: string,
  rows: number,
  seed: number,
  variant: number,
  moss = false,
): readonly TileRect[] => {
  const [t0, t1, t2, t3] = ramp(baseHex, preset);
  const tones = [lerpOklchHex(t2, t1, 0.35), t2, t2, lerpOklchHex(t2, t3, 0.28)];
  const out: TileRect[] = [r(0, 0, 16, 16, mortarHex)];
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor((row * 16) / rows);
    const y1 = Math.floor(((row + 1) * 16) / rows);
    const h = Math.max(2, y1 - y0);
    const shift = row % 2 === 0 ? 0 : 4;
    for (let col = 0; col < 2; col += 1) {
      const bx = (shift + col * 8) % 16;
      const tone = tones[hash3(row * 3 + col, variant, seed) % tones.length]!;
      pushBrick(out, bx, y0, h, tone, lerpOklchHex(tone, t3, 0.24), lerpOklchHex(tone, t0, 0.2));
    }
  }
  if (moss) paintMossOverlay(out, seed, variant);
  return out;
};

const COBBLE_STONES: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 7, 4],
  [8, 0, 8, 5],
  [1, 6, 5, 4],
  [7, 6, 6, 4],
  [14, 6, 2, 4],
  [0, 11, 8, 4],
  [9, 11, 7, 4],
];

export const paintCobble = (
  baseHex: string,
  seed: number,
  variant: number,
  moss = false,
): readonly TileRect[] => {
  const [t0, t1, t2, t3] = ramp(baseHex, 'stone');
  const mortar = deepTone(t0, 0.28);
  const fills = [lerpOklchHex(t2, t1, 0.35), t2, lerpOklchHex(t2, t3, 0.25), t2];
  const out: TileRect[] = [r(0, 0, 16, 16, mortar)];
  for (let i = 0; i < COBBLE_STONES.length; i += 1) {
    const [sx, sy, sw, sh] = COBBLE_STONES[i]!;
    const dx = (hash3(i, variant, seed) % 3) - 1;
    const x = Math.max(0, Math.min(15, sx + (sx > 0 && sx < 13 ? dx : 0)));
    const w = Math.max(2, Math.min(16 - x, sw));
    const fill = fills[hash3(i + 9, variant, seed) % fills.length]!;
    out.push(
      r(x, sy, w, sh, fill),
      r(x, sy, Math.max(1, w - 1), 1, lerpOklchHex(fill, t3, 0.24)),
      r(x, sy + sh - 1, w, 1, lerpOklchHex(fill, t0, 0.24)),
    );
  }
  if (moss) paintMossOverlay(out, seed, variant);
  return out;
};

export const paintSlate = (baseHex: string, seed: number, variant: number): readonly TileRect[] => {
  const [t0, t1, t2, t3] = ramp(baseHex, 'stone');
  const edge = deepTone(t0, 0.24);
  const tones = [lerpOklchHex(t2, t1, 0.35), t2, lerpOklchHex(t2, t3, 0.22)];
  const out: TileRect[] = [r(0, 0, 16, 16, edge)];
  for (let row = 0; row < 4; row += 1) {
    const y = row * 4;
    const off = (row % 2) * 3;
    for (let col = 0; col < 3; col += 1) {
      const x = (col * 5 + off) % 16;
      const w = Math.min(4, 16 - x);
      const tone = tones[hash3(row * 4 + col, variant, seed) % tones.length]!;
      out.push(
        r(x, y, w, 3, tone),
        r(x, y + 2, w, 1, lerpOklchHex(tone, t3, 0.16)),
        r(x, y + 3, w, 1, edge),
      );
    }
  }
  return out;
};

const leafTone = (h: number, tones: FiveToneRamp): string => {
  const [t0, t1, t2, t3, t4] = tones;
  if (h < 4) return deepTone(t0, 0.25);
  if (h < 6) return t1;
  if (h < 8) return t2;
  return h === 8 ? t3 : t4;
};

export const paintLeaves = (
  baseHex: string,
  seed: number,
  variant: number,
): readonly TileRect[] => {
  const tones = ramp(baseHex, 'organic');
  const out: TileRect[] = [r(0, 0, 16, 16, '#000000', 0)];
  for (let y = 0; y < 16; y += 2) {
    for (let x = 0; x < 16; x += 2) {
      const h = hash3(x + variant * 7, y + variant * 11, seed) % 10;
      if (h >= 2) out.push(r(x, y, 2, 2, leafTone(h, tones)));
    }
  }
  return out;
};

export const paintWindowGlow = (): readonly TileRect[] => [
  r(0, 0, 16, 16, '#3b2b1e'),
  r(1, 1, 14, 14, '#543e2b'),
  r(2, 2, 12, 12, '#ffaa45'),
  r(3, 3, 10, 10, '#ffc061'),
  r(4, 4, 8, 8, '#ffd685'),
  r(6, 6, 4, 4, '#ffe5a6'),
  r(7, 2, 1, 12, '#4d3826'),
  r(2, 7, 12, 1, '#4d3826'),
];

export const paintTimberTrim = (variant: number): readonly TileRect[] => {
  const grains = ['#4c321d', '#543821', '#5c3e26', '#624228'];
  const base = grains[(variant & 1) + 1]!;
  return [
    r(0, 0, 16, 16, base),
    r(0, 0, 16, 2, '#624228'),
    r(0, 14, 16, 2, '#4c321d'),
    r(2 + (variant % 3), 4, 8, 2, '#5c3e26'),
    r(4, 8, 9, 2, '#4c321d'),
    r(1, 11, 7, 1, '#624228'),
  ];
};

export const paintHearthEmber = (variant: number): readonly TileRect[] => {
  const shift = variant & 1;
  return [
    r(0, 0, 16, 16, '#2e1910'),
    r(1, 2, 14, 13, '#5c2410'),
    r(2, 3, 12, 11, '#ff6e1a'),
    r(3, 4, 10, 8, '#ff9830'),
    r(4 + shift, 5, 7, 6, '#ffc652'),
    r(5 + shift, 6, 4, 4, '#ffe47a'),
    r(2, 13, 3, 2, '#3d2215'),
    r(11, 13, 3, 2, '#3d2215'),
  ];
};

export const paintFlowerBox = (variant: number): readonly TileRect[] => {
  const shift = (variant & 1) * 2;
  return [
    r(0, 0, 16, 11, '#386928'),
    r(1, 2, 14, 8, '#4c8738'),
    r(3, 1, 4, 4, '#5f9e46'),
    r(9, 2, 5, 4, '#5f9e46'),
    r(0, 10, 16, 6, '#593a22'),
    r(0, 10, 16, 2, '#6e492b'),
    r(0, 14, 16, 2, '#422a17'),
    r(2 + shift, 3, 3, 3, '#e66b4c'),
    r(3 + shift, 4, 1, 1, '#fff0a8'),
    r(7, 5, 3, 3, '#f0c44d'),
    r(8, 6, 1, 1, '#fff0a8'),
    r(11 - shift, 2, 3, 3, '#e66b4c'),
    r(12 - shift, 3, 1, 1, '#fff0a8'),
  ];
};

export const paintIronFlue = (variant: number): readonly TileRect[] => {
  const off = variant & 1;
  return [
    r(0, 0, 16, 16, '#464c56'),
    r(2 + off, 0, 2, 16, '#525966'),
    r(6, 0, 2, 16, '#3c414a'),
    r(10 + off, 0, 3, 16, '#525966'),
    r(0, 3, 16, 2, '#353a42'),
    r(0, 12, 16, 2, '#353a42'),
    r(3, 3, 1, 1, '#596170'),
    r(12, 3, 1, 1, '#596170'),
    r(3, 12, 1, 1, '#596170'),
    r(12, 12, 1, 1, '#596170'),
  ];
};
