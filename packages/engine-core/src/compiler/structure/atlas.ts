import { compareText } from '@ashfox/internal-contracts';
import { deepFreeze } from '../../immutable';
import type { TextureAsset, TextureCanvasDetail, TextureRaster } from '../../model/texture';
import type { StructureDensity } from '../../project/structure/contract';
import { encodeCanonicalPngSummary } from '../../textures/textureRecipe/png';
import { rasterizeTextureSpec } from '../../textures/textureRecipe/raster';
import type { BlockRenderLayer } from './blocks';
import { paintTileRects } from './tiles';

export interface TileUvRef {
  readonly textureId: string;
  readonly u: number;
  readonly v: number;
  readonly size: number;
}

export interface StructureAtlasBundle {
  readonly textures: Readonly<Record<string, TextureAsset>>;
  readonly uvs: ReadonlyMap<string, TileUvRef>;
  readonly tilePx: number;
}

const nextPow2 = (value: number, minSize = 16): number => {
  let s = minSize;
  while (s < value) s *= 2;
  return s;
};

const tileLayerKey = (layer: BlockRenderLayer, tileId: string): string => `${layer}:${tileId}`;

export const structureTileTextureId = (layer: BlockRenderLayer, tileId: string): string =>
  `struct_${layer}_${tileId}`;

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

const collectLayerDetails = (
  layer: BlockRenderLayer,
  sorted: readonly string[],
  cols: number,
  tilePx: number,
  textureId: string,
  density: StructureDensity,
  seed: number,
  uvs: Map<string, TileUvRef>,
): readonly TextureCanvasDetail[] => {
  const details: TextureCanvasDetail[] = [];
  let seq = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const tileId = sorted[i]!;
    const u = (i % cols) * tilePx;
    const v = Math.floor(i / cols) * tilePx;
    uvs.set(tileLayerKey(layer, tileId), { textureId, u, v, size: tilePx });
    for (const r of paintTileRects(tileId, density, seed, i & 3)) {
      details.push({
        id: `${textureId}_d${seq++}`,
        color: r.color,
        alpha: r.alpha,
        x: u + r.x,
        y: v + r.y,
        width: r.w,
        height: r.h,
      });
    }
  }
  return details;
};

const buildLayerTexture = (
  layer: BlockRenderLayer,
  tileIds: readonly string[],
  density: StructureDensity,
  seed: number,
  uvs: Map<string, TileUvRef>,
): TextureAsset => {
  const tilePx = density === 2 ? 32 : 16;
  const sorted = [...new Set(tileIds)].sort(compareText);
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const rows = Math.max(1, Math.ceil(sorted.length / cols));
  const width = nextPow2(cols * tilePx, tilePx);
  const height = nextPow2(rows * tilePx, tilePx);
  const textureId = `struct_${layer}`;
  const rasterSpec: TextureRaster = {
    background: '#000000',
    backgroundAlpha: layer === 'cutout' ? 0 : 255,
    canvasDetails: collectLayerDetails(layer, sorted, cols, tilePx, textureId, density, seed, uvs),
  };
  return makeTextureAsset(textureId, width, height, layer, rasterSpec);
};

export const buildStructureAtlases = (
  requests: readonly {
    readonly layer: BlockRenderLayer;
    readonly tileId: string;
  }[],
  density: StructureDensity = 1,
  seed = 1,
): StructureAtlasBundle => {
  const tilePx = density === 2 ? 32 : 16;
  const byLayer: Record<BlockRenderLayer, string[]> = {
    opaque: [],
    cutout: [],
    emissive: [],
  };
  for (const req of requests) byLayer[req.layer].push(req.tileId);
  const textures: Record<string, TextureAsset> = {};
  const uvs = new Map<string, TileUvRef>();
  for (const layer of ['opaque', 'cutout', 'emissive'] as const) {
    if (byLayer[layer].length === 0) continue;
    const asset = buildLayerTexture(layer, byLayer[layer], density, seed, uvs);
    textures[asset.id] = asset;
  }
  return { textures, uvs, tilePx };
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
