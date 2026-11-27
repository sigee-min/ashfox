import { clamp01, round4 } from '@ashfox/internal-contracts';
import type { Vec3 } from '../../../model/identity';
import type { CubeFaceDirection } from '../../../model/scene';
import type { IntVec3 } from '../../../project/structure/contract';
import { FACE_BASIS, FACE_CORNER_TABLE } from '../lighting';
import { linearToSrgb } from '../vertexWeather';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type InteriorOpeningSpan,
  type InteriorRadiosityConfig,
  type InteriorRadiosityField,
  type InteriorRoomInput,
  type InteriorSubVoxelIR,
  type StyleDnaMood,
  type SubVoxelBoxIR,
} from './contract';
import { boxYawCosSin, rotateBoxCorner, rotatedBoxBounds16 } from './zoneRect';

const FACING_INWARD: Readonly<Record<InteriorOpeningSpan['wall'], IntVec3>> = {
  north: [0, 0, 1],
  south: [0, 0, -1],
  east: [-1, 0, 0],
  west: [1, 0, 0],
};

// [ambient_floor, stained_glass_boost, contact_ao_strength, skyRgb]
const MOOD_TABLE: Readonly<Record<StyleDnaMood, readonly [number, number, number, Vec3]>> = {
  warm_hearth: [0.14, 1.15, 0.45, [1.0, 0.85, 0.62]],
  zen_daylight: [0.22, 1.0, 0.35, [1.0, 0.96, 0.88]],
  minimal_bright: [0.26, 0.95, 0.32, [0.98, 0.98, 1.0]],
  cyber_neon: [0.1, 1.25, 0.48, [0.55, 0.72, 1.0]],
  arcane_dusk: [0.11, 1.4, 0.5, [0.68, 0.58, 0.95]],
  sunbaked_ochre: [0.2, 1.1, 0.4, [1.0, 0.88, 0.58]],
};

const CASTER_TAGS = new Set(
  'leg,baseboard,plinth,beam,truss,pillar,furniture,chair,table'.split(','),
);
const CUBE_DIRS: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];
type RgbTriplet = readonly [Float32Array, Float32Array, Float32Array];
const mk3 = (v: number): RgbTriplet => [
  new Float32Array(v),
  new Float32Array(v),
  new Float32Array(v),
];
const nowMs = (): number =>
  typeof globalThis.performance !== 'undefined' ? globalThis.performance.now() : Date.now();
const clAxis = (v: number, lim: number): number => (v < 0 ? 0 : v >= lim ? lim - 1 : v);

/** Builds a closed InteriorRadiosityConfig with mood-calibrated defaults. */
export const defaultRadiosityConfig = (
  mood: StyleDnaMood,
  overrides?: Partial<InteriorRadiosityConfig>,
): InteriorRadiosityConfig => {
  const m = MOOD_TABLE[mood];
  return {
    bounces: 2,
    mood,
    ambient_floor: m[0],
    stained_glass_boost: m[1],
    contact_ao_strength: m[2],
    ...overrides,
  };
};

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

const ALBEDO_TOKENS: readonly [string, Vec3][] =
  'dark_oak:28,17,10;spruce:46,30,17;birch:82,74,52;oak:78,52,24;tatami:76,74,44;red:86,16,16;rug:82,20,20;blue:18,34,76;moss:28,54,22;plaster:92,89,83;brick:62,30,22;deepslate:28,30,34;neon:25,92,100;soul:45,92,100;hearth:100,50,18;lantern:100,80,42'
    .split(';')
    .map((row) => {
      const [tok, rgb] = row.split(':');
      const [r, g, b] = rgb!.split(',').map((n) => Number(n) / 100);
      return [tok!, [r!, g!, b!]];
    });
const ALBEDO_CACHE = new Map<string, Vec3>();

const inferBoxAlbedo = (box: SubVoxelBoxIR): Vec3 => {
  const tinted = parseHexRgb(box.color_tint);
  if (tinted) return tinted;
  const cacheKey = `${box.tile_id}|${box.semantic_tag ?? ''}`;
  const hit = ALBEDO_CACHE.get(cacheKey);
  if (hit) return hit;
  const k = cacheKey.toLowerCase();
  const found: Vec3 = ALBEDO_TOKENS.find(([tok]) => k.includes(tok))?.[1] ?? [0.58, 0.56, 0.54];
  ALBEDO_CACHE.set(cacheKey, found);
  return found;
};

const isEmissiveBox = (box: SubVoxelBoxIR): boolean => {
  if (box.layer === 'emissive') return true;
  const t = (box.semantic_tag ?? '').toLowerCase();
  return (
    t.includes('neon') ||
    t.includes('led_strip') ||
    t.includes('strip_light') ||
    t.includes('emissive')
  );
};

const createBuffers = (room: InteriorRoomInput) => {
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
type RadiosityBuffers = ReturnType<typeof createBuffers>;

const isStructuralOccluder = (box: SubVoxelBoxIR): boolean =>
  box.layer === 'opaque' &&
  (box.to_16[0] - box.from_16[0] >= 12 ? 1 : 0) +
    (box.to_16[1] - box.from_16[1] >= 12 ? 1 : 0) +
    (box.to_16[2] - box.from_16[2] >= 12 ? 1 : 0) >=
    2;

const depositMax = (t: RgbTriplet, idx: number, rgb: Vec3): void => {
  if (rgb[0] > t[0][idx]!) t[0][idx] = rgb[0];
  if (rgb[1] > t[1][idx]!) t[1][idx] = rgb[1];
  if (rgb[2] > t[2][idx]!) t[2][idx] = rgb[2];
};

const rasterizeBox = (box: SubVoxelBoxIR, buf: RadiosityBuffers): void => {
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  const [rx0, rz0, rx1, rz1] = rotatedBoxBounds16(box);
  const x0 = clAxis(Math.floor(rx0 / u) - buf.origin[0], buf.w);
  const y0 = clAxis(Math.floor(box.from_16[1] / u) - buf.origin[1], buf.h);
  const z0 = clAxis(Math.floor(rz0 / u) - buf.origin[2], buf.d);
  const x1 = Math.max(x0, clAxis(Math.ceil(rx1 / u) - 1 - buf.origin[0], buf.w));
  const y1 = Math.max(y0, clAxis(Math.ceil(box.to_16[1] / u) - 1 - buf.origin[1], buf.h));
  const z1 = Math.max(z0, clAxis(Math.ceil(rz1 / u) - 1 - buf.origin[2], buf.d));
  const rgb = inferBoxAlbedo(box);
  const emissive = isEmissiveBox(box);
  const occ = isStructuralOccluder(box);
  for (let y = y0; y <= y1; y += 1) {
    for (let z = z0; z <= z1; z += 1) {
      const row = (y * buf.d + z) * buf.w;
      for (let x = x0; x <= x1; x += 1) {
        const idx = row + x;
        if (occ) buf.occludes[idx] = 1;
        buf.albedo[0][idx] += rgb[0];
        buf.albedo[1][idx] += rgb[1];
        buf.albedo[2][idx] += rgb[2];
        buf.albedoW[idx] += 1;
        if (emissive) depositMax(buf.emit, idx, rgb);
      }
    }
  }
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

const traceOpeningSun = (
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

const isContactCaster = (box: SubVoxelBoxIR): boolean => {
  if (box.contact_ao !== undefined) return true;
  const tag = (box.semantic_tag ?? '').toLowerCase();
  if (tag.length === 0) return false;
  for (const t of CASTER_TAGS) if (tag.includes(t)) return true;
  return false;
};

const boxDistSq16 = (box: SubVoxelBoxIR, x16: number, y16: number, z16: number): number => {
  const dx = Math.max(0, box.from_16[0] - x16, x16 - box.to_16[0]);
  const dy = Math.max(0, box.from_16[1] - y16, y16 - box.to_16[1]);
  const dz = Math.max(0, box.from_16[2] - z16, z16 - box.to_16[2]);
  return dx * dx + dy * dy + dz * dz;
};

const fillContactAoField = (
  boxes: readonly SubVoxelBoxIR[],
  buf: RadiosityBuffers,
  strength: number,
): Uint8Array => {
  const out = new Uint8Array(buf.w * buf.h * buf.d).fill(255);
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  for (const box of boxes) {
    if (!isContactCaster(box)) continue;
    const x0 = clAxis(Math.floor(box.from_16[0] / u) - buf.origin[0], buf.w);
    const z0 = clAxis(Math.floor(box.from_16[2] / u) - buf.origin[2], buf.d);
    const x1 = Math.max(x0, clAxis(Math.ceil(box.to_16[0] / u) - 1 - buf.origin[0], buf.w));
    const z1 = Math.max(z0, clAxis(Math.ceil(box.to_16[2] / u) - 1 - buf.origin[2], buf.d));
    const val = Math.round(clamp01(1 - (box.contact_ao ?? 0.45) * strength) * 255);
    const floorY = clAxis(Math.floor(box.from_16[1] / u) - buf.origin[1], buf.h);
    for (let z = z0; z <= z1; z += 1) {
      const row = (floorY * buf.d + z) * buf.w;
      for (let x = x0; x <= x1; x += 1) if (val < out[row + x]!) out[row + x] = val;
    }
  }
  return out;
};

const qByte = (v: number): number => Math.round(clamp01(v) * 255);

const writeQuantized = (
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

/** Computes compile-time 2-bounce colored radiosity GI, stained-glass sun patches, and 1/16 contact AO. */
export const computeInteriorRadiosity = (
  room: InteriorRoomInput,
  ir: InteriorSubVoxelIR,
  config?: Partial<InteriorRadiosityConfig>,
  sunDir?: Vec3,
): InteriorRadiosityField => {
  const t0 = nowMs();
  const cfg = defaultRadiosityConfig(room.style_dna.mood, config);
  const buf = createBuffers(room);
  for (const box of ir.boxes) rasterizeBox(box, buf);
  for (const op of room.openings) if (op.kind !== 'door') traceOpeningSun(op, buf, cfg, sunDir);
  const vol = buf.w * buf.h * buf.d;
  const dir = mk3(vol);
  for (let c = 0; c < 3; c += 1)
    for (let i = 0; i < vol; i += 1) dir[c]![i] = Math.max(buf.emit[c]![i]!, buf.sun[c]![i]!);
  propagateRgb(buf, dir, 0.72);
  const b1 = mk3(vol);
  reflectBounce(buf, dir, b1, 0.7);
  propagateRgb(buf, b1, 0.65);
  const b2 = mk3(vol);
  if (cfg.bounces === 2) {
    reflectBounce(buf, b1, b2, 0.5);
    propagateRgb(buf, b2, 0.58);
  }
  const contact_ao = fillContactAoField(ir.boxes, buf, cfg.contact_ao_strength);
  return {
    size: [buf.w, buf.h, buf.d],
    ...writeQuantized(buf, cfg, b1, b2),
    contact_ao,
    compute_ms: round4(Math.max(0, nowMs() - t0)),
  };
};

/** Samples linear RGB radiosity + sun patch at a 1/16 sub-voxel coordinate. */
export const sampleRadiosityAt16 = (
  field: InteriorRadiosityField,
  origin: IntVec3,
  x16: number,
  y16: number,
  z16: number,
): Vec3 => {
  const [w, h, d] = field.size;
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  const idx =
    (clAxis(Math.floor(y16 / u) - origin[1], h) * d + clAxis(Math.floor(z16 / u) - origin[2], d)) *
      w +
    clAxis(Math.floor(x16 / u) - origin[0], w);
  return [
    clamp01(field.bounce_r[idx]! / 255 + (field.sun_patch_r[idx]! / 255) * 0.45),
    clamp01(field.bounce_g[idx]! / 255 + (field.sun_patch_g[idx]! / 255) * 0.45),
    clamp01(field.bounce_b[idx]! / 255 + (field.sun_patch_b[idx]! / 255) * 0.45),
  ];
};

const sampleContactAo = (
  casters: readonly SubVoxelBoxIR[],
  aoStrength: number,
  pt: Vec3,
  skipId: string,
): number => {
  let occl = 0;
  for (const c of casters) {
    if (c.id === skipId) continue;
    const d2 = boxDistSq16(c, pt[0], pt[1], pt[2]);
    if (d2 <= 9) occl = Math.min(1, occl + (c.contact_ao ?? 0.55) * (1 - d2 / 10));
  }
  return clamp01(1 - occl * aoStrength);
};

const bakeBoxColors0 = (
  box: SubVoxelBoxIR,
  origin: IntVec3,
  field: InteriorRadiosityField,
  casters: readonly SubVoxelBoxIR[],
  aoStrength: number,
): Float32Array => {
  const colors = new Float32Array(72);
  if (isEmissiveBox(box)) return colors.fill(1);
  const [cos, sin] = boxYawCosSin(box.rotation_y_deg);
  for (let f = 0; f < 6; f += 1) {
    const dir = CUBE_DIRS[f]!;
    const shade = FACE_BASIS[dir].shade;
    const tbl = FACE_CORNER_TABLE[dir];
    for (let c = 0; c < 4; c += 1) {
      const k = c * 3;
      const vx = tbl[k]! ? box.to_16[0] : box.from_16[0];
      const vy = tbl[k + 1]! ? box.to_16[1] : box.from_16[1];
      const vz = tbl[k + 2]! ? box.to_16[2] : box.from_16[2];
      const pt = rotateBoxCorner(vx, vy, vz, box.pivot_16, cos, sin);
      const rgb = sampleRadiosityAt16(field, origin, pt[0], pt[1], pt[2]);
      const ao = sampleContactAo(casters, aoStrength, pt, box.id);
      const off = f * 12 + k;
      const m = shade * ao;
      colors[off] = linearToSrgb(rgb[0] * m);
      colors[off + 1] = linearToSrgb(rgb[1] * m);
      colors[off + 2] = linearToSrgb(rgb[2] * m);
    }
  }
  return colors;
};

/** Bakes sRGB COLOR_0 vertex colors (24 vertices * 3 RGB floats per SubVoxelBoxIR) with contact AO. */
export const bakeSubVoxelColors0 = (
  room: InteriorRoomInput,
  ir: InteriorSubVoxelIR,
  field: InteriorRadiosityField,
  config?: Partial<InteriorRadiosityConfig>,
): ReadonlyMap<string, Float32Array> => {
  const aoStrength = defaultRadiosityConfig(room.style_dna.mood, config).contact_ao_strength;
  const casters = ir.boxes.filter(isContactCaster);
  const result = new Map<string, Float32Array>();
  for (const box of ir.boxes)
    result.set(box.id, bakeBoxColors0(box, room.bounds_from, field, casters, aoStrength));
  return result;
};

/** Computes chromatic + luminance contrast of the 2-bounce radiosity field in [0..1]. */
export const computeRadiosityColorContrast = (field: InteriorRadiosityField): number => {
  const n = field.bounce_r.length;
  if (n === 0) return 0;
  let [minLum, maxLum, maxChroma] = [1, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const r = field.bounce_r[i]! / 255;
    const g = field.bounce_g[i]! / 255;
    const b = field.bounce_b[i]! / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
    maxChroma = Math.max(maxChroma, Math.max(r, g, b) - Math.min(r, g, b));
  }
  return round4(clamp01((maxLum - minLum) * 0.55 + maxChroma * 0.65));
};
