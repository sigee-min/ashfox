import { compareText } from '@ashfox/internal-contracts';
import type { CompiledModel } from '../../model/compiled';
import type { CubeFaceDirection } from '../../model/scene';
import type { TextureAsset } from '../../model/texture';
import type { CardinalFacing } from '../../project/structure/contract';
import { parseBlockState } from '../../project/structure/state';
import { buildStructureTileTextures, structureTileTextureId } from './atlas';
import { describeBlockState, type BlockDescriptor, type BlockRenderLayer } from './blocks';
import type {
  StructureBakedBatch,
  StructureBakedMesh,
  StructureGrid,
  StructureLightingField,
  StructurePropInstance,
} from './contract';
import { computeFaceShade, FACE_BASIS, FACE_CORNER_TABLE, samplePropLightRgb } from './lighting';
import { shapeBoxSpecs, tileForFace, type CachedBlockState, type LocalBoxSpec } from './shapes';

interface BatchDraft {
  readonly layer: BlockRenderLayer;
  readonly textureId: string;
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly colors: number[];
  readonly indices: number[];
}

interface MaskCell {
  readonly key: string;
  readonly layer: BlockRenderLayer;
  readonly textureId: string;
  readonly flip: boolean;
  readonly colors: readonly number[];
}

interface MeshCtx {
  readonly grid: StructureGrid;
  readonly descriptors: readonly BlockDescriptor[];
  readonly parsedStates: readonly CachedBlockState[];
  readonly lighting: StructureLightingField;
  readonly maxY: number;
  readonly batches: Map<string, BatchDraft>;
}

const DIRS6: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];

const getBatch = (
  batches: Map<string, BatchDraft>,
  layer: BlockRenderLayer,
  textureId: string,
): BatchDraft => {
  const key = `${layer}:${textureId}`;
  let batch = batches.get(key);
  if (!batch) {
    batch = { layer, textureId, positions: [], normals: [], uvs: [], colors: [], indices: [] };
    batches.set(key, batch);
  }
  return batch;
};

const pushQuad = (
  batch: BatchDraft,
  dir: CubeFaceDirection,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  uvs: readonly number[],
  colors: readonly number[],
  flip: boolean,
): void => {
  const base = batch.positions.length / 3;
  const t = FACE_CORNER_TABLE[dir];
  const normal = FACE_BASIS[dir].normal;
  for (let i = 0; i < 4; i += 1) {
    const k = i * 3;
    batch.positions.push(
      t[k]! ? to[0] : from[0],
      t[k + 1]! ? to[1] : from[1],
      t[k + 2]! ? to[2] : from[2],
    );
    batch.normals.push(normal[0], normal[1], normal[2]);
    batch.uvs.push(uvs[i * 2]!, uvs[i * 2 + 1]!);
    batch.colors.push(colors[k]!, colors[k + 1]!, colors[k + 2]!);
  }
  if (flip) batch.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
  else batch.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
};

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

const setVec3 = (out: [number, number, number], x: number, y: number, z: number): void => {
  out[0] = x;
  out[1] = y;
  out[2] = z;
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

const writeQuadUv = (uvs: number[], pu: number, pv: number, uSpan: number, vSpan: number): void => {
  uvs[0] = pu;
  uvs[1] = pv + vSpan;
  uvs[2] = pu + uSpan;
  uvs[3] = pv + vSpan;
  uvs[4] = pu + uSpan;
  uvs[5] = pv;
  uvs[6] = pu;
  uvs[7] = pv;
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
  const { grid, descriptors, lighting, maxY } = ctx;
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
  );
  return {
    key: `${desc.layer}|${textureId}|${shade.aoCode}|${shade.quantizedTint}|${shade.flip ? 1 : 0}`,
    layer: desc.layer,
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

const emitMergedSliceQuads = (
  ctx: MeshCtx,
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
      for (let dy = 0; dy < mh; dy += 1)
        for (let dx = 0; dx < mw; dx += 1) mask[(v + dy) * dims.uLen + u + dx] = null;
      writeSliceBounds(dims.axis, s, u, v, mw, mh, hw, hd, fromBuf, toBuf);
      writeQuadUv(uvsBuf, (u & 1) * 0.5, (v & 1) * 0.5, mw * 0.5, mh * 0.5);
      const batch = getBatch(ctx.batches, cell.layer, cell.textureId);
      pushQuad(batch, dir, fromBuf, toBuf, uvsBuf, cell.colors, cell.flip);
      merged += 1;
    }
  }
  return merged;
};

const greedyMeshFullBlocks = (ctx: MeshCtx) => {
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
      mergedQuads += emitMergedSliceQuads(ctx, dir, s, dims, mask, fromBuf, toBuf, uvsBuf);
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

interface NonFullScratch {
  readonly from: [number, number, number];
  readonly to: [number, number, number];
  readonly uvs: number[];
  readonly colors: number[];
}

const writeSpecBoxUv = (
  dir: CubeFaceDirection,
  spec: LocalBoxSpec,
  x: number,
  y: number,
  z: number,
  uvs: number[],
): void => {
  const ew = dir === 'east' || dir === 'west';
  const ud = dir === 'up' || dir === 'down';
  const uSpan = ((ew ? spec.to[2] - spec.from[2] : spec.to[0] - spec.from[0]) / 16) * 0.5;
  const vSpan = ((ud ? spec.to[2] - spec.from[2] : spec.to[1] - spec.from[1]) / 16) * 0.5;
  writeQuadUv(uvs, ((ew ? z : x) & 1) * 0.5, ((ud ? z : y) & 1) * 0.5, uSpan, vSpan);
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
  const layer: BlockRenderLayer = spec.emissive ? 'emissive' : desc.layer;
  const { grid, descriptors, lighting, maxY, batches } = ctx;
  for (const dir of DIRS6) {
    const texId = structureTileTextureId(
      layer,
      spec.tileOverride ?? tileForFace(desc, dir, cached.facing),
    );
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
    writeSpecBoxUv(dir, spec, x, y, z, scratch.uvs);
    pushQuad(
      getBatch(batches, layer, texId),
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

const emitNonFullBlocks = (ctx: MeshCtx): number => {
  const [w, _h, d] = ctx.grid.size;
  const conns: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  const scratch: NonFullScratch = {
    from: [0, 0, 0],
    to: [0, 0, 0],
    uvs: new Array<number>(8),
    colors: new Array<number>(12),
  };
  let count = 0;
  for (let idx = 0; idx < ctx.maxY * d * w; idx += 1) {
    const v = ctx.grid.voxels[idx]!;
    if (v <= 0 || ctx.grid.customTags[idx] !== null) continue;
    const desc = ctx.descriptors[v]!;
    if (desc.shape === 'full') continue;
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    conns[0] = connectsNeighbor(ctx, x, y, z - 1, desc.shape);
    conns[1] = connectsNeighbor(ctx, x, y, z + 1, desc.shape);
    conns[2] = connectsNeighbor(ctx, x + 1, y, z, desc.shape);
    conns[3] = connectsNeighbor(ctx, x - 1, y, z, desc.shape);
    const cached = ctx.parsedStates[v]!;
    for (const spec of shapeBoxSpecs(desc, cached.parsed, cached.facing, conns)) {
      count += emitBoxSpecFaces(ctx, desc, cached, spec, x, y, z, scratch);
    }
  }
  return count;
};

const collectBakedTileRequests = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  maxY: number,
) => {
  const reqs: { readonly layer: BlockRenderLayer; readonly tileId: string }[] = [];
  const usedStates = new Set<number>();
  const [w, _h, d] = grid.size;
  for (let idx = 0; idx < maxY * d * w; idx += 1) {
    const v = grid.voxels[idx]!;
    if (v > 0 && grid.customTags[idx] === null) usedStates.add(v);
  }
  for (const v of usedStates) {
    const desc = descriptors[v]!;
    reqs.push(
      { layer: desc.layer, tileId: desc.top },
      { layer: desc.layer, tileId: desc.bottom },
      { layer: desc.layer, tileId: desc.side },
      { layer: desc.layer, tileId: desc.front },
    );
    if (desc.shape === 'campfire') {
      reqs.push(
        { layer: 'opaque', tileId: 'spruce_planks' },
        { layer: 'opaque', tileId: 'oak_planks' },
      );
    }
  }
  return reqs;
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
  const textures: Readonly<Record<string, TextureAsset>> = buildStructureTileTextures(
    collectBakedTileRequests(grid, descriptors, maxY),
    grid.density,
    grid.seed,
  );
  const ctx: MeshCtx = { grid, descriptors, parsedStates, lighting, maxY, batches: new Map() };
  const fullCounts = greedyMeshFullBlocks(ctx);
  const nonFullCount = emitNonFullBlocks(ctx);
  const batches: StructureBakedBatch[] = [...ctx.batches.values()]
    .filter((b) => b.indices.length > 0)
    .sort((a, b) => compareText(a.layer, b.layer) || compareText(a.textureId, b.textureId));
  return {
    batches,
    textures,
    instances: collectPropInstances(grid, lighting, customModels, maxY),
    rawFaceCount: fullCounts.rawFaces + nonFullCount,
    mergedQuadCount: fullCounts.mergedQuads + nonFullCount,
  };
};
