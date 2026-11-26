import type { CompiledModel } from '../../model/compiled';
import type { CubeFaceDirection } from '../../model/scene';
import type { CardinalFacing } from '../../project/structure/contract';
import { parseBlockState } from '../../project/structure/state';
import { packStructureBatches, structureTileTextureId } from './atlas';
import { getBatch, pushQuad, type BatchDraft, type MeshCtx, type NonFullScratch } from './batch';
import { describeBlockState, type BlockDescriptor, type BlockRenderLayer } from './blocks';
import type {
  StructureBakedMesh,
  StructureGrid,
  StructureLightingField,
  StructurePropInstance,
} from './contract';
import { computeFaceShade, FACE_BASIS, samplePropLightRgb } from './lighting';
import {
  emitCulledGridShape,
  setVec3,
  shapeBoxSpecs,
  tileForBoxFace,
  tileForFace,
  writeQuadUv,
  writeSpecBoxUv,
  type CachedBlockState,
  type LocalBoxSpec,
} from './shapes';
import { emitArchitecturalTrims } from './trim';
import { isNearEnclosedRoom } from './vertexWeather';

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
  const [w, _h, d] = ctx.grid.size;
  if (nx < 0 || nx >= w || ny < 0 || ny >= ctx.maxY || nz < 0 || nz >= d) return false;
  const nIdx = (ny * d + nz) * w + nx;
  const nv = ctx.grid.voxels[nIdx]!;
  if (nv <= 0 || ctx.grid.customTags[nIdx] !== null) return false;
  return ctx.descriptors[nv]!.solidOpaque || (ownDesc.top === 'glass' && nv === ownIdx);
};

interface SliceDims {
  readonly axis: 0 | 1 | 2;
  readonly sliceLen: number;
  readonly uLen: number;
  readonly vLen: number;
}

const sliceDimsFor = (dir: CubeFaceDirection, w: number, maxY: number, d: number): SliceDims => {
  if (dir === 'north' || dir === 'south') return { axis: 2, sliceLen: d, uLen: w, vLen: maxY };
  if (dir === 'east' || dir === 'west') return { axis: 0, sliceLen: w, uLen: d, vLen: maxY };
  return { axis: 1, sliceLen: maxY, uLen: w, vLen: d };
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
  const normal = FACE_BASIS[dir].normal;
  if (isFaceCulled(ctx, voxel, desc, x + normal[0], y + normal[1], z + normal[2])) return null;
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
    key: `${desc.layer}|${textureId}|${shade.aoCode}|${shade.quantizedTint}|${shade.flip ? 1 : 0}`,
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
      if (cell) {
        rawFaces += 1;
        mask[v * dims.uLen + u] = cell;
      }
    }
  }
  return rawFaces;
};

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

const clearMaskSpan = (
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
  ctx: MeshCtx,
  fullBatches: Map<string, BatchDraft>,
  repeatingKeys: Set<string>,
  dir: CubeFaceDirection,
  s: number,
  dims: SliceDims,
  mask: (MaskCell | null)[],
  fromBuf: [number, number, number],
  toBuf: [number, number, number],
  uvsBuf: number[],
): number => {
  const [w, _h, d] = ctx.grid.size;
  const hw = w / 2;
  const hd = d / 2;
  let merged = 0;
  for (let v = 0; v < dims.vLen; v += 1) {
    for (let u = 0; u < dims.uLen; u += 1) {
      const cell = mask[v * dims.uLen + u];
      if (!cell) continue;
      const { mw, mh } = greedySpan(mask, dims.uLen, dims.vLen, u, v, cell.key);
      clearMaskSpan(mask, dims.uLen, u, v, mw, mh);
      writeSliceBounds(dims.axis, s, u, v, mw, mh, hw, hd, fromBuf, toBuf);
      writeQuadUv(uvsBuf, (u & 1) * 0.5, (v & 1) * 0.5, mw * 0.5, mh * 0.5);
      const batch = getBatch(fullBatches, cell.layer, cell.tileId);
      if (mw > 1 || mh > 1) repeatingKeys.add(`${cell.layer}:${batch.textureId}`);
      pushQuad(batch, dir, fromBuf, toBuf, uvsBuf, cell.colors, cell.flip);
      merged += 1;
    }
  }
  return merged;
};

const greedyMeshFullBlocks = (
  ctx: MeshCtx,
  fullBatches: Map<string, BatchDraft>,
  repeatingKeys: Set<string>,
) => {
  const [w, _h, d] = ctx.grid.size;
  const fromBuf: [number, number, number] = [0, 0, 0];
  const toBuf: [number, number, number] = [0, 0, 0];
  const uvsBuf = new Array<number>(8);
  let rawFaces = 0;
  let mergedQuads = 0;
  for (const dir of DIRS6) {
    const dims = sliceDimsFor(dir, w, ctx.maxY, d);
    const mask = new Array<MaskCell | null>(dims.uLen * dims.vLen).fill(null);
    for (let s = 0; s < dims.sliceLen; s += 1) {
      rawFaces += fillSliceMask(ctx, dir, s, dims, mask);
      mergedQuads += emitMergedSliceQuads(
        ctx,
        fullBatches,
        repeatingKeys,
        dir,
        s,
        dims,
        mask,
        fromBuf,
        toBuf,
        uvsBuf,
      );
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
  const [w, _h, d] = ctx.grid.size;
  if (x < 0 || x >= w || y < 0 || y >= ctx.maxY || z < 0 || z >= d) return false;
  const v = ctx.grid.voxels[(y * d + z) * w + x]!;
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
  for (const dir of DIRS6) {
    const tileId = tileForBoxFace(desc, spec, dir, cached.facing);
    const shade = computeFaceShade(
      ctx.grid,
      ctx.descriptors,
      ctx.lighting,
      x,
      y,
      z,
      dir,
      layer === 'emissive',
      ctx.maxY,
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
  }
  return 6;
};

const emitNonFullBlocks = (ctx: MeshCtx, scratch: NonFullScratch): number => {
  const [w, _h, d] = ctx.grid.size;
  const conns: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  let count = 0;
  for (let idx = 0; idx < ctx.maxY * d * w; idx += 1) {
    const v = ctx.grid.voxels[idx]!;
    if (v <= 0 || ctx.grid.customTags[idx] !== null) continue;
    const desc = ctx.descriptors[v]!;
    if (desc.shape === 'full') continue;
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    const cached = ctx.parsedStates[v]!;
    if (desc.shape === 'stair' || desc.shape === 'slab') {
      const emitQuad = (
        layer: BlockRenderLayer,
        tileId: string,
        dir: CubeFaceDirection,
        from: readonly [number, number, number],
        to: readonly [number, number, number],
        uvs: readonly number[],
        colors: readonly number[],
        flip: boolean,
      ) => pushQuad(getBatch(ctx.batches, layer, tileId), dir, from, to, uvs, colors, flip);
      count += emitCulledGridShape(ctx, emitQuad, desc, cached, x, y, z, scratch);
      continue;
    }
    conns[0] = connectsNeighbor(ctx, x, y, z - 1, desc.shape);
    conns[1] = connectsNeighbor(ctx, x, y, z + 1, desc.shape);
    conns[2] = connectsNeighbor(ctx, x + 1, y, z, desc.shape);
    conns[3] = connectsNeighbor(ctx, x - 1, y, z, desc.shape);
    const interiorGlow =
      desc.shape === 'pane' && desc.top !== 'iron_bars' && isNearEnclosedRoom(ctx.grid, x, y, z);
    for (const spec of shapeBoxSpecs(desc, cached.parsed, cached.facing, conns, interiorGlow)) {
      count += emitBoxSpecFaces(ctx, desc, cached, spec, x, y, z, scratch);
    }
  }
  return count;
};

const facingToRotY = (facing: CardinalFacing): 0 | 90 | 180 | 270 =>
  facing === 'east' ? 270 : facing === 'south' ? 180 : facing === 'west' ? 90 : 0;

const collectPropInstances = (
  grid: StructureGrid,
  lighting: StructureLightingField,
  customModels: Readonly<Record<string, CompiledModel>>,
  maxY: number,
): readonly StructurePropInstance[] => {
  const [w, _h, d] = grid.size;
  const instances: StructurePropInstance[] = [];
  for (const cp of grid.customPlacements) {
    if (cp.y >= maxY || !customModels[cp.assetAlias]) continue;
    instances.push({
      assetKey: cp.assetAlias,
      translation: [cp.x - w / 2 + 0.5, cp.y, cp.z - d / 2 + 0.5],
      rotation: facingToRotY(cp.facing),
      lightRgb: samplePropLightRgb(lighting, cp.x, cp.y, cp.z),
    });
  }
  return instances;
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
    const facing: CardinalFacing = f === 'south' || f === 'east' || f === 'west' ? f : 'north';
    return { parsed, facing };
  });
  const ctx: MeshCtx = {
    grid,
    descriptors,
    parsedStates,
    lighting,
    maxY,
    batches: new Map(),
  };
  const scratch: NonFullScratch = {
    from: [0, 0, 0],
    to: [0, 0, 0],
    uvs: new Array<number>(8),
    colors: new Array<number>(12),
  };
  const fullBatches = new Map<string, BatchDraft>();
  const repeatingKeys = new Set<string>();
  const fullCounts = greedyMeshFullBlocks(ctx, fullBatches, repeatingKeys);
  const nonFullCount = emitNonFullBlocks(ctx, scratch);
  const trimCount = emitArchitecturalTrims(ctx, scratch);
  const { batches, textures } = packStructureBatches(fullBatches, repeatingKeys, ctx.batches, grid);
  return {
    batches,
    textures,
    instances: collectPropInstances(grid, lighting, customModels, maxY),
    rawFaceCount: fullCounts.rawFaces + nonFullCount,
    mergedQuadCount: fullCounts.mergedQuads + nonFullCount,
    trimCount,
  };
};
