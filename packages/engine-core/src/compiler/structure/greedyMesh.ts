import type { CompiledModel } from '../../model/compiled';
import type { Vec3 } from '../../model/identity';
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
import { computeFaceShade, FACE_BASIS, faceCorners, samplePropLightRgb } from './lighting';
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
const CARDINALS: readonly [number, number, number][] = [
  [0, 0, -1],
  [0, 0, 1],
  [1, 0, 0],
  [-1, 0, 0],
];

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
  corners: readonly [Vec3, Vec3, Vec3, Vec3],
  normal: readonly [number, number, number],
  uvs: readonly [number, number, number, number, number, number, number, number],
  colors: readonly number[],
  flip: boolean,
): void => {
  const base = batch.positions.length / 3;
  for (let i = 0; i < 4; i += 1) {
    const c = corners[i]!;
    batch.positions.push(c[0], c[1], c[2]);
    batch.normals.push(normal[0], normal[1], normal[2]);
    batch.uvs.push(uvs[i * 2]!, uvs[i * 2 + 1]!);
    batch.colors.push(colors[i * 3]!, colors[i * 3 + 1]!, colors[i * 3 + 2]!);
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
  readonly sliceLen: number;
  readonly uLen: number;
  readonly vLen: number;
  readonly coords: (s: number, u: number, v: number) => readonly [number, number, number];
  readonly bounds: (
    s: number,
    u: number,
    v: number,
    mw: number,
    mh: number,
    hw: number,
    hd: number,
  ) => { readonly from: Vec3; readonly to: Vec3 };
}

const sliceDimsFor = (dir: CubeFaceDirection, w: number, maxY: number, d: number): SliceDims => {
  if (dir === 'north' || dir === 'south') {
    return {
      sliceLen: d,
      uLen: w,
      vLen: maxY,
      coords: (s, u, v) => [u, v, s],
      bounds: (s, u, v, mw, mh, hw, hd) => ({
        from: [u - hw, v, s - hd],
        to: [u + mw - hw, v + mh, s + 1 - hd],
      }),
    };
  }
  if (dir === 'east' || dir === 'west') {
    return {
      sliceLen: w,
      uLen: d,
      vLen: maxY,
      coords: (s, u, v) => [s, v, u],
      bounds: (s, u, v, mw, mh, hw, hd) => ({
        from: [s - hw, v, u - hd],
        to: [s + 1 - hw, v + mh, u + mw - hd],
      }),
    };
  }
  return {
    sliceLen: maxY,
    uLen: w,
    vLen: d,
    coords: (s, u, v) => [u, s, v],
    bounds: (s, u, v, mw, mh, hw, hd) => ({
      from: [u - hw, s, v - hd],
      to: [u + mw - hw, s + 1, v + mh - hd],
    }),
  };
};

const makeMaskCell = (
  ctx: MeshCtx,
  dir: CubeFaceDirection,
  s: number,
  u: number,
  v: number,
  dims: SliceDims,
): MaskCell | null => {
  const [w, _h, d] = ctx.grid.size;
  const basis = FACE_BASIS[dir];
  const [x, y, z] = dims.coords(s, u, v);
  const idx = (y * d + z) * w + x;
  const voxel = ctx.grid.voxels[idx]!;
  if (voxel <= 0 || ctx.grid.customTags[idx] !== null) return null;
  const desc = ctx.descriptors[voxel]!;
  if (desc.shape !== 'full') return null;
  if (isFaceCulled(ctx, voxel, desc, x + basis.normal[0], y + basis.normal[1], z + basis.normal[2]))
    return null;
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
  const aoKey = `${shade.ao[0]}${shade.ao[1]}${shade.ao[2]}${shade.ao[3]}`;
  return {
    key: `${desc.layer}|${textureId}|${aoKey}|${shade.quantizedTint}|${shade.flip ? 1 : 0}`,
    layer: desc.layer,
    textureId,
    flip: shade.flip,
    colors: shade.colors,
  };
};

const buildSliceMask = (ctx: MeshCtx, dir: CubeFaceDirection, s: number, dims: SliceDims) => {
  const mask = new Array<MaskCell | null>(dims.uLen * dims.vLen).fill(null);
  let rawFaces = 0;
  for (let v = 0; v < dims.vLen; v += 1) {
    for (let u = 0; u < dims.uLen; u += 1) {
      const cell = makeMaskCell(ctx, dir, s, u, v, dims);
      if (cell) {
        rawFaces += 1;
        mask[v * dims.uLen + u] = cell;
      }
    }
  }
  return { mask, rawFaces };
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
): number => {
  const [w, _h, d] = ctx.grid.size;
  const normal = FACE_BASIS[dir].normal;
  let merged = 0;
  for (let v = 0; v < dims.vLen; v += 1) {
    for (let u = 0; u < dims.uLen; u += 1) {
      const cell = mask[v * dims.uLen + u];
      if (!cell) continue;
      const { mw, mh } = greedySpan(mask, dims.uLen, dims.vLen, u, v, cell.key);
      for (let dy = 0; dy < mh; dy += 1)
        for (let dx = 0; dx < mw; dx += 1) mask[(v + dy) * dims.uLen + u + dx] = null;
      const { from, to } = dims.bounds(s, u, v, mw, mh, w / 2, d / 2);
      const pu = (u & 1) * 0.5;
      const pv = (v & 1) * 0.5;
      const uvs: readonly [number, number, number, number, number, number, number, number] = [
        pu,
        pv + mh * 0.5,
        pu + mw * 0.5,
        pv + mh * 0.5,
        pu + mw * 0.5,
        pv,
        pu,
        pv,
      ];
      pushQuad(
        getBatch(ctx.batches, cell.layer, cell.textureId),
        faceCorners(dir, from, to),
        normal,
        uvs,
        cell.colors,
        cell.flip,
      );
      merged += 1;
    }
  }
  return merged;
};

const greedyMeshFullBlocks = (ctx: MeshCtx) => {
  const [w, _h, d] = ctx.grid.size;
  let rawFaces = 0;
  let mergedQuads = 0;
  for (const dir of DIRS6) {
    const dims = sliceDimsFor(dir, w, ctx.maxY, d);
    for (let s = 0; s < dims.sliceLen; s += 1) {
      const built = buildSliceMask(ctx, dir, s, dims);
      rawFaces += built.rawFaces;
      mergedQuads += emitMergedSliceQuads(ctx, dir, s, dims, built.mask);
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

const specBoxUv = (
  dir: CubeFaceDirection,
  spec: LocalBoxSpec,
  x: number,
  y: number,
  z: number,
): readonly [number, number, number, number, number, number, number, number] => {
  const pu = ((dir === 'east' || dir === 'west' ? z : x) & 1) * 0.5;
  const pv = ((dir === 'up' || dir === 'down' ? z : y) & 1) * 0.5;
  const uSpan =
    ((dir === 'east' || dir === 'west' ? spec.to[2] - spec.from[2] : spec.to[0] - spec.from[0]) /
      16) *
    0.5;
  const vSpan =
    ((dir === 'up' || dir === 'down' ? spec.to[2] - spec.from[2] : spec.to[1] - spec.from[1]) /
      16) *
    0.5;
  return [pu, pv + vSpan, pu + uSpan, pv + vSpan, pu + uSpan, pv, pu, pv];
};

const emitBoxSpecFaces = (
  ctx: MeshCtx,
  desc: BlockDescriptor,
  cached: CachedBlockState,
  spec: LocalBoxSpec,
  x: number,
  y: number,
  z: number,
): number => {
  const [w, _h, d] = ctx.grid.size;
  const from: Vec3 = [
    x + spec.from[0] / 16 - w / 2,
    y + spec.from[1] / 16,
    z + spec.from[2] / 16 - d / 2,
  ];
  const to: Vec3 = [x + spec.to[0] / 16 - w / 2, y + spec.to[1] / 16, z + spec.to[2] / 16 - d / 2];
  const layer: BlockRenderLayer = spec.emissive ? 'emissive' : desc.layer;
  for (const dir of DIRS6) {
    const texId = structureTileTextureId(
      layer,
      spec.tileOverride ?? tileForFace(desc, dir, cached.facing),
    );
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
    );
    pushQuad(
      getBatch(ctx.batches, layer, texId),
      faceCorners(dir, from, to),
      FACE_BASIS[dir].normal,
      specBoxUv(dir, spec, x, y, z),
      shade.colors,
      shade.flip,
    );
  }
  return 6;
};

const emitNonFullBlocks = (ctx: MeshCtx): number => {
  const [w, _h, d] = ctx.grid.size;
  let count = 0;
  for (let idx = 0; idx < ctx.maxY * d * w; idx += 1) {
    const v = ctx.grid.voxels[idx]!;
    if (v <= 0 || ctx.grid.customTags[idx] !== null) continue;
    const desc = ctx.descriptors[v]!;
    if (desc.shape === 'full') continue;
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    const conns = CARDINALS.map(([dx, dy, dz]) =>
      connectsNeighbor(ctx, x + dx, y + dy, z + dz, desc.shape),
    );
    const cached = ctx.parsedStates[v]!;
    for (const spec of shapeBoxSpecs(desc, cached.parsed, cached.facing, conns)) {
      count += emitBoxSpecFaces(ctx, desc, cached, spec, x, y, z);
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
    for (const t of [desc.top, desc.bottom, desc.side, desc.front])
      reqs.push({ layer: desc.layer, tileId: t });
    if (desc.shape === 'campfire')
      reqs.push(
        { layer: 'opaque', tileId: 'spruce_planks' },
        { layer: 'opaque', tileId: 'oak_planks' },
      );
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
  options?: { readonly cutawayY?: number },
): StructureBakedMesh => {
  const maxY = Math.min(grid.size[1], options?.cutawayY ?? grid.size[1]);
  const descriptors = grid.states.map(describeBlockState);
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
    .sort((a, b) =>
      a.layer !== b.layer ? (a.layer < b.layer ? -1 : 1) : a.textureId < b.textureId ? -1 : 1,
    );
  return {
    batches,
    textures,
    instances: collectPropInstances(grid, lighting, customModels, maxY),
    rawFaceCount: fullCounts.rawFaces + nonFullCount,
    mergedQuadCount: fullCounts.mergedQuads + nonFullCount,
  };
};
