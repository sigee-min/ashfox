import type { CompiledModel } from '../../model/compiled';
import type { CubeFaceDirection } from '../../model/scene';
import type { CardinalFacing } from '../../project/structure/contract';
import { structureTileTextureId } from './atlas';
import type { BlockDescriptor } from './blocks';
import type {
  StructureBakedBatch,
  StructureGrid,
  StructureLightingField,
  StructurePropInstance,
} from './contract';
import { FACE_BASIS, FACE_CORNER_TABLE, samplePropLightRgb } from './lighting';
import type { CachedBlockState } from './shapes';

export type BakedBatchLayer = StructureBakedBatch['layer'];

export interface BatchDraft {
  readonly layer: BakedBatchLayer;
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

export const writeSpecBoxBounds = (
  from: [number, number, number],
  to: [number, number, number],
  pos: readonly [number, number, number],
  spec: {
    readonly from: readonly [number, number, number];
    readonly to: readonly [number, number, number];
  },
  hw: number,
  hd: number,
): void => {
  from[0] = pos[0] + spec.from[0] / 16 - hw;
  from[1] = pos[1] + spec.from[1] / 16;
  from[2] = pos[2] + spec.from[2] / 16 - hd;
  to[0] = pos[0] + spec.to[0] / 16 - hw;
  to[1] = pos[1] + spec.to[1] / 16;
  to[2] = pos[2] + spec.to[2] / 16 - hd;
};

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
  Record<BakedBatchLayer, Map<string, BatchDraft>>
>();

const layerMapFor = (
  batches: Map<string, BatchDraft>,
  layer: BakedBatchLayer,
): Map<string, BatchDraft> => {
  let rec = LAYER_BATCH_CACHE.get(batches);
  if (!rec) {
    rec = {
      opaque: new Map(),
      cutout: new Map(),
      emissive: new Map(),
      translucent: new Map(),
      sun_shaft: new Map(),
    };
    LAYER_BATCH_CACHE.set(batches, rec);
  }
  return rec[layer];
};

export const getBatch = (
  batches: Map<string, BatchDraft>,
  layer: BakedBatchLayer,
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

export interface SliceDims {
  readonly axis: 0 | 1 | 2;
  readonly sliceLen: number;
  readonly uLen: number;
  readonly vLen: number;
}

export const sliceDimsFor = (
  dir: CubeFaceDirection,
  w: number,
  maxY: number,
  d: number,
): SliceDims =>
  dir === 'north' || dir === 'south'
    ? { axis: 2, sliceLen: d, uLen: w, vLen: maxY }
    : dir === 'east' || dir === 'west'
      ? { axis: 0, sliceLen: w, uLen: d, vLen: maxY }
      : { axis: 1, sliceLen: maxY, uLen: w, vLen: d };

export const collectPropInstances = (
  grid: StructureGrid,
  lighting: StructureLightingField,
  customModels: Readonly<Record<string, CompiledModel>>,
  maxY: number,
): readonly StructurePropInstance[] => {
  const [w, _h, d] = grid.size;
  const rotY = (f: CardinalFacing): 0 | 90 | 180 | 270 =>
    f === 'east' ? 270 : f === 'south' ? 180 : f === 'west' ? 90 : 0;
  return grid.customPlacements
    .filter((cp) => cp.y < maxY && Boolean(customModels[cp.assetAlias]))
    .map((cp) => ({
      assetKey: cp.assetAlias,
      translation: [cp.x - w / 2 + 0.5, cp.y, cp.z - d / 2 + 0.5] as const,
      rotation: rotY(cp.facing),
      lightRgb: samplePropLightRgb(lighting, cp.x, cp.y, cp.z),
    }));
};
