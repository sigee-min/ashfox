import { clamp01, round4 } from '@ashfox/internal-contracts';
import type { Vec3 } from '../../../model/identity';
import type { CubeFaceDirection } from '../../../model/scene';
import type { IntVec3 } from '../../../project/structure/contract';
import { FACE_BASIS, FACE_CORNER_TABLE } from '../lighting';
import { linearToSrgb } from '../vertexWeather';
import {
  MOOD_TABLE,
  clAxis,
  createBuffers,
  depositMax,
  parseHexRgb,
  runRadiosityPasses,
  traceOpeningSun,
  writeQuantized,
  type RadiosityBuffers,
} from './bouncePass';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type InteriorRadiosityConfig,
  type InteriorRadiosityField,
  type InteriorRoomInput,
  type InteriorSubVoxelIR,
  type StyleDnaMood,
  type SubVoxelBoxIR,
} from './contract';
import { boxYawCosSin, rotateBoxCorner, rotatedBoxBounds16 } from './zoneRect';

export { parseHexRgb } from './bouncePass';

const CASTER_TAGS = new Set(
  'leg,baseboard,plinth,beam,truss,pillar,furniture,chair,table'.split(','),
);
const CUBE_DIRS: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];
const nowMs = (): number =>
  typeof globalThis.performance !== 'undefined' ? globalThis.performance.now() : Date.now();

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

const isEmissiveBox = (b: SubVoxelBoxIR): boolean =>
  b.layer === 'emissive' ||
  'neon,led_strip,strip_light,emissive'
    .split(',')
    .some((k) => (b.semantic_tag ?? '').toLowerCase().includes(k));

const isStructuralOccluder = (box: SubVoxelBoxIR): boolean =>
  box.layer === 'opaque' &&
  (box.to_16[0] - box.from_16[0] >= 12 ? 1 : 0) +
    (box.to_16[1] - box.from_16[1] >= 12 ? 1 : 0) +
    (box.to_16[2] - box.from_16[2] >= 12 ? 1 : 0) >=
    2;

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

const isContactCaster = (box: SubVoxelBoxIR): boolean => {
  if (box.contact_ao !== undefined) return true;
  const tag = (box.semantic_tag ?? '').toLowerCase();
  if (tag.length === 0) return false;
  for (const t of CASTER_TAGS) if (tag.includes(t)) return true;
  return false;
};

const boxDistSq16 = (box: SubVoxelBoxIR, x16: number, y16: number, z16: number): number => {
  const [cos, sin] = boxYawCosSin(box.rotation_y_deg);
  const [lx, ly, lz] = rotateBoxCorner(x16, y16, z16, box.pivot_16, cos, -sin);
  const dx = Math.max(0, box.from_16[0] - lx, lx - box.to_16[0]);
  const dy = Math.max(0, box.from_16[1] - ly, ly - box.to_16[1]);
  const dz = Math.max(0, box.from_16[2] - lz, lz - box.to_16[2]);
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
    const [bx0, bz0, bx1, bz1] = rotatedBoxBounds16(box);
    const x0 = clAxis(Math.floor(bx0 / u) - buf.origin[0], buf.w);
    const z0 = clAxis(Math.floor(bz0 / u) - buf.origin[2], buf.d);
    const x1 = Math.max(x0, clAxis(Math.ceil(bx1 / u) - 1 - buf.origin[0], buf.w));
    const z1 = Math.max(z0, clAxis(Math.ceil(bz1 / u) - 1 - buf.origin[2], buf.d));
    const val = Math.round(clamp01(1 - (box.contact_ao ?? 0.45) * strength) * 255);
    const floorY = clAxis(Math.floor(box.from_16[1] / u) - buf.origin[1], buf.h);
    for (let z = z0; z <= z1; z += 1) {
      const row = (floorY * buf.d + z) * buf.w;
      for (let x = x0; x <= x1; x += 1) if (val < out[row + x]!) out[row + x] = val;
    }
  }
  return out;
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
  const { b1, b2 } = runRadiosityPasses(buf, cfg.bounces);
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
