import type { TextureAsset, TextureCanvasDetail, TextureRaster } from '../../model/texture';
import { canonicalPngDigest, encodeCanonicalPng } from '../../textures/textureRecipe/png';
import { rasterizeCanonicalTexture } from '../../textures/textureRecipe/raster';
import type { BlockRenderLayer } from './blocks';
import { paintTileRects } from './tiles';

export interface TileUvRef {
  readonly textureId: string;
  readonly u: number;
  readonly v: number;
}

export interface StructureAtlasBundle {
  readonly textures: Readonly<Record<string, TextureAsset>>;
  readonly uvs: ReadonlyMap<string, TileUvRef>;
}

const nextPow2 = (value: number): number => {
  let s = 16;
  while (s < value) s *= 2;
  return s;
};

const tileLayerKey = (layer: BlockRenderLayer, tileId: string): string => `${layer}:${tileId}`;

const collectLayerDetails = (
  layer: BlockRenderLayer,
  sorted: readonly string[],
  cols: number,
  textureId: string,
  uvs: Map<string, TileUvRef>,
): readonly TextureCanvasDetail[] => {
  const details: TextureCanvasDetail[] = [];
  let seq = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const tileId = sorted[i]!;
    const u = (i % cols) * 16;
    const v = Math.floor(i / cols) * 16;
    uvs.set(tileLayerKey(layer, tileId), { textureId, u, v });
    for (const r of paintTileRects(tileId)) {
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
  uvs: Map<string, TileUvRef>,
): TextureAsset => {
  const sorted = [...new Set(tileIds)].sort();
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const rows = Math.max(1, Math.ceil(sorted.length / cols));
  const width = nextPow2(cols * 16);
  const height = nextPow2(rows * 16);
  const textureId = `struct_${layer}`;
  const rasterSpec: TextureRaster = {
    background: '#000000',
    backgroundAlpha: layer === 'cutout' ? 0 : 255,
    canvasDetails: collectLayerDetails(layer, sorted, cols, textureId, uvs),
  };
  const encoded = encodeCanonicalPng(
    rasterizeCanonicalTexture(width, height, {
      background: rasterSpec.background,
      backgroundAlpha: rasterSpec.backgroundAlpha,
      canvasDetails: rasterSpec.canvasDetails,
      alphaMasks: [],
    }),
  );

  return {
    id: textureId,
    name: textureId,
    width,
    height,
    source: {
      bucket: 'structure',
      key: `${textureId}.png`,
      contentType: 'image/png',
      contentHash: canonicalPngDigest(encoded),
      byteLength: encoded.length,
    },
    visible: true,
    sampling: 'nearest',
    colorSpace: 'srgb',
    renderMode: layer === 'emissive' ? 'emissive' : 'default',
    renderSides: layer === 'cutout' ? 'double' : 'auto',
    atlasMode: 'preserve',
    raster: rasterSpec,
  };
};

export const buildStructureAtlases = (
  requests: readonly { readonly layer: BlockRenderLayer; readonly tileId: string }[],
): StructureAtlasBundle => {
  const byLayer: Record<BlockRenderLayer, string[]> = { opaque: [], cutout: [], emissive: [] };
  for (const req of requests) byLayer[req.layer].push(req.tileId);
  const textures: Record<string, TextureAsset> = {};
  const uvs = new Map<string, TileUvRef>();
  for (const layer of ['opaque', 'cutout', 'emissive'] as const) {
    if (byLayer[layer].length === 0) continue;
    const asset = buildLayerTexture(layer, byLayer[layer], uvs);
    textures[asset.id] = asset;
  }
  return { textures, uvs };
};
