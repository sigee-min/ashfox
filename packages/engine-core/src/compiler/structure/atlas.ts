import { compareText } from '@ashfox/internal-contracts';
import { deepFreeze } from '../../immutable';
import type { CompiledModel } from '../../model/compiled';
import type { CubeFaceDirection } from '../../model/scene';
import type { CardinalFacing } from '../../project/structure/contract';
import type { TextureAsset, TextureCanvasDetail, TextureRaster } from '../../model/texture';
import type { StructureDensity } from '../../project/structure/contract';
import { encodeCanonicalPngSummary } from '../../textures/textureRecipe/png';
import { rasterizeTextureSpec } from '../../textures/textureRecipe/raster';
import type { BlockRenderLayer } from './blocks';
import type {
  StructureBakedBatch,
  StructureGrid,
  StructureLightingField,
  StructurePropInstance,
} from './contract';
import { samplePropLightRgb } from './lighting';
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

const MAX_REPEATING_BATCHES = 9;
const MIN_REPEATING_QUAD_SAVINGS = 12;

const countMultiQuadSavings = (b: AtlasBatchDraft): number => {
  let saved = 0;
  for (let i = 0; i < b.uvs.length; i += 8) {
    const mw = Math.max(1, Math.round(Math.abs(b.uvs[i + 2]! - b.uvs[i]!) * 2));
    const mh = Math.max(1, Math.round(Math.abs(b.uvs[i + 1]! - b.uvs[i + 5]!) * 2));
    saved += mw * mh - 1;
  }
  return saved;
};

const lerp3 = (a: number, b: number, c: number, d: number, s: number, t: number): number =>
  (a * (1 - s) + b * s) * t + (d * (1 - s) + c * s) * (1 - t);

const pushSubdividedGrid = (
  dst: AtlasBatchDraft,
  src: AtlasBatchDraft,
  vBase: number,
  idxStart: number,
  mw: number,
  mh: number,
): void => {
  const flipped = src.indices[idxStart]! !== vBase;
  const p = src.positions;
  const c = src.colors;
  const nx = src.normals[vBase * 3]!;
  const ny = src.normals[vBase * 3 + 1]!;
  const nz = src.normals[vBase * 3 + 2]!;
  const corner = (v: number, s: number, t: number, o: number) =>
    lerp3(p[v + o]!, p[v + 3 + o]!, p[v + 6 + o]!, p[v + 9 + o]!, s, t);
  const col = (v: number, s: number, t: number, o: number) =>
    lerp3(c[v + o]!, c[v + 3 + o]!, c[v + 6 + o]!, c[v + 9 + o]!, s, t);
  const vp = vBase * 3;
  for (let gy = 0; gy < mh; gy += 1) {
    const t0 = gy / mh;
    const t1 = (gy + 1) / mh;
    for (let gx = 0; gx < mw; gx += 1) {
      const s0 = gx / mw;
      const s1 = (gx + 1) / mw;
      const outBase = dst.positions.length / 3;
      const corners: readonly [number, number][] = [
        [s0, t1],
        [s1, t1],
        [s1, t0],
        [s0, t0],
      ];
      for (let k = 0; k < 4; k += 1) {
        const [cs, ct] = corners[k]!;
        dst.positions.push(corner(vp, cs, ct, 0), corner(vp, cs, ct, 1), corner(vp, cs, ct, 2));
        dst.normals.push(nx, ny, nz);
        dst.colors.push(col(vp, cs, ct, 0), col(vp, cs, ct, 1), col(vp, cs, ct, 2));
      }
      dst.uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
      if (flipped)
        dst.indices.push(outBase + 1, outBase + 2, outBase + 3, outBase + 1, outBase + 3, outBase);
      else dst.indices.push(outBase, outBase + 1, outBase + 2, outBase, outBase + 2, outBase + 3);
    }
  }
};

const appendDemotedFullBatch = (dst: AtlasBatchDraft, src: AtlasBatchDraft): void => {
  const quadCount = src.indices.length / 6;
  for (let q = 0; q < quadCount; q += 1) {
    const u0 = q * 8;
    const mw = Math.max(1, Math.round(Math.abs(src.uvs[u0 + 2]! - src.uvs[u0]!) * 2));
    const mh = Math.max(1, Math.round(Math.abs(src.uvs[u0 + 1]! - src.uvs[u0 + 5]!) * 2));
    if (mw === 1 && mh === 1) {
      const outBase = dst.positions.length / 3;
      const vBase = q * 4;
      const vp = vBase * 3;
      const flipped = src.indices[q * 6]! !== vBase;
      for (let k = 0; k < 12; k += 1) {
        dst.positions.push(src.positions[vp + k]!);
        dst.normals.push(src.normals[vp + k]!);
        dst.colors.push(src.colors[vp + k]!);
      }
      const uMin = Math.min(src.uvs[u0]!, src.uvs[u0 + 2]!, src.uvs[u0 + 4]!, src.uvs[u0 + 6]!);
      const vMin = Math.min(src.uvs[u0 + 1]!, src.uvs[u0 + 3]!, src.uvs[u0 + 5]!, src.uvs[u0 + 7]!);
      for (let k = 0; k < 8; k += 2) {
        dst.uvs.push((src.uvs[u0 + k]! - uMin) * 2, (src.uvs[u0 + k + 1]! - vMin) * 2);
      }
      if (flipped)
        dst.indices.push(outBase + 1, outBase + 2, outBase + 3, outBase + 1, outBase + 3, outBase);
      else dst.indices.push(outBase, outBase + 1, outBase + 2, outBase, outBase + 2, outBase + 3);
    } else {
      pushSubdividedGrid(dst, src, q * 4, q * 6, mw, mh);
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
  const repeatingReqs: { readonly layer: BlockRenderLayer; readonly tileId: string }[] = [];
  for (const [key, b] of fullBatches) {
    if (b.indices.length === 0) continue;
    if (promotedKeys.has(key)) {
      repeatingBatches.push(b);
      repeatingReqs.push({ layer: b.layer, tileId: b.tileId });
      continue;
    }
    const nrKey = `${b.layer}:${b.textureId}`;
    let existing = nonRepeatingBatches.get(nrKey);
    if (!existing) {
      existing = {
        layer: b.layer,
        tileId: b.tileId,
        textureId: b.textureId,
        positions: [],
        normals: [],
        uvs: [],
        colors: [],
        indices: [],
      };
      nonRepeatingBatches.set(nrKey, existing);
    }
    appendDemotedFullBatch(existing, b);
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
