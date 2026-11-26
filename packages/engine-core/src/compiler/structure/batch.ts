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

export const getBatch = (
  batches: Map<string, BatchDraft>,
  layer: BlockRenderLayer,
  tileId: string,
): BatchDraft => {
  const textureId = structureTileTextureId(layer, tileId);
  const key = `${layer}:${textureId}`;
  let batch = batches.get(key);
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
