import type { CubeFaceDirection } from '../../model/scene';
import { structureTileTextureId } from './atlas';
import type { BatchDraft, MeshCtx } from './batch';
import type { BlockDescriptor, BlockRenderLayer } from './blocks';
import { FACE_BASIS } from './lighting';
import { setVec3, tileForFace, type CachedBlockState, type LocalBoxSpec } from './shapes';
import { voxelAt } from './subvoxel';

const DIRS6: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];

export interface TileTable {
  readonly stateDirTileIdx: Int32Array;
  readonly isFull: Uint8Array;
  readonly isOpaque: Uint8Array;
  readonly layers: BlockRenderLayer[];
  readonly tileIds: string[];
  readonly repeatKeys: string[];
  readonly batches: (BatchDraft | undefined)[];
}

export interface SliceScratch {
  keys: Int32Array;
  meta: Uint32Array;
  colors: Float64Array;
}

const SLICE_SCRATCH: SliceScratch = {
  keys: new Int32Array(4096),
  meta: new Uint32Array(4096),
  colors: new Float64Array(4096 * 12),
};

export const ensureSliceScratch = (area: number): SliceScratch => {
  if (area > SLICE_SCRATCH.keys.length) {
    let cap = SLICE_SCRATCH.keys.length;
    while (cap < area) cap *= 2;
    SLICE_SCRATCH.keys = new Int32Array(cap);
    SLICE_SCRATCH.meta = new Uint32Array(cap);
    SLICE_SCRATCH.colors = new Float64Array(cap * 12);
  }
  return SLICE_SCRATCH;
};

export const buildTileTable = (ctx: MeshCtx): TileTable => {
  const count = ctx.grid.states.length;
  const stateDirTileIdx = new Int32Array(count * 6);
  const isFull = new Uint8Array(count);
  const isOpaque = new Uint8Array(count);
  const byKey = new Map<string, number>();
  const layers: BlockRenderLayer[] = ['opaque'];
  const tileIds: string[] = [''];
  const repeatKeys: string[] = [''];
  for (let v = 1; v < count; v += 1) {
    const desc = ctx.descriptors[v]!;
    if (desc.solidOpaque) isOpaque[v] = 1;
    if (desc.shape !== 'full') continue;
    isFull[v] = 1;
    const facing = ctx.parsedStates[v]!.facing;
    for (let d = 0; d < 6; d += 1) {
      const tileId = tileForFace(desc, DIRS6[d]!, facing);
      const key = `${desc.layer}:${structureTileTextureId(desc.layer, tileId)}`;
      let tileIdx = byKey.get(key);
      if (tileIdx === undefined) {
        tileIdx = layers.length;
        byKey.set(key, tileIdx);
        layers.push(desc.layer);
        tileIds.push(tileId);
        repeatKeys.push(key);
      }
      stateDirTileIdx[v * 6 + d] = tileIdx;
    }
  }
  return {
    stateDirTileIdx,
    isFull,
    isOpaque,
    layers,
    tileIds,
    repeatKeys,
    batches: new Array<BatchDraft | undefined>(layers.length),
  };
};

export const greedySpan = (
  keys: Int32Array,
  meta: Uint32Array,
  uLen: number,
  vLen: number,
  u0: number,
  v0: number,
  key: number,
  cellMeta: number,
): number => {
  const row0 = v0 * uLen + u0;
  let mw = 1;
  while (u0 + mw < uLen && meta[row0 + mw] === cellMeta && keys[row0 + mw] === key) {
    mw += 1;
  }
  let mh = 1;
  outer: while (v0 + mh < vLen) {
    const rowBase = (v0 + mh) * uLen + u0;
    for (let k = 0; k < mw; k += 1) {
      if (meta[rowBase + k] !== cellMeta || keys[rowBase + k] !== key) break outer;
    }
    mh += 1;
  }
  return (mw << 16) | mh;
};

export const clearSpanMeta = (
  meta: Uint32Array,
  uLen: number,
  u: number,
  v: number,
  mw: number,
  mh: number,
): void => {
  for (let dy = 0; dy < mh; dy += 1) {
    const start = (v + dy) * uLen + u;
    meta.fill(0, start, start + mw);
  }
};

export const maskTintKey = (qt: number): number =>
  ((qt >> 16) << 6) | (((qt >> 10) & 3) << 4) | (((qt >> 6) & 3) << 2) | ((qt >> 2) & 3);

export const sliceRowStart = (
  axis: 0 | 1 | 2,
  s: number,
  v: number,
  w: number,
  d: number,
): number => (axis === 2 ? (v * d + s) * w : axis === 0 ? v * d * w + s : (s * d + v) * w);

export const writeSpanColors = (
  dst: Float64Array,
  cellIdx: number,
  src: readonly number[],
): void => {
  const base = cellIdx * 12;
  for (let i = 0; i < 12; i += 1) dst[base + i] = src[i]!;
};

export const copySpanColors = (src: Float64Array, cellIdx: number, dst: number[]): void => {
  const base = cellIdx * 12;
  for (let i = 0; i < 12; i += 1) dst[i] = src[base + i]!;
};

export const writeSliceBounds = (
  axis: 0 | 1 | 2,
  s: number,
  u: number,
  v: number,
  mw: number,
  mh: number,
  hw: number,
  hd: number,
  from: [number, number, number],
  to: [number, number, number],
): void => {
  if (axis === 2) {
    setVec3(from, u - hw, v, s - hd);
    setVec3(to, u + mw - hw, v + mh, s + 1 - hd);
  } else if (axis === 0) {
    setVec3(from, s - hw, v, u - hd);
    setVec3(to, s + 1 - hw, v + mh, u + mw - hd);
  } else {
    setVec3(from, u - hw, s, v - hd);
    setVec3(to, u + mw - hw, s + 1, v + mh - hd);
  }
};

export const buildBottomStairMask = (
  descriptors: readonly BlockDescriptor[],
  parsedStates: readonly CachedBlockState[],
): Uint8Array => {
  const out = new Uint8Array(descriptors.length);
  for (let v = 1; v < out.length; v += 1) {
    if (descriptors[v]!.shape === 'stair' && parsedStates[v]!.parsed.properties.half !== 'top') {
      out[v] = 1;
    }
  }
  return out;
};

export const buildMaskByPredicate = (
  descriptors: readonly BlockDescriptor[],
  pred: (desc: BlockDescriptor) => boolean,
): Uint8Array => {
  const out = new Uint8Array(descriptors.length);
  for (let v = 1; v < out.length; v += 1) {
    if (pred(descriptors[v]!)) out[v] = 1;
  }
  return out;
};

export const emitRuns = (
  u0: number,
  uLimit: number,
  ok: (u: number) => boolean,
  emit: (a: number, b: number) => number,
): number => {
  let count = 0;
  for (let u = u0; u < uLimit;) {
    if (!ok(u)) {
      u += 1;
      continue;
    }
    let u1 = u;
    while (u1 + 1 < uLimit && ok(u1 + 1)) u1 += 1;
    count += emit(u, u1);
    u = u1 + 1;
  }
  return count;
};

const FLUSH_FACE_AXIS: readonly (0 | 1 | 2)[] = [2, 2, 0, 0, 1, 1];
const FLUSH_FACE_BOUND: readonly number[] = [0, 16, 16, 0, 16, 0];

export const isBoxBoundaryOccluded = (
  ctx: MeshCtx,
  shape: BlockDescriptor['shape'],
  spec: LocalBoxSpec,
  x: number,
  y: number,
  z: number,
  dirIdx: number,
  dir: CubeFaceDirection,
): boolean => {
  if (((spec.skipMask ?? 0) & (1 << dirIdx)) !== 0) return true;
  const axis = FLUSH_FACE_AXIS[dirIdx]!;
  const bound = FLUSH_FACE_BOUND[dirIdx]!;
  if (bound === 16 ? spec.to[axis] < 16 : spec.from[axis] > 0) return false;
  const n = FACE_BASIS[dir].normal;
  const nx = x + n[0];
  const ny = y + n[1];
  const nz = z + n[2];
  if (ny >= ctx.maxY) return false;
  const nv = voxelAt(ctx.grid, nx, ny, nz);
  if (nv <= 0) return false;
  const w = ctx.grid.size[0];
  const d = ctx.grid.size[2];
  if (ctx.grid.customTags[(ny * d + nz) * w + nx] !== null) return false;
  const ndesc = ctx.descriptors[nv]!;
  return ndesc.solidOpaque || ((shape === 'pane' || shape === 'door') && ndesc.shape === shape);
};

const safeOcclusionKey = (ctx: MeshCtx, x: number, y: number, z: number): number => {
  if (y >= ctx.maxY) return -1;
  const v = voxelAt(ctx.grid, x, y, z);
  if (v <= 0) return v;
  const s = ctx.grid.size;
  if (ctx.grid.customTags[(y * s[2] + z) * s[0] + x] !== null) return -2;
  return ctx.descriptors[v]!.solidOpaque ? -99 : v;
};

export const samePerpNeighbors = (
  ctx: MeshCtx,
  cx: number,
  cz: number,
  x0: number,
  y: number,
  z0: number,
  nx: number,
  nz: number,
): boolean =>
  safeOcclusionKey(ctx, x0, y + 1, z0) === safeOcclusionKey(ctx, nx, y + 1, nz) &&
  safeOcclusionKey(ctx, x0, y - 1, z0) === safeOcclusionKey(ctx, nx, y - 1, nz) &&
  safeOcclusionKey(ctx, x0 + cx, y, z0 + cz) === safeOcclusionKey(ctx, nx + cx, y, nz + cz) &&
  safeOcclusionKey(ctx, x0 - cx, y, z0 - cz) === safeOcclusionKey(ctx, nx - cx, y, nz - cz);

export const layerHasMaskMatch = (
  voxels: readonly number[] | Int16Array | Int32Array | Uint16Array,
  mask: Uint8Array,
  start: number,
  end: number,
): boolean => {
  for (let i = start; i < end; i += 1) {
    const v = voxels[i]!;
    if (v > 0 && mask[v] === 1) return true;
  }
  return false;
};
