import type { CompiledModel } from '../../model/compiled';
import type { CubeFaceDirection } from '../../model/scene';
import { parseBlockState } from '../../project/structure/state';
import { packStructureBatches } from './atlas';
import {
  collectPropInstances,
  getBatch,
  pushQuad,
  sliceDimsFor,
  type BatchDraft,
  type MeshCtx,
  type NonFullScratch,
  type SliceDims,
} from './batch';
import { describeBlockState, type BlockDescriptor, type BlockRenderLayer } from './blocks';
import type { StructureBakedMesh, StructureGrid, StructureLightingField } from './contract';
import {
  buildTileTable,
  clearSpanMeta,
  copySpanColors,
  ensureSliceScratch,
  greedySpan,
  isBoxBoundaryOccluded,
  maskTintKey,
  samePerpNeighbors,
  sliceRowStart,
  writeSliceBounds,
  writeSpanColors,
  type SliceScratch,
  type TileTable,
} from './greedyMask';
import {
  computeFaceShade,
  FACE_BASIS,
  SHARED_FACE_SHADE,
  type MutableFaceShadeInfo,
} from './lighting';
import {
  emitCulledGridShape,
  setVec3,
  shapeBoxSpecs,
  tileForBoxFace,
  writeQuadUv,
  writeSpecBoxUv,
  type CachedBlockState,
  type EmitCulledQuadFn,
  type LocalBoxSpec,
} from './shapes';
import { emitArchitecturalTrims } from './trim';
import { emitInteriorBakedMeshes, isCoveredByTranslucentWindow } from './interior/mesh';
import { isNearEnclosedRoom } from './vertexWeather';
import { voxelAt } from './subvoxel';

const DIRS6: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];

const isFaceCulled = (
  g: GreedyState,
  ownIdx: number,
  ownDesc: BlockDescriptor,
  nx: number,
  ny: number,
  nz: number,
): boolean => {
  const size = g.ctx.grid.size;
  const w = size[0];
  const d = size[2];
  if (nx < 0 || nx >= w || ny < 0 || ny >= g.ctx.maxY || nz < 0 || nz >= d) return false;
  const nIdx = (ny * d + nz) * w + nx;
  const nv = g.ctx.grid.voxels[nIdx]!;
  if (nv <= 0 || g.ctx.grid.customTags[nIdx] !== null) return false;
  if (g.tiles.isOpaque[nv] === 1) return true;
  return ownDesc.top === 'glass' && nv === ownIdx;
};

interface GreedyState {
  readonly ctx: MeshCtx;
  readonly tiles: TileTable;
  readonly fullBatches: Map<string, BatchDraft>;
  readonly repeatingKeys: Set<string>;
  readonly scratch: NonFullScratch;
  readonly shadeScratch: MutableFaceShadeInfo;
}

const fillSliceCell = (
  g: GreedyState,
  dir: CubeFaceDirection,
  dirIdx: number,
  voxel: number,
  nxOff: number,
  nyOff: number,
  nzOff: number,
  x: number,
  y: number,
  z: number,
  cellIdx: number,
  slice: SliceScratch,
): boolean => {
  const { grid, descriptors, lighting, maxY } = g.ctx;
  const desc = descriptors[voxel]!;
  if (isFaceCulled(g, voxel, desc, x + nxOff, y + nyOff, z + nzOff)) return false;
  const tileIdx = g.tiles.stateDirTileIdx[voxel * 6 + dirIdx]!;
  const shade = computeFaceShade(
    grid,
    descriptors,
    lighting,
    x,
    y,
    z,
    dir,
    desc.layer === 'emissive',
    maxY,
    true,
    g.scratch.colors,
    g.shadeScratch,
  );
  const flipBit = shade.flip ? 1 : 0;
  slice.keys[cellIdx] = (shade.aoCode << 12) | maskTintKey(shade.quantizedTint);
  slice.meta[cellIdx] = (tileIdx << 1) | flipBit;
  writeSpanColors(slice.colors, cellIdx, g.scratch.colors);
  return true;
};

const fillSliceRow = (
  g: GreedyState,
  dir: CubeFaceDirection,
  dirIdx: number,
  s: number,
  v: number,
  dims: SliceDims,
  slice: SliceScratch,
): number => {
  const n = FACE_BASIS[dir].normal;
  const size = g.ctx.grid.size;
  const w = size[0];
  const axis = dims.axis;
  const voxels = g.ctx.grid.voxels;
  const customTags = g.ctx.grid.customTags;
  const isFull = g.tiles.isFull;
  const vStep = axis === 0 ? w : 1;
  let vIdx = sliceRowStart(axis, s, v, w, size[2]);
  const x0 = axis === 0 ? s : 0;
  const y = axis === 1 ? s : v;
  const z0 = axis === 2 ? s : axis === 0 ? 0 : v;
  const uX = axis === 0 ? 0 : 1;
  const uZ = axis === 0 ? 1 : 0;
  const rowBase = v * dims.uLen;
  let rowFaces = 0;
  for (let u = 0; u < dims.uLen; u += 1, vIdx += vStep) {
    const voxel = voxels[vIdx]!;
    if (voxel <= 0 || isFull[voxel] === 0 || customTags[vIdx] !== null) continue;
    const x = x0 + u * uX;
    const z = z0 + u * uZ;
    if (fillSliceCell(g, dir, dirIdx, voxel, n[0], n[1], n[2], x, y, z, rowBase + u, slice))
      rowFaces += 1;
  }
  return rowFaces;
};

const fillSliceMask = (
  g: GreedyState,
  dir: CubeFaceDirection,
  dirIdx: number,
  s: number,
  dims: SliceDims,
  slice: SliceScratch,
): number => {
  let rawFaces = 0;
  for (let v = 0; v < dims.vLen; v += 1) {
    rawFaces += fillSliceRow(g, dir, dirIdx, s, v, dims, slice);
  }
  return rawFaces;
};

const batchForTile = (g: GreedyState, tileIdx: number): BatchDraft => {
  let batch = g.tiles.batches[tileIdx];
  if (batch === undefined) {
    batch = getBatch(g.fullBatches, g.tiles.layers[tileIdx]!, g.tiles.tileIds[tileIdx]!);
    g.tiles.batches[tileIdx] = batch;
  }
  return batch;
};

const emitMergedSliceQuads = (
  g: GreedyState,
  dir: CubeFaceDirection,
  s: number,
  dims: SliceDims,
  slice: SliceScratch,
): number => {
  const hw = g.ctx.grid.size[0] / 2;
  const hd = g.ctx.grid.size[2] / 2;
  const uLen = dims.uLen;
  const vLen = dims.vLen;
  const keys = slice.keys;
  const meta = slice.meta;
  let merged = 0;
  for (let v = 0; v < vLen; v += 1) {
    const rowBase = v * uLen;
    for (let u = 0; u < uLen; u += 1) {
      const cellIdx = rowBase + u;
      const m = meta[cellIdx]!;
      if (m === 0) continue;
      const key = keys[cellIdx]!;
      const tileIdx = m >>> 1;
      const flip = (m & 1) === 1;
      const packedSpan = greedySpan(keys, meta, uLen, vLen, u, v, key, m);
      const mw = packedSpan >>> 16;
      const mh = packedSpan & 0xffff;
      copySpanColors(slice.colors, cellIdx, g.scratch.colors);
      clearSpanMeta(meta, uLen, u, v, mw, mh);
      writeSliceBounds(dims.axis, s, u, v, mw, mh, hw, hd, g.scratch.from, g.scratch.to);
      writeQuadUv(g.scratch.uvs, (u & 1) * 0.5, (v & 1) * 0.5, mw * 0.5, mh * 0.5);
      const batch = batchForTile(g, tileIdx);
      if (mw > 1 || mh > 1) g.repeatingKeys.add(g.tiles.repeatKeys[tileIdx]!);
      pushQuad(batch, dir, g.scratch.from, g.scratch.to, g.scratch.uvs, g.scratch.colors, flip);
      merged += 1;
    }
  }
  return merged;
};

const greedyMeshFullBlocks = (g: GreedyState) => {
  const w = g.ctx.grid.size[0];
  const d = g.ctx.grid.size[2];
  let rawFaces = 0;
  let mergedQuads = 0;
  for (let dirIdx = 0; dirIdx < 6; dirIdx += 1) {
    const dir = DIRS6[dirIdx]!;
    const dims = sliceDimsFor(dir, w, g.ctx.maxY, d);
    const slice = ensureSliceScratch(dims.uLen * dims.vLen);
    slice.meta.fill(0, 0, dims.uLen * dims.vLen);
    for (let s = 0; s < dims.sliceLen; s += 1) {
      const sliceRaw = fillSliceMask(g, dir, dirIdx, s, dims, slice);
      if (sliceRaw === 0) continue;
      rawFaces += sliceRaw;
      mergedQuads += emitMergedSliceQuads(g, dir, s, dims, slice);
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
      SHARED_FACE_SHADE,
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
  const w = ctx.grid.size[0];
  const d = ctx.grid.size[2];
  const x = idx % w;
  const row = (idx / w) | 0;
  const z = row % d;
  const y = (row / d) | 0;
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
  if (
    desc.shape === 'pane' &&
    desc.top !== 'iron_bars' &&
    isCoveredByTranslucentWindow(ctx.grid, x, y, z)
  ) {
    return 0;
  }
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
  const voxels = g.ctx.grid.voxels;
  const customTags = g.ctx.grid.customTags;
  const isFull = g.tiles.isFull;
  const total = g.ctx.maxY * d * w;
  let count = 0;
  for (let idx = 0; idx < total; idx += 1) {
    if (visited[idx] !== 0) continue;
    const v = voxels[idx]!;
    if (v <= 0 || isFull[v] === 1 || customTags[idx] !== null) continue;
    count += emitSingleNonFullVoxel(
      g.ctx,
      visited,
      emitQuad,
      g.scratch,
      conns,
      idx,
      v,
      g.ctx.descriptors[v]!,
    );
  }
  return count;
};

export const buildStructureBakedMesh = (
  grid: StructureGrid,
  lighting: StructureLightingField,
  customModels: Readonly<Record<string, CompiledModel>>,
  options?: {
    readonly cutawayY?: number;
    readonly descriptors?: readonly BlockDescriptor[];
  },
): StructureBakedMesh => {
  const maxY = Math.min(grid.size[1], options?.cutawayY ?? grid.size[1]);
  const descriptors = options?.descriptors ?? grid.states.map(describeBlockState);
  const parsedStates: CachedBlockState[] = grid.states.map((s) => {
    const parsed = parseBlockState(s);
    const f = parsed.properties.facing;
    return {
      parsed,
      facing: f === 'south' || f === 'east' || f === 'west' ? f : 'north',
    };
  });
  const ctx: MeshCtx = {
    grid,
    descriptors,
    parsedStates,
    lighting,
    maxY,
    batches: new Map(),
  };
  const scratchColors = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const g: GreedyState = {
    ctx,
    tiles: buildTileTable(ctx),
    fullBatches: new Map(),
    repeatingKeys: new Set(),
    scratch: {
      from: [0, 0, 0],
      to: [0, 0, 0],
      uvs: new Array(8),
      colors: scratchColors,
    },
    shadeScratch: { aoCode: 0, flip: false, quantizedTint: 32767, colors: scratchColors },
  };
  const fullCounts = greedyMeshFullBlocks(g);
  const nonFullCount = emitNonFullBlocks(g);
  const trimCount = emitArchitecturalTrims(ctx, g.scratch);
  const interiorInstances = emitInteriorBakedMeshes(grid, ctx.batches, customModels, maxY);
  const packed = packStructureBatches(g.fullBatches, g.repeatingKeys, ctx.batches, grid);
  return {
    batches: packed.batches,
    textures: packed.textures,
    instances: [...collectPropInstances(grid, lighting, customModels, maxY), ...interiorInstances],
    rawFaceCount: fullCounts.rawFaces + nonFullCount,
    mergedQuadCount: fullCounts.mergedQuads + nonFullCount,
    trimCount,
  };
};
