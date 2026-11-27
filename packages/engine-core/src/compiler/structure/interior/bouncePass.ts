import { clamp01 } from '@ashfox/internal-contracts';
import type { Vec3 } from '../../../model/identity';
import type { IntVec3 } from '../../../project/structure/contract';
import {
  type InteriorOpeningSpan,
  type InteriorRadiosityConfig,
  type InteriorRoomInput,
  type StyleDnaMood,
} from './contract';

const FACING_INWARD: Readonly<Record<InteriorOpeningSpan['wall'], IntVec3>> = {
  north: [0, 0, 1],
  south: [0, 0, -1],
  east: [-1, 0, 0],
  west: [1, 0, 0],
};

// [ambient_floor, stained_glass_boost, contact_ao_strength, skyRgb]
export const MOOD_TABLE: Readonly<Record<StyleDnaMood, readonly [number, number, number, Vec3]>> = {
  warm_hearth: [0.14, 1.15, 0.45, [1.0, 0.85, 0.62]],
  zen_daylight: [0.22, 1.0, 0.35, [1.0, 0.96, 0.88]],
  minimal_bright: [0.26, 0.95, 0.32, [0.98, 0.98, 1.0]],
  cyber_neon: [0.1, 1.25, 0.48, [0.55, 0.72, 1.0]],
  arcane_dusk: [0.11, 1.4, 0.5, [0.68, 0.58, 0.95]],
  sunbaked_ochre: [0.2, 1.1, 0.4, [1.0, 0.88, 0.58]],
};

export type RgbTriplet = readonly [Float32Array, Float32Array, Float32Array];

export const mk3 = (v: number): RgbTriplet => [
  new Float32Array(v),
  new Float32Array(v),
  new Float32Array(v),
];

export const clAxis = (v: number, lim: number): number => (v < 0 ? 0 : v >= lim ? lim - 1 : v);

/** Parses #RRGGBB or #RRGGBBAA into normalized [0..1] RGB. */
export const parseHexRgb = (hex: string | undefined): Vec3 | null => {
  if (!hex || !hex.startsWith('#')) return null;
  const raw = hex.slice(1);
  if (raw.length !== 6 && raw.length !== 8) return null;
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) ? null : [r / 255, g / 255, b / 255];
};

export const createBuffers = (room: InteriorRoomInput) => {
  const w = Math.max(1, room.bounds_to[0] - room.bounds_from[0] + 1);
  const h = Math.max(1, room.bounds_to[1] - room.bounds_from[1] + 1);
  const d = Math.max(1, room.bounds_to[2] - room.bounds_from[2] + 1);
  const v = w * h * d;
  return {
    w,
    h,
    d,
    origin: room.bounds_from,
    occludes: new Uint8Array(v),
    albedo: mk3(v),
    albedoW: new Float32Array(v),
    emit: mk3(v),
    sun: mk3(v),
  };
};

export type RadiosityBuffers = ReturnType<typeof createBuffers>;

export const depositMax = (t: RgbTriplet, idx: number, rgb: Vec3): void => {
  if (rgb[0] > t[0][idx]!) t[0][idx] = rgb[0];
  if (rgb[1] > t[1][idx]!) t[1][idx] = rgb[1];
  if (rgb[2] > t[2][idx]!) t[2][idx] = rgb[2];
};

const normalizeVec3 = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, -1, 0];
};

const marchWindowRay = (buf: RadiosityBuffers, s0: Vec3, dir: Vec3, rgb: Vec3): void => {
  const maxSteps = (buf.w + buf.h + buf.d) * 2;
  let lastAir = -1;
  for (let s = 1; s <= maxSteps; s += 1) {
    const px = Math.floor(s0[0] + dir[0] * s * 0.5);
    const py = Math.floor(s0[1] + dir[1] * s * 0.5);
    const pz = Math.floor(s0[2] + dir[2] * s * 0.5);
    if (px < 0 || px >= buf.w || py < 0 || py >= buf.h || pz < 0 || pz >= buf.d) break;
    const idx = (py * buf.d + pz) * buf.w + px;
    if (buf.occludes[idx] === 1 && s > 1) {
      depositMax(buf.sun, idx, rgb);
      if (lastAir >= 0) depositMax(buf.sun, lastAir, rgb);
      break;
    }
    lastAir = idx;
  }
};

export const traceOpeningSun = (
  op: InteriorOpeningSpan,
  buf: RadiosityBuffers,
  cfg: InteriorRadiosityConfig,
  sunDir?: Vec3,
): void => {
  const inward = FACING_INWARD[op.wall];
  const baseDir = sunDir
    ? normalizeVec3(sunDir)
    : normalizeVec3([inward[0] * 0.65 + 0.15, -0.72, inward[2] * 0.65 + 0.15]);
  const dot = baseDir[0] * inward[0] + baseDir[1] * inward[1] + baseDir[2] * inward[2];
  const rayDir = dot > 0.05 ? baseDir : normalizeVec3([inward[0] * 0.5, -0.82, inward[2] * 0.5]);
  const scale = dot > 0.05 ? 1 : 0.35;
  const base = parseHexRgb(op.stained_glass_color) ?? MOOD_TABLE[cfg.mood][3];
  const gain = op.stained_glass_color ? cfg.stained_glass_boost * scale : scale;
  const rgb: Vec3 = [clamp01(base[0] * gain), clamp01(base[1] * gain), clamp01(base[2] * gain)];
  for (let y = op.from[1]; y <= op.to[1]; y += 1) {
    for (let z = op.from[2]; z <= op.to[2]; z += 1) {
      for (let x = op.from[0]; x <= op.to[0]; x += 1) {
        marchWindowRay(
          buf,
          [x - buf.origin[0] + 0.5, y - buf.origin[1] + 0.5, z - buf.origin[2] + 0.5],
          rayDir,
          rgb,
        );
      }
    }
  }
};

const sweepLine = (
  rgb: RgbTriplet,
  occ: Uint8Array,
  start: number,
  step: number,
  count: number,
  decay: number,
): void => {
  const [r, g, b] = rgb;
  let cr = 0;
  let cg = 0;
  let cb = 0;
  for (let i = 0; i < count; i += 1) {
    const idx = start + i * step;
    const nr = cr * decay;
    const ng = cg * decay;
    const nb = cb * decay;
    cr = nr > r[idx]! ? nr : r[idx]!;
    cg = ng > g[idx]! ? ng : g[idx]!;
    cb = nb > b[idx]! ? nb : b[idx]!;
    r[idx] = cr;
    g[idx] = cg;
    b[idx] = cb;
    if (occ[idx] === 1) cr = cg = cb = 0;
  }
};

const sweepPair = (
  rgb: RgbTriplet,
  occ: Uint8Array,
  start: number,
  step: number,
  count: number,
  decay: number,
): void => {
  sweepLine(rgb, occ, start, step, count, decay);
  sweepLine(rgb, occ, start + (count - 1) * step, -step, count, decay);
};

const propagateRgb = (buf: RadiosityBuffers, rgb: RgbTriplet, decay: number): void => {
  const { w, h, d, occludes } = buf;
  const wd = w * d;
  for (let y = 0; y < h; y += 1) {
    for (let z = 0; z < d; z += 1) sweepPair(rgb, occludes, (y * d + z) * w, 1, w, decay);
    for (let x = 0; x < w; x += 1) sweepPair(rgb, occludes, y * wd + x, w, d, decay);
  }
  for (let z = 0; z < d; z += 1)
    for (let x = 0; x < w; x += 1) sweepPair(rgb, occludes, z * w + x, wd, h, decay);
};

const reflectBounce = (
  buf: RadiosityBuffers,
  input: RgbTriplet,
  output: RgbTriplet,
  reflectance: number,
): void => {
  for (let i = 0; i < buf.albedoW.length; i += 1) {
    const aw = buf.albedoW[i]!;
    if (aw <= 0) continue;
    const inv = reflectance / aw;
    output[0][i] = input[0][i]! * buf.albedo[0][i]! * inv;
    output[1][i] = input[1][i]! * buf.albedo[1][i]! * inv;
    output[2][i] = input[2][i]! * buf.albedo[2][i]! * inv;
  }
};

const qByte = (v: number): number => Math.round(clamp01(v) * 255);

export const writeQuantized = (
  buf: RadiosityBuffers,
  cfg: InteriorRadiosityConfig,
  b1: RgbTriplet,
  b2: RgbTriplet,
) => {
  const vol = buf.w * buf.h * buf.d;
  const bOut = [new Uint8Array(vol), new Uint8Array(vol), new Uint8Array(vol)] as const;
  const sOut = [new Uint8Array(vol), new Uint8Array(vol), new Uint8Array(vol)] as const;
  const sky = MOOD_TABLE[cfg.mood][3];
  const k2 = cfg.bounces === 2 ? 1 : 0;
  for (let c = 0; c < 3; c += 1) {
    const [bo, so, em, su, c1, c2, sc] = [
      bOut[c]!,
      sOut[c]!,
      buf.emit[c]!,
      buf.sun[c]!,
      b1[c]!,
      b2[c]!,
      cfg.ambient_floor * sky[c]!,
    ];
    for (let i = 0; i < vol; i += 1) {
      bo[i] = qByte(sc + em[i]! * 0.85 + c1[i]! + c2[i]! * k2);
      so[i] = qByte(su[i]!);
    }
  }
  return {
    bounce_r: bOut[0],
    bounce_g: bOut[1],
    bounce_b: bOut[2],
    sun_patch_r: sOut[0],
    sun_patch_g: sOut[1],
    sun_patch_b: sOut[2],
  };
};

export const runRadiosityPasses = (
  buf: RadiosityBuffers,
  bounces: 1 | 2,
): { readonly b1: RgbTriplet; readonly b2: RgbTriplet } => {
  const vol = buf.w * buf.h * buf.d;
  const dir = mk3(vol);
  for (let c = 0; c < 3; c += 1)
    for (let i = 0; i < vol; i += 1) dir[c]![i] = Math.max(buf.emit[c]![i]!, buf.sun[c]![i]!);
  propagateRgb(buf, dir, 0.72);
  const b1 = mk3(vol);
  reflectBounce(buf, dir, b1, 0.7);
  propagateRgb(buf, b1, 0.65);
  const b2 = mk3(vol);
  if (bounces === 2) {
    reflectBounce(buf, b1, b2, 0.5);
    propagateRgb(buf, b2, 0.58);
  }
  return { b1, b2 };
};
