import { compareText } from '@ashfox/internal-contracts';
import { deepFreeze } from '../../immutable';
import type { TextureAsset, TextureCanvasDetail, TextureRaster } from '../../model/texture';
import type { StructureDensity } from '../../project/structure/contract';
import { encodeCanonicalPngSummary } from '../../textures/textureRecipe/png';
import { rasterizeTextureSpec } from '../../textures/textureRecipe/raster';
import type { BlockRenderLayer } from './blocks';
import type { StructureBakedBatch, StructureGrid } from './contract';
import { paintTileRects, type TileRect } from './tiles';

export interface AtlasBatchDraft {
  readonly layer: BlockRenderLayer;
  readonly tileId: string;
  readonly textureId: string;
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly colors: number[];
  readonly indices: number[];
}

export interface AtlasSubRect {
  readonly textureId: string;
  readonly u0: number;
  readonly v0: number;
  readonly uSpan: number;
  readonly vSpan: number;
}

export interface PackedStructureAtlasBundle {
  readonly textures: Readonly<Record<string, TextureAsset>>;
  readonly rects: ReadonlyMap<string, AtlasSubRect>;
}

const nextPow2 = (value: number, minSize = 16): number => {
  let s = minSize;
  while (s < value) s *= 2;
  return s;
};

export const tileLayerKey = (layer: BlockRenderLayer, tileId: string): string =>
  `${layer}:${tileId}`;

export const structureTileTextureId = (layer: BlockRenderLayer, tileId: string): string =>
  `struct_${layer}_${tileId}`;

export const structureAtlasTextureId = (layer: BlockRenderLayer): string => `struct_atlas_${layer}`;

const makeTextureAsset = (
  id: string,
  width: number,
  height: number,
  layer: BlockRenderLayer,
  rasterSpec: TextureRaster,
): TextureAsset => {
  const frozenRaster = deepFreeze(rasterSpec);
  const summary = encodeCanonicalPngSummary(rasterizeTextureSpec(width, height, frozenRaster));
  return {
    id,
    name: id,
    width,
    height,
    source: {
      bucket: 'structure',
      key: `${id}.png`,
      contentType: 'image/png',
      contentHash: summary.contentHash,
      byteLength: summary.byteLength,
    },
    visible: true,
    sampling: 'nearest',
    colorSpace: 'srgb',
    renderMode: layer === 'emissive' ? 'emissive' : 'default',
    renderSides: layer === 'cutout' ? 'double' : 'auto',
    atlasMode: 'preserve',
    raster: frozenRaster,
  };
};

const pushExtrudedRect = (
  details: TextureCanvasDetail[],
  textureId: string,
  seq: number,
  px0: number,
  py0: number,
  tilePx: number,
  rect: TileRect,
): void => {
  const ex0 = rect.x === 0 ? -1 : rect.x;
  const ey0 = rect.y === 0 ? -1 : rect.y;
  const ex1 = rect.x + rect.w === tilePx ? tilePx + 1 : rect.x + rect.w;
  const ey1 = rect.y + rect.h === tilePx ? tilePx + 1 : rect.y + rect.h;
  details.push({
    id: `${textureId}_d${seq}`,
    color: rect.color,
    alpha: rect.alpha,
    x: px0 + ex0,
    y: py0 + ey0,
    width: ex1 - ex0,
    height: ey1 - ey0,
  });
};

const buildPackedLayerAtlas = (
  layer: BlockRenderLayer,
  tileIds: readonly string[],
  density: StructureDensity,
  seed: number,
  rects: Map<string, AtlasSubRect>,
): TextureAsset => {
  const tilePx = density === 2 ? 32 : 16;
  const slotPx = tilePx + 2;
  const sorted = [...new Set(tileIds)].sort(compareText);
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const rows = Math.max(1, Math.ceil(sorted.length / cols));
  const width = nextPow2(cols * slotPx, tilePx);
  const height = nextPow2(rows * slotPx, tilePx);
  const textureId = structureAtlasTextureId(layer);
  const details: TextureCanvasDetail[] = [];
  let seq = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const tileId = sorted[i]!;
    const px0 = (i % cols) * slotPx + 1;
    const py0 = Math.floor(i / cols) * slotPx + 1;
    rects.set(tileLayerKey(layer, tileId), {
      textureId,
      u0: px0 / width,
      v0: py0 / height,
      uSpan: tilePx / width,
      vSpan: tilePx / height,
    });
    for (const r of paintTileRects(tileId, density, seed, 0)) {
      pushExtrudedRect(details, textureId, seq++, px0, py0, tilePx, r);
    }
  }
  return makeTextureAsset(textureId, width, height, layer, {
    background: '#000000',
    backgroundAlpha: layer === 'cutout' ? 0 : 255,
    canvasDetails: details,
  });
};

/** Packs non-repeating 0..1 structure tiles into up to 3 padded layer atlases. */
export const buildPackedStructureAtlases = (
  requests: readonly {
    readonly layer: BlockRenderLayer;
    readonly tileId: string;
  }[],
  density: StructureDensity = 1,
  seed = 1,
): PackedStructureAtlasBundle => {
  const byLayer: Record<BlockRenderLayer, string[]> = {
    opaque: [],
    cutout: [],
    emissive: [],
  };
  for (const req of requests) byLayer[req.layer].push(req.tileId);
  const textures: Record<string, TextureAsset> = {};
  const rects = new Map<string, AtlasSubRect>();
  for (const layer of ['opaque', 'cutout', 'emissive'] as const) {
    if (byLayer[layer].length === 0) continue;
    const asset = buildPackedLayerAtlas(layer, byLayer[layer], density, seed, rects);
    textures[asset.id] = asset;
  }
  return { textures, rects };
};

const buildMultiTileTexture = (
  layer: BlockRenderLayer,
  tileId: string,
  density: StructureDensity,
  seed: number,
): TextureAsset => {
  const tilePx = density === 2 ? 32 : 16;
  const size = tilePx * 2;
  const textureId = structureTileTextureId(layer, tileId);
  const details: TextureCanvasDetail[] = [];
  let seq = 0;
  for (let variant = 0; variant < 4; variant += 1) {
    const ox = (variant & 1) * tilePx;
    const oy = (variant >> 1) * tilePx;
    for (const rect of paintTileRects(tileId, density, seed, variant)) {
      details.push({
        id: `${textureId}_d${seq++}`,
        color: rect.color,
        alpha: rect.alpha,
        x: ox + rect.x,
        y: oy + rect.y,
        width: rect.w,
        height: rect.h,
      });
    }
  }
  return makeTextureAsset(textureId, size, size, layer, {
    background: '#000000',
    backgroundAlpha: layer === 'cutout' ? 0 : 255,
    canvasDetails: details,
  });
};

export const buildStructureTileTextures = (
  requests: readonly {
    readonly layer: BlockRenderLayer;
    readonly tileId: string;
  }[],
  density: StructureDensity,
  seed: number,
): Readonly<Record<string, TextureAsset>> => {
  const unique = new Map<string, { readonly layer: BlockRenderLayer; readonly tileId: string }>();
  for (const req of requests) {
    const id = structureTileTextureId(req.layer, req.tileId);
    if (!unique.has(id)) unique.set(id, req);
  }
  const textures: Record<string, TextureAsset> = {};
  for (const [id, req] of [...unique.entries()].sort(([a], [b]) => compareText(a, b))) {
    textures[id] = buildMultiTileTexture(req.layer, req.tileId, density, seed);
  }
  return textures;
};

const normalizeSingleTileUvs = (uvs: number[]): void => {
  for (let i = 0; i < uvs.length; i += 8) {
    const uMin = Math.min(uvs[i]!, uvs[i + 2]!, uvs[i + 4]!, uvs[i + 6]!);
    const vMin = Math.min(uvs[i + 1]!, uvs[i + 3]!, uvs[i + 5]!, uvs[i + 7]!);
    for (let j = 0; j < 8; j += 2) {
      uvs[i + j] = (uvs[i + j]! - uMin) * 2;
      uvs[i + j + 1] = (uvs[i + j + 1]! - vMin) * 2;
    }
  }
};

const appendNumbers = (dst: number[], src: readonly number[]): void => {
  for (let i = 0; i < src.length; i += 1) dst.push(src[i]!);
};

const appendBatch = (dst: AtlasBatchDraft, src: AtlasBatchDraft, rect?: AtlasSubRect): void => {
  const base = dst.positions.length / 3;
  appendNumbers(dst.positions, src.positions);
  appendNumbers(dst.normals, src.normals);
  appendNumbers(dst.colors, src.colors);
  if (rect) {
    for (let i = 0; i < src.uvs.length; i += 2) {
      dst.uvs.push(rect.u0 + src.uvs[i]! * rect.uSpan, rect.v0 + src.uvs[i + 1]! * rect.vSpan);
    }
  } else {
    appendNumbers(dst.uvs, src.uvs);
  }
  for (let i = 0; i < src.indices.length; i += 1) dst.indices.push(base + src.indices[i]!);
};

const makeAtlasBatchDraft = (layer: BlockRenderLayer): AtlasBatchDraft => ({
  layer,
  tileId: structureAtlasTextureId(layer),
  textureId: structureAtlasTextureId(layer),
  positions: [],
  normals: [],
  uvs: [],
  colors: [],
  indices: [],
});

/** Packs non-repeating batches into layer atlases while preserving repeating tile batches. */
export const packStructureBatches = (
  fullBatches: Map<string, AtlasBatchDraft>,
  repeatingKeys: Set<string>,
  nonRepeatingBatches: Map<string, AtlasBatchDraft>,
  grid: StructureGrid,
): {
  readonly batches: readonly StructureBakedBatch[];
  readonly textures: Readonly<Record<string, TextureAsset>>;
} => {
  const repeatingBatches: AtlasBatchDraft[] = [];
  const repeatingReqs: { readonly layer: BlockRenderLayer; readonly tileId: string }[] = [];
  for (const [key, b] of fullBatches) {
    if (b.indices.length === 0) continue;
    if (repeatingKeys.has(key)) {
      repeatingBatches.push(b);
      repeatingReqs.push({ layer: b.layer, tileId: b.tileId });
      continue;
    }
    normalizeSingleTileUvs(b.uvs);
    const nrKey = `${b.layer}:${b.textureId}`;
    const existing = nonRepeatingBatches.get(nrKey);
    if (existing) appendBatch(existing, b);
    else nonRepeatingBatches.set(nrKey, b);
  }
  const activeNonRep = [...nonRepeatingBatches.values()]
    .filter((b) => b.indices.length > 0)
    .sort((a, b) => compareText(a.layer, b.layer) || compareText(a.tileId, b.tileId));
  const atlas = buildPackedStructureAtlases(
    activeNonRep.map((b) => ({ layer: b.layer, tileId: b.tileId })),
    grid.density,
    grid.seed,
  );
  const atlasByLayer = new Map<BlockRenderLayer, AtlasBatchDraft>();
  for (const src of activeNonRep) {
    const rect = atlas.rects.get(tileLayerKey(src.layer, src.tileId))!;
    let dst = atlasByLayer.get(src.layer);
    if (!dst) {
      dst = makeAtlasBatchDraft(src.layer);
      atlasByLayer.set(src.layer, dst);
    }
    appendBatch(dst, src, rect);
  }
  const tileTextures = buildStructureTileTextures(repeatingReqs, grid.density, grid.seed);
  const batches = [...atlasByLayer.values(), ...repeatingBatches].sort(
    (a, b) => compareText(a.layer, b.layer) || compareText(a.textureId, b.textureId),
  );
  return { batches, textures: { ...atlas.textures, ...tileTextures } };
};
