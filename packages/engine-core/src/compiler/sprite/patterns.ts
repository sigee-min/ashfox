import type { SpritePatternSpec } from '../../project/sprite/contract';

export interface PatternSample {
  readonly active: boolean;
  readonly material: string;
  readonly toneDelta: number;
  readonly blend?: number;
  readonly isMortar?: boolean;
}

const wrapCoord = (v: number, size: number, wrap: boolean): number =>
  wrap ? ((v % size) + size) % size : v;

const hash2d = (x: number, y: number, seed: number): number => {
  let v = (Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x119de1f3) ^ Math.imul(seed, 0x27d4eb2d)) >>> 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x45d9f3b) >>> 0;
  v ^= v >>> 13;
  return ((v ^ (v >>> 16)) >>> 0) / 0xffffffff;
};

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

const toroidalNoise = (
  x: number,
  y: number,
  w: number,
  h: number,
  freqX: number,
  freqY: number,
  seed: number,
  wrap: boolean,
): number => {
  const fx = ((x + 0.5) / Math.max(1, w)) * freqX;
  const fy = ((y + 0.5) / Math.max(1, h)) * freqY;
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy);
  const tx = smoothstep(fx - x0),
    ty = smoothstep(fy - y0);
  const x1 = wrap ? (x0 + 1) % freqX : x0 + 1;
  const y1 = wrap ? (y0 + 1) % freqY : y0 + 1;
  const wx0 = wrap ? ((x0 % freqX) + freqX) % freqX : x0;
  const wy0 = wrap ? ((y0 % freqY) + freqY) % freqY : y0;
  const a = hash2d(wx0, wy0, seed),
    b = hash2d(x1, wy0, seed);
  const c = hash2d(wx0, y1, seed),
    d = hash2d(x1, y1, seed);
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
};

const toroidalFbm = (
  x: number,
  y: number,
  w: number,
  h: number,
  freq: number,
  seed: number,
  wrap: boolean,
): number => {
  const n1 = toroidalNoise(x, y, w, h, freq, freq, seed, wrap);
  const n2 = toroidalNoise(x, y, w, h, freq * 2, freq * 2, seed + 137, wrap);
  return Math.max(0, Math.min(1, 0.5 + (0.68 * n1 + 0.32 * n2 - 0.5) * 1.85));
};

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const gradientProgress = (
  axis: 'x' | 'y' | 'radial',
  lx: number,
  ly: number,
  bw: number,
  bh: number,
): number => {
  if (axis === 'x') return lx / Math.max(1, bw - 1);
  if (axis === 'y') return ly / Math.max(1, bh - 1);
  return Math.min(
    1,
    Math.hypot(
      (lx - (bw - 1) / 2) / Math.max(1, bw / 2),
      (ly - (bh - 1) / 2) / Math.max(1, bh / 2),
    ),
  );
};

const gradientMaterialSample = (
  toMaterial: string,
  dither: boolean,
  t: number,
  bayer: number,
  baseMaterial: string,
): PatternSample => {
  if (dither) {
    const pick = t > bayer;
    return { active: pick, material: pick ? toMaterial : baseMaterial, toneDelta: 0 };
  }
  const blend = Math.round(Math.max(0, Math.min(1, t)) * 3) / 3;
  if (blend <= 0) return { active: false, material: baseMaterial, toneDelta: 0 };
  return { active: true, material: toMaterial, toneDelta: 0, blend };
};

const evalGradient = (
  p: Extract<SpritePatternSpec, { kind: 'gradient' }>,
  x: number,
  y: number,
  lx: number,
  ly: number,
  bw: number,
  bh: number,
  baseMaterial: string,
): PatternSample => {
  const t = gradientProgress(p.axis, lx, ly, bw, bh);
  const bayer = (BAYER_4X4[y & 3]![x & 3]! + 0.5) / 16;
  if (p.toMaterial) return gradientMaterialSample(p.toMaterial, p.dither, t, bayer, baseMaterial);
  const ditherDark = p.dither && t > bayer ? -1 : 0;
  const toneDelta = t < 0.28 ? 1 : t > 0.72 ? -1 : ditherDark;
  return { active: toneDelta !== 0, material: baseMaterial, toneDelta };
};

const evalBlotch = (
  p: Extract<SpritePatternSpec, { kind: 'blotch' }>,
  x: number,
  y: number,
  w: number,
  h: number,
  wrap: boolean,
  baseMaterial: string,
): PatternSample => {
  const freq = Math.max(3, Math.round(Math.max(w, h) / Math.max(2, p.scale)));
  const n = toroidalFbm(x, y, w, h, freq, p.seed, wrap);
  if (n >= p.density) return { active: false, material: baseMaterial, toneDelta: 0 };
  const nShadow = toroidalFbm(x + 1, y + 1, w, h, freq, p.seed, wrap);
  const delta = nShadow - n > 0.06 ? 1 : n < p.density * 0.35 ? -1 : 0;
  return p.toMaterial
    ? { active: true, material: p.toMaterial, toneDelta: delta }
    : { active: true, material: baseMaterial, toneDelta: -1 };
};

const evalStripe = (
  p: Extract<SpritePatternSpec, { kind: 'stripe' }>,
  x: number,
  y: number,
  baseMaterial: string,
): PatternSample => {
  const coord = p.axis === 'x' ? x : p.axis === 'y' ? y : p.axis === 'diag_pos' ? x + y : x - y;
  const mod = (((coord + p.offset) % p.period) + p.period) % p.period;
  if (mod >= p.width) return { active: false, material: baseMaterial, toneDelta: 0 };
  return p.toMaterial
    ? { active: true, material: p.toMaterial, toneDelta: 0 }
    : { active: true, material: baseMaterial, toneDelta: 1 };
};

const evalBrick = (
  p: Extract<SpritePatternSpec, { kind: 'brick' }>,
  x: number,
  y: number,
  w: number,
  h: number,
  wrap: boolean,
  baseMaterial: string,
): PatternSample => {
  const row = Math.floor(y / p.height);
  const ry = y % p.height;
  const shiftedX = wrapCoord(x + (row % 2 === 1 ? p.stagger : 0), w, wrap);
  const col = Math.floor(shiftedX / p.width);
  const rx = shiftedX % p.width;
  if (ry < p.mortar || rx < p.mortar) {
    return {
      active: true,
      material: p.mortarMaterial ?? baseMaterial,
      toneDelta: -2,
      isMortar: true,
    };
  }
  const cols = Math.max(1, Math.round(w / p.width));
  const rows = Math.max(1, Math.round(h / p.height));
  const wCol = wrap ? ((col % cols) + cols) % cols : col;
  const wRow = wrap ? ((row % rows) + rows) % rows : row;
  const variation = hash2d(wCol, wRow, p.seed);
  const bevel = ry === p.mortar || rx === p.mortar ? 1 : ry === p.height - 1 ? -1 : 0;
  const delta = bevel + (variation < 0.25 ? -1 : variation > 0.78 ? 1 : 0);
  return { active: true, material: baseMaterial, toneDelta: Math.max(-2, Math.min(2, delta)) };
};

const plankBevelDelta = (ry: number, height: number, joint: number, endDist: number): number => {
  if (ry === joint) return 1;
  if (ry === height - 1 || endDist === joint) return -1;
  return 0;
};

const plankBodyDelta = (
  wRow: number,
  x: number,
  y: number,
  w: number,
  h: number,
  wrap: boolean,
  jointX: number,
  seed: number,
): number => {
  const plankTint = hash2d(wRow, x < jointX ? 1 : 2, seed + 53);
  const fiber = toroidalNoise(x, y, w, h, 3, Math.max(4, h), seed + wRow * 31, wrap);
  const fiberDelta = fiber < 0.34 ? -1 : fiber > 0.72 ? 1 : 0;
  const tintDelta = plankTint < 0.25 ? -1 : plankTint > 0.75 ? 1 : 0;
  return fiberDelta + tintDelta;
};

const evalPlank = (
  p: Extract<SpritePatternSpec, { kind: 'plank' }>,
  x: number,
  y: number,
  w: number,
  h: number,
  wrap: boolean,
  baseMaterial: string,
): PatternSample => {
  const row = Math.floor(y / p.height);
  const ry = y % p.height;
  const rows = Math.max(1, Math.round(h / p.height));
  const wRow = wrap ? ((row % rows) + rows) % rows : row;
  const jointX = Math.floor((0.2 + 0.6 * hash2d(wRow, 17, p.seed)) * w);
  const rawDist = Math.abs(x - jointX);
  const endDist = wrap ? Math.min(rawDist, w - rawDist) : rawDist;
  if (ry < p.joint || endDist < p.joint) {
    return {
      active: true,
      material: p.mortarMaterial ?? baseMaterial,
      toneDelta: -2,
      isMortar: true,
    };
  }
  const bevel = plankBevelDelta(ry, p.height, p.joint, endDist);
  const body = bevel === 0 ? plankBodyDelta(wRow, x, y, w, h, wrap, jointX, p.seed) : 0;
  return {
    active: true,
    material: baseMaterial,
    toneDelta: Math.max(-2, Math.min(2, bevel + body)),
  };
};

interface VoronoiHit {
  readonly best: number;
  readonly second: number;
  readonly bestCell: number;
  readonly dx: number;
  readonly dy: number;
  readonly cellR: number;
}

const nearestVoronoiCell = (
  p: Extract<SpritePatternSpec, { kind: 'voronoi' }>,
  x: number,
  y: number,
  w: number,
  h: number,
  wrap: boolean,
): VoronoiHit => {
  const gridN = Math.max(2, Math.round(Math.sqrt(p.cells)));
  const cellW = w / gridN,
    cellH = h / gridN;
  const gx = Math.floor(x / cellW),
    gy = Math.floor(y / cellH);
  let best = 1e9,
    second = 1e9,
    bestCell = 0,
    bestDx = 0,
    bestDy = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cx = wrap ? (((gx + dx) % gridN) + gridN) % gridN : gx + dx;
      const cy = wrap ? (((gy + dy) % gridN) + gridN) % gridN : gy + dy;
      const fx = (gx + dx + 0.5 + (hash2d(cx, cy, p.seed) - 0.5) * p.jitter) * cellW;
      const fy = (gy + dy + 0.5 + (hash2d(cx, cy, p.seed + 7919) - 0.5) * p.jitter) * cellH;
      const ox = x + 0.5 - fx,
        oy = y + 0.5 - fy;
      const d = Math.hypot(ox, oy);
      if (d < best) {
        second = best;
        best = d;
        bestCell = cx * 37 + cy * 131;
        bestDx = ox;
        bestDy = oy;
      } else if (d < second) second = d;
    }
  }
  return { best, second, bestCell, dx: bestDx, dy: bestDy, cellR: (cellW + cellH) * 0.25 };
};

const voronoiBevelDelta = (edgeDist: number, lightAlign: number): number => {
  const high = edgeDist < 1.8 ? 0.1 : 0.48;
  const low = edgeDist < 1.8 ? -0.1 : -0.58;
  if (lightAlign > high) return 1;
  if (lightAlign < low) return -1;
  return 0;
};

const evalVoronoi = (
  p: Extract<SpritePatternSpec, { kind: 'voronoi' }>,
  x: number,
  y: number,
  w: number,
  h: number,
  wrap: boolean,
  baseMaterial: string,
): PatternSample => {
  const { best, second, bestCell, dx, dy, cellR } = nearestVoronoiCell(p, x, y, w, h, wrap);
  const mortarEdge = p.edgeWidth * 1.05;
  if (p.edgeWidth > 0 && second - best < mortarEdge) {
    return {
      active: true,
      material: p.edgeMaterial ?? baseMaterial,
      toneDelta: -2,
      isMortar: true,
    };
  }
  const bevel = voronoiBevelDelta(second - best - mortarEdge, -(dx + dy) / Math.max(1, cellR));
  const tint = hash2d(bestCell, 3, p.seed);
  const stoneVar = tint < 0.28 ? -1 : tint > 0.74 ? 1 : 0;
  return {
    active: true,
    material: baseMaterial,
    toneDelta: Math.max(-2, Math.min(2, bevel + stoneVar)),
  };
};

const wrapDelta = (d: number, size: number, wrap: boolean): number => {
  if (!wrap) return d;
  if (d > size * 0.5) return d - size;
  if (d < -size * 0.5) return d + size;
  return d;
};

const evalCrack = (
  p: Extract<SpritePatternSpec, { kind: 'crack' }>,
  x: number,
  y: number,
  w: number,
  h: number,
  wrap: boolean,
  baseMaterial: string,
): PatternSample => {
  for (let i = 0; i < p.count; i += 1) {
    const x1 = hash2d(i, 1, p.seed) * w,
      y1 = hash2d(i, 2, p.seed) * h;
    const angle = hash2d(i, 3, p.seed) * Math.PI * 2;
    const len = (0.18 + hash2d(i, 4, p.seed) * 0.16) * Math.min(w, h);
    const ux = Math.cos(angle),
      uy = Math.sin(angle);
    const rx = wrapDelta(x + 0.5 - x1, w, wrap);
    const ry = wrapDelta(y + 0.5 - y1, h, wrap);
    const along = rx * ux + ry * uy;
    if (along < 0 || along > len) continue;
    const wobble = Math.sin((along / Math.max(1, len)) * Math.PI * 2 + i * 2.1) * 0.9;
    const perp = Math.abs(-rx * uy + ry * ux - wobble);
    if (perp <= 0.55) {
      return {
        active: true,
        material: p.crackMaterial ?? baseMaterial,
        toneDelta: -1,
      };
    }
  }
  return { active: false, material: baseMaterial, toneDelta: 0 };
};

/** Evaluate a Sprite v2 2D procedural pattern at canvas pixel (x, y) and local bounds (lx, ly). */
export const evaluatePattern = (
  pattern: SpritePatternSpec,
  x: number,
  y: number,
  w: number,
  h: number,
  wrap: boolean,
  baseMaterial: string,
  lx = x,
  ly = y,
  bw = w,
  bh = h,
): PatternSample => {
  if (pattern.kind === 'solid') return { active: true, material: baseMaterial, toneDelta: 0 };
  if (pattern.kind === 'gradient') return evalGradient(pattern, x, y, lx, ly, bw, bh, baseMaterial);
  if (pattern.kind === 'blotch') return evalBlotch(pattern, x, y, w, h, wrap, baseMaterial);
  if (pattern.kind === 'stripe') return evalStripe(pattern, x, y, baseMaterial);
  if (pattern.kind === 'brick') return evalBrick(pattern, x, y, w, h, wrap, baseMaterial);
  if (pattern.kind === 'plank') return evalPlank(pattern, x, y, w, h, wrap, baseMaterial);
  if (pattern.kind === 'voronoi') return evalVoronoi(pattern, x, y, w, h, wrap, baseMaterial);
  if (pattern.kind === 'crack') return evalCrack(pattern, x, y, w, h, wrap, baseMaterial);
  const hit =
    pattern.mode === 'bayer'
      ? (BAYER_4X4[y & 3]![x & 3]! + 0.5) / 16 < pattern.density
      : hash2d(Math.floor(x / 2), Math.floor(y / 2), pattern.seed) < pattern.density;
  if (!hit) return { active: false, material: baseMaterial, toneDelta: 0 };
  return pattern.toMaterial
    ? { active: true, material: pattern.toMaterial, toneDelta: 0 }
    : { active: true, material: baseMaterial, toneDelta: -1 };
};
