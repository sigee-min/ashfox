import { LIGHTS, type SpriteGrain, type SpriteShade } from '../../project/sprite/contract';

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const normalize = (x: number, y: number, z: number): readonly [number, number, number] => {
  const len = Math.max(1e-6, Math.hypot(x, y, z));
  return [x / len, y / len, z / len];
};

const roundNormal = (
  x: number,
  y: number,
  w: number,
  h: number,
): readonly [number, number, number] => {
  let u = (2 * x + 1 - w) / Math.max(1, w);
  let v = (2 * y + 1 - h) / Math.max(1, h);
  const r2 = u * u + v * v;
  if (r2 > 0.96) {
    const scale = Math.sqrt(0.96 / r2);
    u *= scale;
    v *= scale;
  }
  const nz = Math.sqrt(Math.max(0.04, 1 - u * u - v * v));
  return normalize(u, v, nz);
};

const bevelNormal = (
  shade: SpriteShade,
  cx: number,
  cy: number,
): readonly [number, number, number] => {
  const [a, b] = shade.axis!;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len,
    uy = dy / len;
  const px = -uy,
    py = ux;
  const d = (cx + 0.5 - a[0]) * px + (cy + 0.5 - a[1]) * py;
  const t = clamp(((cx + 0.5 - a[0]) * ux + (cy + 0.5 - a[1]) * uy) / len, 0, 1);
  if (Math.abs(d) < 0.7) {
    return normalize((t - 0.5) * ux * 0.25, (t - 0.5) * uy * 0.25, 0.96);
  }
  const side = Math.sign(d);
  return normalize(
    px * side * 0.8 + ux * (t - 0.5) * 0.22,
    py * side * 0.8 + uy * (t - 0.5) * 0.22,
    0.56,
  );
};

const cylinderNormal = (
  shade: SpriteShade,
  cx: number,
  cy: number,
  w: number,
  h: number,
): readonly [number, number, number] => {
  const [a, b] = shade.axis!;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const len = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / len,
    py = dx / len;
  const radius = Math.max(1.4, Math.min(w, h) * 0.45);
  const signed = clamp(((cx + 0.5 - a[0]) * px + (cy + 0.5 - a[1]) * py) / radius, -0.95, 0.95);
  const nz = Math.sqrt(Math.max(0.05, 1 - signed * signed));
  return normalize(signed * px, signed * py, nz);
};

const facetNormal = (
  x: number,
  y: number,
  w: number,
  h: number,
): readonly [number, number, number] => {
  const u = (2 * x + 1 - w) / Math.max(1, w);
  const v = (2 * y + 1 - h) / Math.max(1, h);
  if (v < -0.35 + Math.abs(u) * 0.55) return normalize(u * 0.4, -0.78, 0.56);
  if (u - 0.22 * v < -0.18) return normalize(-0.78, -0.18, 0.6);
  if (u + 0.22 * v > 0.18) return normalize(0.78, 0.24, 0.58);
  if (v > 0.42) return normalize(0.15, 0.78, 0.55);
  return normalize(-0.12, -0.1, 0.98);
};

const normalFor = (
  shade: SpriteShade,
  lx: number,
  ly: number,
  bw: number,
  bh: number,
  cx: number,
  cy: number,
): readonly [number, number, number] => {
  if (shade.form === 'round') return roundNormal(lx, ly, bw, bh);
  if (shade.form === 'bevel') return bevelNormal(shade, cx, cy);
  if (shade.form === 'cylinder') return cylinderNormal(shade, cx, cy, bw, bh);
  return facetNormal(lx, ly, bw, bh);
};

const toneBand = (score: number): number =>
  score <= -0.5 ? 0 : score <= -0.14 ? 1 : score < 0.22 ? 2 : score < 0.52 ? 3 : 4;

/** Stylized surface field with 5 form modes, 8 light directions, and tight Blinn-Phong specular. */
export const baseTone = (
  shade: SpriteShade,
  lx: number,
  ly: number,
  bw: number,
  bh: number,
  cx = lx,
  cy = ly,
): number => {
  if (shade.contrast === 0 || shade.form === 'flat') return 2;
  const [ldx, ldy] = LIGHTS[shade.light];
  const [L0, L1, L2] = normalize(ldx * 0.85, ldy * 0.85, 0.72);
  const [nx, ny, nz] = normalFor(shade, lx, ly, bw, bh, cx, cy);
  const ndotl = nx * L0 + ny * L1 + nz * L2;
  const [hx, hy, hz] = normalize(L0, L1, L2 + 1);
  const ndoth = Math.max(0, nx * hx + ny * hy + nz * hz);
  const spec = shade.specular > 0 ? Math.pow(ndoth, 12) * shade.specular * 0.45 : 0;
  const lit = (ndotl - 0.5) * (0.48 + 0.32 * shade.contrast) + spec;
  return toneBand(lit);
};

const hashCell = (cx: number, cy: number, seed: number): number => {
  let v = (seed ^ Math.imul(cx + 1, 0x9e3779b1) ^ Math.imul(cy + 1, 0x85ebca6b)) >>> 0;
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d) >>> 0;
  v = Math.imul(v ^ (v >>> 15), 0x846ca68b) >>> 0;
  return (v ^ (v >>> 16)) >>> 0;
};

/** Deterministic sprite grain delta in [-amount, +amount]. */
export const grainDelta = (grain: SpriteGrain, x: number, y: number): number => {
  if (grain.mode === 'none' || grain.amount === 0) return 0;
  let cx = x,
    cy = y;
  if (grain.mode === 'clustered') {
    cx = Math.floor(x / 2);
    cy = Math.floor(y / 2);
  } else if (grain.mode === 'directional') {
    if (grain.axis === 'horizontal') cx = Math.floor(x / 3);
    else if (grain.axis === 'vertical') cy = Math.floor(y / 3);
    else {
      cx = Math.floor((x + y) / 3);
      cy = x - y;
    }
  }
  const v = hashCell(cx, cy, grain.seed) / 0xffffffff;
  const threshold = grain.mode === 'soft' ? 0.12 : 0.17;
  if (v < threshold) return -grain.amount;
  if (v > 1 - threshold) return grain.amount;
  return 0;
};

export const finalTone = (base: number, delta: number): number => clamp(base + delta, 0, 4);
