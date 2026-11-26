import { clamp01 } from '@ashfox/internal-contracts';
import type { CubeFaceDirection } from '../../model/scene';
import type { IntVec3 } from '../../project/structure/contract';
import type { BlockDescriptor } from './blocks';
import type { StructureGrid, StructureLightingField } from './contract';

export interface VertexWeatherSample {
  r: number;
  g: number;
  b: number;
  bucket: number;
}

interface ChimneyStackInfo {
  readonly upperRoofY: number;
  readonly tops: readonly IntVec3[];
}

const CHIMNEY_CACHE = new WeakMap<StructureGrid, ChimneyStackInfo>();
const ENCLOSED_ROOM_CACHE = new WeakMap<StructureGrid, Uint8Array>();

const markRoomInMask = (
  mask: Uint8Array,
  [w, h, d]: readonly [number, number, number],
  r: StructureGrid['rooms'][number],
): void => {
  const x0 = Math.max(0, r.from[0] - 1);
  const x1 = Math.min(w - 1, r.to[0] + 1);
  const y0 = Math.max(0, r.from[1] - 1);
  const y1 = Math.min(h - 1, r.to[1] + 1);
  const z0 = Math.max(0, r.from[2] - 1);
  const z1 = Math.min(d - 1, r.to[2] + 1);
  for (let y = y0; y <= y1; y += 1) {
    const inY = y >= r.from[1] && y <= r.to[1];
    for (let z = z0; z <= z1; z += 1) {
      const inYZ = inY && z >= r.from[2] && z <= r.to[2];
      const row = (y * d + z) * w;
      for (let x = x0; x <= x1; x += 1) {
        mask[row + x] |= inYZ && x >= r.from[0] && x <= r.to[0] ? 3 : 2;
      }
    }
  }
};

const buildEnclosedMask = (grid: StructureGrid): Uint8Array => {
  const [w, h, d] = grid.size;
  const mask = new Uint8Array(w * h * d);
  for (const r of grid.rooms) if (r.enclosed) markRoomInMask(mask, grid.size, r);
  return mask;
};

const enclosedMaskFor = (grid: StructureGrid): Uint8Array => {
  let mask = ENCLOSED_ROOM_CACHE.get(grid);
  if (!mask) {
    mask = buildEnclosedMask(grid);
    ENCLOSED_ROOM_CACHE.set(grid, mask);
  }
  return mask;
};

const DIRS6: readonly IntVec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const isChimneyMasonry = (desc: BlockDescriptor): boolean =>
  desc.shape === 'full' &&
  (desc.top === 'bricks' ||
    desc.top === 'deepslate_bricks' ||
    desc.top === 'deepslate_tiles' ||
    desc.top === 'stone_bricks' ||
    desc.top === 'cobblestone');

const isTopCapOrAir = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, h, d] = grid.size;
  if (y >= h) return true;
  const v = grid.voxels[(y * d + z) * w + x]!;
  if (v <= 0) return true;
  const shape = descs[v]!.shape;
  return shape === 'slab' || shape === 'campfire';
};

const findUpperRoofY = (grid: StructureGrid, descs: readonly BlockDescriptor[]): number => {
  const [w, h, d] = grid.size;
  let upperRoofY = 0;
  for (let i = 0; i < w * h * d; i += 1) {
    const v = grid.voxels[i]!;
    if (v <= 0 || descs[v]!.shape !== 'stair') continue;
    const y = Math.floor(i / (w * d));
    if (y > upperRoofY) upperRoofY = y;
  }
  return upperRoofY;
};

const findColumnChimneyTop = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  x: number,
  z: number,
  upperRoofY: number,
): IntVec3 | null => {
  const [w, h, d] = grid.size;
  for (let y = h - 1; y >= upperRoofY; y -= 1) {
    const v = grid.voxels[(y * d + z) * w + x]!;
    if (v <= 0) continue;
    if (isChimneyMasonry(descs[v]!) && isTopCapOrAir(grid, descs, x, y + 1, z)) {
      return [x, y, z];
    }
    return null;
  }
  return null;
};

const scanRoofAndChimneys = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
): ChimneyStackInfo => {
  const upperRoofY = findUpperRoofY(grid, descs);
  if (upperRoofY < 3) return { upperRoofY, tops: [] };
  const [w, _h, d] = grid.size;
  const tops: IntVec3[] = [];
  for (let z = 0; z < d; z += 1) {
    for (let x = 0; x < w; x += 1) {
      const top = findColumnChimneyTop(grid, descs, x, z, upperRoofY);
      if (top) tops.push(top);
    }
  }
  return { upperRoofY, tops };
};

const chimneyInfoFor = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
): ChimneyStackInfo => {
  let cached = CHIMNEY_CACHE.get(grid);
  if (!cached) {
    cached = scanRoofAndChimneys(grid, descs);
    CHIMNEY_CACHE.set(grid, cached);
  }
  return cached;
};

export const isInsideEnclosedRoom = (
  grid: StructureGrid,
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, h, d] = grid.size;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return false;
  return (enclosedMaskFor(grid)[(y * d + z) * w + x]! & 1) !== 0;
};

export const isNearEnclosedRoom = (
  grid: StructureGrid,
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, h, d] = grid.size;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return false;
  return (enclosedMaskFor(grid)[(y * d + z) * w + x]! & 2) !== 0;
};

const hasOverheadCover = (grid: StructureGrid, x: number, y: number, z: number): boolean => {
  const [w, h, d] = grid.size;
  for (let cy = y + 1; cy < h; cy += 1) {
    if (grid.voxels[(cy * d + z) * w + x]! > 0) return true;
  }
  return false;
};

export const isWindowInteriorFacing = (
  grid: StructureGrid,
  x: number,
  y: number,
  z: number,
): boolean => {
  if (isInsideEnclosedRoom(grid, x, y, z)) return true;
  const [w, h, d] = grid.size;
  for (const [dx, dy, dz] of DIRS6) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h || nz < 0 || nz >= d) continue;
    const v = grid.voxels[(ny * d + nz) * w + nx]!;
    if (v > 0) continue;
    if (isInsideEnclosedRoom(grid, nx, ny, nz)) return true;
    if (v === 0 && hasOverheadCover(grid, nx, ny, nz)) return true;
  }
  return false;
};

const isExteriorSample = (
  grid: StructureGrid,
  lighting: StructureLightingField,
  sx: number,
  sy: number,
  sz: number,
): boolean => {
  const [w, h, d] = grid.size;
  if (sy < 0) return false;
  if (sx < 0 || sx >= w || sy >= h || sz < 0 || sz >= d) return true;
  if (isInsideEnclosedRoom(grid, sx, sy, sz)) return false;
  return lighting.sky[(sy * d + sz) * w + sx]! >= 120;
};

const isRoofOverhangAt = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, h, d] = grid.size;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return false;
  const idx = (y * d + z) * w + x;
  const v = grid.voxels[idx]!;
  if (v <= 0 || grid.customTags[idx] !== null) return false;
  const desc = descs[v]!;
  if (desc.shape === 'stair') return true;
  if (desc.shape === 'slab' && y >= 3) return true;
  return y >= 3 && (desc.top === 'timber_trim' || desc.top === 'deepslate_tiles');
};

const eaveShadowLevel = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  dir: CubeFaceDirection,
): 0 | 1 | 2 => {
  if (dir === 'up') return 0;
  const [w, _h, d] = grid.size;
  const ownV = grid.voxels[(y * d + z) * w + x]!;
  if (ownV > 0 && (descs[ownV]!.shape === 'stair' || descs[ownV]!.shape === 'slab')) return 0;
  if (isRoofOverhangAt(grid, descs, sx, sy + 1, sz)) return 2;
  if (isRoofOverhangAt(grid, descs, sx, sy + 2, sz)) return 1;
  return 0;
};

const chimneySootLevel = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
): 0 | 1 | 2 => {
  const info = chimneyInfoFor(grid, descs);
  if (info.tops.length === 0 || y < info.upperRoofY - 1) return 0;
  let best: 0 | 1 | 2 = 0;
  for (const [tx, ty, tz] of info.tops) {
    if (y < ty - 2 || y > ty + 1) continue;
    const dist = Math.max(Math.abs(x - tx), Math.abs(z - tz));
    if (dist <= 1 && y >= ty - 1) return 2;
    if (dist <= 2) best = 1;
  }
  return best;
};

const blendMul = (
  out: VertexWeatherSample,
  tr: number,
  tg: number,
  tb: number,
  t: number,
): void => {
  out.r *= 1 + (tr - 1) * t;
  out.g *= 1 + (tg - 1) * t;
  out.b *= 1 + (tb - 1) * t;
};

export const sampleVertexWeather = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  lighting: StructureLightingField,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  dir: CubeFaceDirection,
  out: VertexWeatherSample,
): void => {
  out.r = 1;
  out.g = 1;
  out.b = 1;
  out.bucket = 0;
  if (!isExteriorSample(grid, lighting, sx, sy, sz)) return;
  const eave = eaveShadowLevel(grid, descs, x, y, z, sx, sy, sz, dir);
  const moss: 0 | 1 | 2 = dir === 'down' || y > 1 ? 0 : y === 0 ? 2 : 1;
  const soot = chimneySootLevel(grid, descs, x, y, z);
  if (eave > 0) blendMul(out, 0.83, 0.86, 0.94, eave === 2 ? 1 : 0.55);
  if (moss > 0) blendMul(out, 0.89, 0.94, 0.86, moss === 2 ? 1 : 0.5);
  if (soot > 0) blendMul(out, 0.74, 0.73, 0.75, soot === 2 ? 1 : 0.55);
  out.bucket = (eave << 4) | (moss << 2) | soot;
};

const AO_CURVE: readonly [number, number, number, number] = [1.0, 0.78, 0.58, 0.4];

export const linearToSrgb = (c: number): number => {
  const v = clamp01(c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
};

const occluderAt = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
  maxY: number,
): 0 | 1 => {
  const [w, h, d] = grid.size;
  if (x < 0 || x >= w || y < 0 || y >= Math.min(h, maxY) || z < 0 || z >= d) return 0;
  const idx = (y * d + z) * w + x;
  return grid.customTags[idx] === null &&
    grid.voxels[idx]! > 0 &&
    descs[grid.voxels[idx]!]!.solidOpaque
    ? 1
    : 0;
};

export const vertexAo = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  sx: number,
  sy: number,
  sz: number,
  uAxis: IntVec3,
  vAxis: IntVec3,
  su: number,
  sv: number,
  maxY: number,
): number => {
  const [ux, uy, uz] = uAxis;
  const [vx, vy, vz] = vAxis;
  const s1 = occluderAt(grid, descs, sx + su * ux, sy + su * uy, sz + su * uz, maxY);
  const s2 = occluderAt(grid, descs, sx + sv * vx, sy + sv * vy, sz + sv * vz, maxY);
  if (s1 === 1 && s2 === 1) return 3;
  return (
    s1 +
    s2 +
    occluderAt(
      grid,
      descs,
      sx + su * ux + sv * vx,
      sy + su * uy + sv * vy,
      sz + su * uz + sv * vz,
      maxY,
    )
  );
};

export const writeVertexShade = (
  out: number[],
  offset: number,
  fr: number,
  fg: number,
  fb: number,
  ao: number,
): void => {
  const factor = AO_CURVE[ao]!;
  out[offset] = linearToSrgb(fr * factor);
  out[offset + 1] = linearToSrgb(fg * factor);
  out[offset + 2] = linearToSrgb(fb * factor);
};

export const quantizeFaceTint = (fr: number, fg: number, fb: number, bucket: number): number => {
  const rgbTint =
    (Math.min(15, Math.round(fr * 15)) << 8) |
    (Math.min(15, Math.round(fg * 15)) << 4) |
    Math.min(15, Math.round(fb * 15));
  return (bucket << 16) | rgbTint;
};
