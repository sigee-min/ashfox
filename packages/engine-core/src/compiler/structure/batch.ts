import type { CubeFaceDirection } from '../../model/scene';
import { structureTileTextureId } from './atlas';
import type { BlockDescriptor, BlockRenderLayer } from './blocks';
import type { StructureGrid, StructureLightingField } from './contract';
import { FACE_BASIS, FACE_CORNER_TABLE } from './lighting';
import type { CachedBlockState } from './shapes';

export interface BatchDraft {
  readonly layer: BlockRenderLayer;
  readonly tileId: string;
  readonly textureId: string;
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly colors: number[];
  readonly indices: number[];
}

export interface NonFullScratch {
  readonly from: [number, number, number];
  readonly to: [number, number, number];
  readonly uvs: number[];
  readonly colors: number[];
}

export interface MeshCtx {
  readonly grid: StructureGrid;
  readonly descriptors: readonly BlockDescriptor[];
  readonly parsedStates: readonly CachedBlockState[];
  readonly lighting: StructureLightingField;
  readonly maxY: number;
  readonly batches: Map<string, BatchDraft>;
}

const LAYER_BATCH_CACHE = new WeakMap<
  Map<string, BatchDraft>,
  Record<BlockRenderLayer, Map<string, BatchDraft>>
>();

const layerMapFor = (
  batches: Map<string, BatchDraft>,
  layer: BlockRenderLayer,
): Map<string, BatchDraft> => {
  let rec = LAYER_BATCH_CACHE.get(batches);
  if (!rec) {
    rec = { opaque: new Map(), cutout: new Map(), emissive: new Map() };
    LAYER_BATCH_CACHE.set(batches, rec);
  }
  return rec[layer];
};

export const getBatch = (
  batches: Map<string, BatchDraft>,
  layer: BlockRenderLayer,
  tileId: string,
): BatchDraft => {
  const byTile = layerMapFor(batches, layer);
  let batch = byTile.get(tileId);
  if (batch) return batch;
  const textureId = structureTileTextureId(layer, tileId);
  const key = `${layer}:${textureId}`;
  batch = batches.get(key);
  if (!batch) {
    batch = {
      layer,
      tileId,
      textureId,
      positions: [],
      normals: [],
      uvs: [],
      colors: [],
      indices: [],
    };
    batches.set(key, batch);
  }
  byTile.set(tileId, batch);
  return batch;
};

export const pushQuad = (
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
  const n = FACE_BASIS[dir].normal;
  const fx = from[0];
  const fy = from[1];
  const fz = from[2];
  const tx = to[0];
  const ty = to[1];
  const tz = to[2];
  const nx = n[0];
  const ny = n[1];
  const nz = n[2];
  batch.positions.push(
    t[0]! ? tx : fx,
    t[1]! ? ty : fy,
    t[2]! ? tz : fz,
    t[3]! ? tx : fx,
    t[4]! ? ty : fy,
    t[5]! ? tz : fz,
    t[6]! ? tx : fx,
    t[7]! ? ty : fy,
    t[8]! ? tz : fz,
    t[9]! ? tx : fx,
    t[10]! ? ty : fy,
    t[11]! ? tz : fz,
  );
  batch.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
  batch.uvs.push(uvs[0]!, uvs[1]!, uvs[2]!, uvs[3]!, uvs[4]!, uvs[5]!, uvs[6]!, uvs[7]!);
  batch.colors.push(
    colors[0]!,
    colors[1]!,
    colors[2]!,
    colors[3]!,
    colors[4]!,
    colors[5]!,
    colors[6]!,
    colors[7]!,
    colors[8]!,
    colors[9]!,
    colors[10]!,
    colors[11]!,
  );
  if (flip) batch.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
  else batch.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
};
