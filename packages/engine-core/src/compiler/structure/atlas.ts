import { compareText } from '@ashfox/internal-contracts';
import { deepFreeze } from '../../immutable';
import type {
  TextureAsset,
  TextureCanvasDetail,
  TexturePbrMaterial,
  TextureRaster,
} from '../../model/texture';
import type { StructureDensity } from '../../project/structure/contract';
import { encodeCanonicalPngSummary } from '../../textures/textureRecipe/png';
import { rasterizeTextureSpec } from '../../textures/textureRecipe/raster';
import type { BlockRenderLayer } from './blocks';
import type { StructureBakedBatch, StructureGrid } from './contract';
import { appendDemotedFullBatch, countMultiQuadSavings } from './atlasDemote';
import { synthesizeStructureAtlasPbr, type PackedTilePbrRegion } from './tilePbr';
import { isSeedInvariantTile, paintTileRects, type TileRect } from './tiles';

export type AtlasBatchLayer = StructureBakedBatch['layer'];

export interface AtlasBatchDraft {
  readonly layer: AtlasBatchLayer;
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

export const tileLayerKey = (layer: AtlasBatchLayer, tileId: string): string =>
  `${layer}:${tileId}`;

export const structureTileTextureId = (layer: AtlasBatchLayer, tileId: string): string =>
  layer === 'sun_shaft' ? `struct_${tileId}` : `struct_${layer}_${tileId}`;

export const structureAtlasTextureId = (layer: BlockRenderLayer): string => `struct_atlas_${layer}`;

const renderModeForLayer = (layer: AtlasBatchLayer): TextureAsset['renderMode'] => {
  if (layer === 'emissive') return 'emissive';
  if (layer === 'sun_shaft') return 'additive';
  if (layer === 'translucent') return 'layered';
  return 'default';
};

const renderSidesForLayer = (layer: AtlasBatchLayer): TextureAsset['renderSides'] =>
  layer === 'cutout' || layer === 'translucent' || layer === 'sun_shaft' ? 'double' : 'auto';

const makeTextureAsset = (
  id: string,
  width: number,
  height: number,
  layer: AtlasBatchLayer,
  rasterSpec: TextureRaster,
  pbr?: TexturePbrMaterial,
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
    renderMode: renderModeForLayer(layer),
    renderSides: renderSidesForLayer(layer),
    atlasMode: 'preserve',
    ...(pbr ? { pbr } : {}),
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

const TILE_TEX_CACHE = new Map<string, TextureAsset>();
const PACKED_ATLAS_CACHE = new Map<
  string,
  { readonly asset: TextureAsset; readonly rects: readonly (readonly [string, AtlasSubRect])[] }
>();

const cloneTex = (asset: TextureAsset): TextureAsset => ({ ...asset, source: { ...asset.source } });

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
  const cacheKey = `${layer}|${density}|${seed}|${sorted.join(',')}`;
  const cached = PACKED_ATLAS_CACHE.get(cacheKey);
  if (cached) {
    for (const [k, v] of cached.rects) rects.set(k, v);
    return cloneTex(cached.asset);
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const rows = Math.max(1, Math.ceil(sorted.length / cols));
  const width = nextPow2(cols * slotPx, tilePx);
  const height = nextPow2(rows * slotPx, tilePx);
  const textureId = structureAtlasTextureId(layer);
  const details: TextureCanvasDetail[] = [];
  const layerRects: [string, AtlasSubRect][] = [];
  const pbrRegions: PackedTilePbrRegion[] = [];
  let seq = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const tileId = sorted[i]!;
    const px0 = (i % cols) * slotPx + 1;
    const py0 = Math.floor(i / cols) * slotPx + 1;
    const rectKey = tileLayerKey(layer, tileId);
    const subRect: AtlasSubRect = {
      textureId,
      u0: px0 / width,
      v0: py0 / height,
      uSpan: tilePx / width,
      vSpan: tilePx / height,
    };
    rects.set(rectKey, subRect);
    layerRects.push([rectKey, subRect]);
    pbrRegions.push({ tileId, x: px0, y: py0, size: tilePx });
    for (const r of paintTileRects(tileId, density, seed, 0)) {
      pushExtrudedRect(details, textureId, seq++, px0, py0, tilePx, r);
    }
  }
  const pbr = synthesizeStructureAtlasPbr(width, height, pbrRegions);
  const raster = {
    background: '#000000',
    backgroundAlpha: (layer === 'cutout' ? 0 : 255) as 0 | 255,
    canvasDetails: details,
  };
  const asset = makeTextureAsset(textureId, width, height, layer, raster, pbr);
  if (PACKED_ATLAS_CACHE.size < 64) PACKED_ATLAS_CACHE.set(cacheKey, { asset, rects: layerRects });
  return cloneTex(asset);
};

/** Packs non-repeating 0..1 structure tiles into up to 3 padded layer atlases. */
export const buildPackedStructureAtlases = (
  requests: readonly { readonly layer: BlockRenderLayer; readonly tileId: string }[],
  density: StructureDensity = 1,
  seed = 1,
): PackedStructureAtlasBundle => {
  const byLayer: Record<BlockRenderLayer, string[]> = { opaque: [], cutout: [], emissive: [] };
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
  layer: AtlasBatchLayer,
  tileId: string,
  density: StructureDensity,
  seed: number,
): TextureAsset => {
  const cacheKey = `${layer}|${tileId}|${density}|${seed}`;
  const cached = TILE_TEX_CACHE.get(cacheKey);
  if (cached) return cloneTex(cached);
  const tilePx = density === 2 ? 32 : 16;
  const size = tilePx * 2;
  const textureId = structureTileTextureId(layer, tileId);
  const details: TextureCanvasDetail[] = [];
  let seq = 0;
  for (let variant = 0; variant < 4; variant += 1) {
    const [ox, oy] = [(variant & 1) * tilePx, (variant >> 1) * tilePx];
    for (const r of paintTileRects(tileId, density, seed, variant)) {
      details.push({
        id: `${textureId}_d${seq++}`,
        color: r.color,
        alpha: r.alpha,
        x: ox + r.x,
        y: oy + r.y,
        width: r.w,
        height: r.h,
      });
    }
  }
  const pbr = synthesizeStructureAtlasPbr(size, size, [{ tileId, x: 0, y: 0, size }]);
  const raster = {
    background: '#000000',
    backgroundAlpha: (layer === 'cutout' ? 0 : 255) as 0 | 255,
    canvasDetails: details,
  };
  const asset = makeTextureAsset(textureId, size, size, layer, raster, pbr);
  if (TILE_TEX_CACHE.size < 256) TILE_TEX_CACHE.set(cacheKey, asset);
  return cloneTex(asset);
};

let activeTileTextureCache: Map<string, TextureAsset> | null = null;

/** Scopes a shared tile texture cache across structure entries in one workspace compile. */
export const withStructureTileTextureCache = <T>(
  cache: Map<string, TextureAsset>,
  fn: () => T,
): T => {
  const prev = activeTileTextureCache;
  activeTileTextureCache = cache;
  try {
    return fn();
  } finally {
    activeTileTextureCache = prev;
  }
};

export const buildStructureTileTextures = (
  requests: readonly {
    readonly layer: AtlasBatchLayer;
    readonly tileId: string;
  }[],
  density: StructureDensity,
  seed: number,
  cache: Map<string, TextureAsset> | undefined = activeTileTextureCache ?? undefined,
): Readonly<Record<string, TextureAsset>> => {
  const unique = new Map<string, { readonly layer: AtlasBatchLayer; readonly tileId: string }>();
  for (const req of requests) {
    const id = structureTileTextureId(req.layer, req.tileId);
    if (!unique.has(id)) unique.set(id, req);
  }
  const textures: Record<string, TextureAsset> = {};
  for (const [id, req] of [...unique.entries()].sort(([a], [b]) => compareText(a, b))) {
    const cacheSeed = isSeedInvariantTile(req.tileId) ? 0 : seed;
    const key = `${id}\u0000${density}\u0000${cacheSeed}`;
    let asset = cache?.get(key);
    if (!asset) {
      asset = deepFreeze(buildMultiTileTexture(req.layer, req.tileId, density, seed));
      cache?.set(key, asset);
    }
    textures[id] = asset;
  }
  return textures;
};

const MAX_REPEATING_BATCHES = 9;
const MIN_REPEATING_QUAD_SAVINGS = 12;

const appendNumbers = (dst: number[], src: readonly number[]): void => {
  const off = dst.length;
  const len = src.length;
  dst.length = off + len;
  for (let i = 0; i < len; i += 1) dst[off + i] = src[i]!;
};

const appendBatch = (dst: AtlasBatchDraft, src: AtlasBatchDraft, rect?: AtlasSubRect): void => {
  const base = dst.positions.length / 3;
  appendNumbers(dst.positions, src.positions);
  appendNumbers(dst.normals, src.normals);
  appendNumbers(dst.colors, src.colors);
  if (rect) {
    const off = dst.uvs.length;
    dst.uvs.length = off + src.uvs.length;
    for (let i = 0; i < src.uvs.length; i += 2) {
      dst.uvs[off + i] = rect.u0 + src.uvs[i]! * rect.uSpan;
      dst.uvs[off + i + 1] = rect.v0 + src.uvs[i + 1]! * rect.vSpan;
    }
  } else appendNumbers(dst.uvs, src.uvs);
  const idxOff = dst.indices.length;
  dst.indices.length = idxOff + src.indices.length;
  for (let i = 0; i < src.indices.length; i += 1) dst.indices[idxOff + i] = base + src.indices[i]!;
};

const makeDraft = (
  layer: AtlasBatchLayer,
  tileId: string,
  textureId = tileId,
): AtlasBatchDraft => ({
  layer,
  tileId,
  textureId,
  positions: [],
  normals: [],
  uvs: [],
  colors: [],
  indices: [],
});

const selectRepeatingBatchKeys = (
  fullBatches: Map<string, AtlasBatchDraft>,
  repeatingKeys: Set<string>,
): ReadonlySet<string> => {
  const ranked: { readonly key: string; readonly saved: number; readonly id: string }[] = [];
  for (const key of repeatingKeys) {
    const b = fullBatches.get(key);
    if (!b || b.indices.length === 0) continue;
    const saved = countMultiQuadSavings(b);
    if (saved >= MIN_REPEATING_QUAD_SAVINGS) ranked.push({ key, saved, id: b.textureId });
  }
  ranked.sort((a, b) => b.saved - a.saved || compareText(a.id, b.id));
  const selected = new Set<string>();
  for (let i = 0; i < Math.min(MAX_REPEATING_BATCHES, ranked.length); i += 1) {
    selected.add(ranked[i]!.key);
  }
  return selected;
};

const partitionBatches = (
  nonRepeatingBatches: Map<string, AtlasBatchDraft>,
  repeatingReqs: { readonly layer: AtlasBatchLayer; readonly tileId: string }[],
) => {
  const activeSpecial: AtlasBatchDraft[] = [];
  const activeNonRep: AtlasBatchDraft[] = [];
  for (const b of nonRepeatingBatches.values()) {
    if (b.indices.length === 0) continue;
    if (b.layer === 'translucent' || b.layer === 'sun_shaft') {
      activeSpecial.push(b);
      repeatingReqs.push({ layer: b.layer, tileId: b.tileId });
    } else activeNonRep.push(b);
  }
  activeNonRep.sort((a, b) => compareText(a.layer, b.layer) || compareText(a.tileId, b.tileId));
  return { activeSpecial, activeNonRep };
};

const demoteNonPromotedBatches = (
  fullBatches: Map<string, AtlasBatchDraft>,
  promotedKeys: ReadonlySet<string>,
  nonRepeatingBatches: Map<string, AtlasBatchDraft>,
  repeatingBatches: AtlasBatchDraft[],
  repeatingReqs: { readonly layer: AtlasBatchLayer; readonly tileId: string }[],
): void => {
  for (const [key, b] of fullBatches) {
    if (b.indices.length === 0) continue;
    if (promotedKeys.has(key)) {
      repeatingBatches.push(b);
      repeatingReqs.push({ layer: b.layer, tileId: b.tileId });
      continue;
    }
    const nrKey = `${b.layer}:${b.textureId}`;
    const existing = nonRepeatingBatches.get(nrKey) ?? makeDraft(b.layer, b.tileId, b.textureId);
    nonRepeatingBatches.set(nrKey, existing);
    appendDemotedFullBatch(existing, b);
  }
};

const buildAtlasBatches = (
  activeNonRep: readonly AtlasBatchDraft[],
  grid: StructureGrid,
  repeatingReqs: { readonly layer: AtlasBatchLayer; readonly tileId: string }[],
) => {
  const atlas = buildPackedStructureAtlases(
    activeNonRep.map((b) => ({ layer: b.layer as BlockRenderLayer, tileId: b.tileId })),
    grid.density,
    grid.seed,
  );
  const atlasByLayer = new Map<BlockRenderLayer, AtlasBatchDraft>();
  for (const src of activeNonRep) {
    const bl = src.layer as BlockRenderLayer;
    const rect = atlas.rects.get(tileLayerKey(bl, src.tileId))!;
    const dst = atlasByLayer.get(bl) ?? makeDraft(bl, structureAtlasTextureId(bl));
    atlasByLayer.set(bl, dst);
    appendBatch(dst, src, rect);
  }
  const tileTextures = buildStructureTileTextures(repeatingReqs, grid.density, grid.seed);
  return {
    atlasBatches: [...atlasByLayer.values()],
    textures: { ...atlas.textures, ...tileTextures },
  };
};

/** Packs non-repeating batches into layer atlases while preserving top repeating tile batches. */
export const packStructureBatches = (
  fullBatches: Map<string, AtlasBatchDraft>,
  repeatingKeys: Set<string>,
  nonRepeatingBatches: Map<string, AtlasBatchDraft>,
  grid: StructureGrid,
): {
  readonly batches: readonly StructureBakedBatch[];
  readonly textures: Readonly<Record<string, TextureAsset>>;
} => {
  const promotedKeys = selectRepeatingBatchKeys(fullBatches, repeatingKeys);
  const repeatingBatches: AtlasBatchDraft[] = [];
  const repeatingReqs: { readonly layer: AtlasBatchLayer; readonly tileId: string }[] = [];
  demoteNonPromotedBatches(
    fullBatches,
    promotedKeys,
    nonRepeatingBatches,
    repeatingBatches,
    repeatingReqs,
  );
  const { activeSpecial, activeNonRep } = partitionBatches(nonRepeatingBatches, repeatingReqs);
  const { atlasBatches, textures } = buildAtlasBatches(activeNonRep, grid, repeatingReqs);
  const batches = [...atlasBatches, ...repeatingBatches, ...activeSpecial].sort(
    (a, b) => compareText(a.layer, b.layer) || compareText(a.textureId, b.textureId),
  );
  return { batches, textures };
};
