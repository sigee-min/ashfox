import type { CompiledModel } from '../../model/compiled';
import type { CubeFaceDirection } from '../../model/scene';
import { parseBlockState } from '../../project/structure/state';
import {
  collectPropInstances,
  packStructureBatches,
  sliceDimsFor,
  structureTileTextureId,
  type SliceDims,
} from './atlas';
import { getBatch, pushQuad, type BatchDraft, type MeshCtx, type NonFullScratch } from './batch';
import { describeBlockState, type BlockDescriptor, type BlockRenderLayer } from './blocks';
import type { StructureBakedMesh, StructureGrid, StructureLightingField } from './contract';
import { computeFaceShade, FACE_BASIS } from './lighting';
import {
  emitCulledGridShape,
  setVec3,
  shapeBoxSpecs,
  tileForBoxFace,
  tileForFace,
  writeQuadUv,
  writeSpecBoxUv,
  type CachedBlockState,
  type EmitCulledQuadFn,
  type LocalBoxSpec,
} from './shapes';
import { emitArchitecturalTrims } from './trim';
import { isNearEnclosedRoom } from './vertexWeather';
import { isSolidOpaqueAt, voxelAt } from './subvoxel';

interface MaskCell {
  readonly key: string;
  readonly layer: BlockRenderLayer;
  readonly tileId: string;
  readonly textureId: string;
  readonly flip: boolean;
  readonly colors: readonly number[];
}

const DIRS6: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];

const isFaceCulled = (
  ctx: MeshCtx,
  ownIdx: number,
  ownDesc: BlockDescriptor,
  nx: number,
  ny: number,
  nz: number,
): boolean => {
  if (ny >= ctx.maxY) return false;
  if (isSolidOpaqueAt(ctx.grid, ctx.descriptors, nx, ny, nz)) return true;
  if (ownDesc.top !== 'glass') return false;
  const nv = voxelAt(ctx.grid, nx, ny, nz);
  return (
    nv === ownIdx &&
    ctx.grid.customTags[(ny * ctx.grid.size[2] + nz) * ctx.grid.size[0] + nx] === null
  );
};

const writeSliceBounds = (
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

const maskTintKey = (qt: number): number =>
  ((qt >> 16) << 6) | (((qt >> 10) & 3) << 4) | (((qt >> 6) & 3) << 2) | ((qt >> 2) & 3);

const makeMaskCell = (
  ctx: MeshCtx,
  dir: CubeFaceDirection,
  s: number,
  u: number,
  v: number,
  axis: 0 | 1 | 2,
): MaskCell | null => {
  const [w, _h, d] = ctx.grid.size;
  const x = axis === 0 ? s : u;
  const y = axis === 1 ? s : v;
  const z = axis === 2 ? s : axis === 0 ? u : v;
  const idx = (y * d + z) * w + x;
  const voxel = ctx.grid.voxels[idx]!;
  if (voxel <= 0 || ctx.grid.customTags[idx] !== null) return null;
  const desc = ctx.descriptors[voxel]!;
  if (desc.shape !== 'full') return null;
  const n = FACE_BASIS[dir].normal;
  if (isFaceCulled(ctx, voxel, desc, x + n[0], y + n[1], z + n[2])) return null;
  const tileId = tileForFace(desc, dir, ctx.parsedStates[voxel]!.facing);
  const textureId = structureTileTextureId(desc.layer, tileId);
  const shade = computeFaceShade(
    ctx.grid,
    ctx.descriptors,
    ctx.lighting,
    x,
    y,
    z,
    dir,
    desc.layer === 'emissive',
    ctx.maxY,
    true,
  );
  return {
    key: `${desc.layer}|${textureId}|${shade.aoCode}|${maskTintKey(shade.quantizedTint)}|${shade.flip ? 1 : 0}`,
    layer: desc.layer,
    tileId,
    textureId,
    flip: shade.flip,
    colors: shade.colors,
  };
};

const fillSliceMask = (
  ctx: MeshCtx,
  dir: CubeFaceDirection,
  s: number,
  dims: SliceDims,
  mask: (MaskCell | null)[],
): number => {
  let rawFaces = 0;
  for (let v = 0; v < dims.vLen; v += 1) {
    for (let u = 0; u < dims.uLen; u += 1) {
      const cell = makeMaskCell(ctx, dir, s, u, v, dims.axis);
      if (!cell) continue;
      rawFaces += 1;
      mask[v * dims.uLen + u] = cell;
    }
  }
  return rawFaces;
};

interface GreedyState {
  readonly ctx: MeshCtx;
  readonly fullBatches: Map<string, BatchDraft>;
  readonly repeatingKeys: Set<string>;
  readonly scratch: NonFullScratch;
  readonly fromBuf: [number, number, number];
  readonly toBuf: [number, number, number];
  readonly uvsBuf: number[];
}

const greedySpan = (
  mask: readonly (MaskCell | null)[],
  uLen: number,
  vLen: number,
  u0: number,
  v0: number,
  key: string,
) => {
  let mw = 1;
  while (u0 + mw < uLen && mask[v0 * uLen + u0 + mw]?.key === key) mw += 1;
  let mh = 1;
  outer: while (v0 + mh < vLen) {
    for (let k = 0; k < mw; k += 1) if (mask[(v0 + mh) * uLen + u0 + k]?.key !== key) break outer;
    mh += 1;
  }
  return { mw, mh };
};

const clearSpanMask = (
  mask: (MaskCell | null)[],
  uLen: number,
  u: number,
  v: number,
  mw: number,
  mh: number,
): void => {
  for (let dy = 0; dy < mh; dy += 1)
    for (let dx = 0; dx < mw; dx += 1) mask[(v + dy) * uLen + u + dx] = null;
};

const emitMergedSliceQuads = (
  g: GreedyState,
  dir: CubeFaceDirection,
  s: number,
  dims: SliceDims,
  mask: (MaskCell | null)[],
): number => {
  const [w, _h, d] = g.ctx.grid.size;
  const [hw, hd] = [w / 2, d / 2];
  let merged = 0;
  for (let v = 0; v < dims.vLen; v += 1) {
    for (let u = 0; u < dims.uLen; u += 1) {
      const cell = mask[v * dims.uLen + u];
      if (!cell) continue;
      const { mw, mh } = greedySpan(mask, dims.uLen, dims.vLen, u, v, cell.key);
      clearSpanMask(mask, dims.uLen, u, v, mw, mh);
      writeSliceBounds(dims.axis, s, u, v, mw, mh, hw, hd, g.fromBuf, g.toBuf);
      writeQuadUv(g.uvsBuf, (u & 1) * 0.5, (v & 1) * 0.5, mw * 0.5, mh * 0.5);
      const batch = getBatch(g.fullBatches, cell.layer, cell.tileId);
      if (mw > 1 || mh > 1) g.repeatingKeys.add(`${cell.layer}:${batch.textureId}`);
      pushQuad(batch, dir, g.fromBuf, g.toBuf, g.uvsBuf, cell.colors, cell.flip);
      merged += 1;
    }
  }
  return merged;
};

const greedyMeshFullBlocks = (g: GreedyState) => {
  const [w, _h, d] = g.ctx.grid.size;
  let [rawFaces, mergedQuads] = [0, 0];
  for (const dir of DIRS6) {
    const dims = sliceDimsFor(dir, w, g.ctx.maxY, d);
    const mask = new Array<MaskCell | null>(dims.uLen * dims.vLen).fill(null);
    for (let s = 0; s < dims.sliceLen; s += 1) {
      rawFaces += fillSliceMask(g.ctx, dir, s, dims, mask);
      mergedQuads += emitMergedSliceQuads(g, dir, s, dims, mask);
    }
  }
  return { rawFaces, mergedQuads };
};

const connectsNeighbor = (
  ctx: MeshCtx,
  x: number,
  y: number,
  z: number,
  shape: BlockDescriptor['shape'],
): boolean => {
  if (y < 0 || y >= ctx.maxY) return false;
  const v = voxelAt(ctx.grid, x, y, z);
  return v > 0 && (ctx.descriptors[v]!.solidOpaque || ctx.descriptors[v]!.shape === shape);
};

const FLUSH_FACE_CHECK: readonly (readonly [0 | 1 | 2, boolean, number])[] = [
  [2, false, 0],
  [2, true, 16],
  [0, true, 16],
  [0, false, 0],
  [1, true, 16],
  [1, false, 0],
];

const isBoxBoundaryOccluded = (
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
  const [axis, isTo, bound] = FLUSH_FACE_CHECK[dirIdx]!;
  if (isTo ? spec.to[axis] < bound : spec.from[axis] > bound) return false;
  const n = FACE_BASIS[dir].normal;
  const [nx, ny, nz] = [x + n[0], y + n[1], z + n[2]];
  if (ny >= ctx.maxY) return false;
  const nv = voxelAt(ctx.grid, nx, ny, nz);
  if (nv <= 0) return false;
  const [w, _h, d] = ctx.grid.size;
  if (ctx.grid.customTags[(ny * d + nz) * w + nx] !== null) return false;
  const ndesc = ctx.descriptors[nv]!;
  return ndesc.solidOpaque || ((shape === 'pane' || shape === 'door') && ndesc.shape === shape);
};

const emitBoxSpecFaces = (
  ctx: MeshCtx,
  desc: BlockDescriptor,
  cached: CachedBlockState,
  spec: LocalBoxSpec,
  x: number,
  y: number,
  z: number,
  scratch: NonFullScratch,
): number => {
  const [w, _h, d] = ctx.grid.size;
  setVec3(
    scratch.from,
    x + spec.from[0] / 16 - w / 2,
    y + spec.from[1] / 16,
    z + spec.from[2] / 16 - d / 2,
  );
  setVec3(
    scratch.to,
    x + spec.to[0] / 16 - w / 2,
    y + spec.to[1] / 16,
    z + spec.to[2] / 16 - d / 2,
  );
  const layer: BlockRenderLayer = spec.layer ?? (spec.emissive ? 'emissive' : desc.layer);
  const { grid, descriptors, lighting, maxY } = ctx;
  let count = 0;
  for (let i = 0; i < 6; i += 1) {
    const dir = DIRS6[i]!;
    if (isBoxBoundaryOccluded(ctx, desc.shape, spec, x, y, z, i, dir)) continue;
    const tileId = tileForBoxFace(desc, spec, dir, cached.facing);
    const shade = computeFaceShade(
      grid,
      descriptors,
      lighting,
      x,
      y,
      z,
      dir,
      layer === 'emissive',
      maxY,
      false,
      scratch.colors,
    );
    writeSpecBoxUv(dir, spec, scratch.uvs);
    pushQuad(
      getBatch(ctx.batches, layer, tileId),
      dir,
      scratch.from,
      scratch.to,
      scratch.uvs,
      shade.colors,
      shade.flip,
    );
    count += 1;
  }
  return count;
};

const safeOcclusionKey = (ctx: MeshCtx, x: number, y: number, z: number): number => {
  if (y >= ctx.maxY) return -1;
  const v = voxelAt(ctx.grid, x, y, z);
  if (v <= 0) return v;
  const [w, _h, d] = ctx.grid.size;
  if (ctx.grid.customTags[(y * d + z) * w + x] !== null) return -2;
  return ctx.descriptors[v]!.solidOpaque ? -99 : v;
};

const samePerpNeighbors = (
  ctx: MeshCtx,
  cx: number,
  cz: number,
  x0: number,
  y: number,
  z0: number,
  nx: number,
  nz: number,
): boolean => {
  const offs: readonly [number, number, number][] = [
    [0, 1, 0],
    [0, -1, 0],
    [cx, 0, cz],
    [-cx, 0, -cz],
  ];
  return offs.every(
    ([dx, dy, dz]) =>
      safeOcclusionKey(ctx, x0 + dx, y + dy, z0 + dz) ===
      safeOcclusionKey(ctx, nx + dx, y + dy, nz + dz),
  );
};

const scanGridShapeRun = (
  ctx: MeshCtx,
  visited: Uint8Array,
  v: number,
  desc: BlockDescriptor,
  cached: CachedBlockState,
  x: number,
  y: number,
  z: number,
) => {
  const axis: 0 | 2 =
    desc.shape === 'stair' && (cached.facing === 'east' || cached.facing === 'west') ? 2 : 0;
  const straight =
    desc.shape === 'slab' ||
    !cached.parsed.properties.shape ||
    cached.parsed.properties.shape === 'straight';
  const uCoord = axis === 0 ? x : z;
  if (!straight) return { axis, len: 1, uCoord };
  const [w, _h, d] = ctx.grid.size;
  const [limit, stride, stepX, stepZ] = axis === 0 ? [w - x, 1, 1, 0] : [d - z, w, 0, 1];
  const [cx, cz] = [axis === 0 ? 0 : 1, axis === 0 ? 1 : 0];
  const baseIdx = (y * d + z) * w + x;
  let len = 1;
  while (len < limit) {
    const nIdx = baseIdx + len * stride;
    if (visited[nIdx] !== 0 || ctx.grid.voxels[nIdx] !== v || ctx.grid.customTags[nIdx] !== null)
      break;
    if (!samePerpNeighbors(ctx, cx, cz, x, y, z, x + len * stepX, z + len * stepZ)) break;
    visited[nIdx] = 1;
    len += 1;
  }
  return { axis, len, uCoord };
};

const emitSingleNonFullVoxel = (
  ctx: MeshCtx,
  visited: Uint8Array,
  emitQuad: EmitCulledQuadFn,
  scratch: NonFullScratch,
  conns: [boolean, boolean, boolean, boolean],
  idx: number,
  v: number,
  desc: BlockDescriptor,
): number => {
  const [w, _h, d] = ctx.grid.size;
  const [x, z, y] = [idx % w, Math.floor(idx / w) % d, Math.floor(idx / (w * d))];
  const cached = ctx.parsedStates[v]!;
  if (desc.shape === 'stair' || desc.shape === 'slab') {
    visited[idx] = 1;
    return emitCulledGridShape(
      ctx,
      emitQuad,
      desc,
      cached,
      x,
      y,
      z,
      scratch,
      scanGridShapeRun(ctx, visited, v, desc, cached, x, y, z),
    );
  }
  conns[0] = connectsNeighbor(ctx, x, y, z - 1, desc.shape);
  conns[1] = connectsNeighbor(ctx, x, y, z + 1, desc.shape);
  conns[2] = connectsNeighbor(ctx, x + 1, y, z, desc.shape);
  conns[3] = connectsNeighbor(ctx, x - 1, y, z, desc.shape);
  const glow =
    desc.shape === 'pane' && desc.top !== 'iron_bars' && isNearEnclosedRoom(ctx.grid, x, y, z);
  let count = 0;
  for (const spec of shapeBoxSpecs(desc, cached.parsed, cached.facing, conns, glow)) {
    count += emitBoxSpecFaces(ctx, desc, cached, spec, x, y, z, scratch);
  }
  return count;
};

const emitNonFullBlocks = (g: GreedyState): number => {
  const [w, _h, d] = g.ctx.grid.size;
  const conns: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  const visited = new Uint8Array(g.ctx.maxY * d * w);
  const emitQuad: EmitCulledQuadFn = (layer, tile, dir, from, to, uvs, cols, flip, stretch) => {
    const b = getBatch(stretch ? g.fullBatches : g.ctx.batches, layer, tile);
    if (stretch) g.repeatingKeys.add(`${layer}:${b.textureId}`);
    pushQuad(b, dir, from, to, uvs, cols, flip);
  };
  let count = 0;
  for (let idx = 0; idx < g.ctx.maxY * d * w; idx += 1) {
    if (visited[idx] !== 0) continue;
    const v = g.ctx.grid.voxels[idx]!;
    const desc = v > 0 && g.ctx.grid.customTags[idx] === null ? g.ctx.descriptors[v]! : null;
    if (!desc || desc.shape === 'full') continue;
    count += emitSingleNonFullVoxel(g.ctx, visited, emitQuad, g.scratch, conns, idx, v, desc);
  }
  return count;
};

export const buildStructureBakedMesh = (
  grid: StructureGrid,
  lighting: StructureLightingField,
  customModels: Readonly<Record<string, CompiledModel>>,
  options?: { readonly cutawayY?: number; readonly descriptors?: readonly BlockDescriptor[] },
): StructureBakedMesh => {
  const maxY = Math.min(grid.size[1], options?.cutawayY ?? grid.size[1]);
  const descriptors = options?.descriptors ?? grid.states.map(describeBlockState);
  const parsedStates: CachedBlockState[] = grid.states.map((s) => {
    const parsed = parseBlockState(s);
    const f = parsed.properties.facing;
    return { parsed, facing: f === 'south' || f === 'east' || f === 'west' ? f : 'north' };
  });
  const ctx: MeshCtx = { grid, descriptors, parsedStates, lighting, maxY, batches: new Map() };
  const g: GreedyState = {
    ctx,
    fullBatches: new Map(),
    repeatingKeys: new Set(),
    scratch: { from: [0, 0, 0], to: [0, 0, 0], uvs: new Array(8), colors: new Array(12) },
    fromBuf: [0, 0, 0],
    toBuf: [0, 0, 0],
    uvsBuf: new Array(8),
  };
  const fullCounts = greedyMeshFullBlocks(g);
  const nonFullCount = emitNonFullBlocks(g);
  const trimCount = emitArchitecturalTrims(ctx, g.scratch);
  const packed = packStructureBatches(g.fullBatches, g.repeatingKeys, ctx.batches, grid);
  return {
    batches: packed.batches,
    textures: packed.textures,
    instances: collectPropInstances(grid, lighting, customModels, maxY),
    rawFaceCount: fullCounts.rawFaces + nonFullCount,
    mergedQuadCount: fullCounts.mergedQuads + nonFullCount,
    trimCount,
  };
};
