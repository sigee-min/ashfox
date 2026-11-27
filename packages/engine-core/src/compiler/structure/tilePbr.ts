import type { TexturePbrMaterial } from '../../model/texture';
import { srgbLuma } from '../../textures/color';
import {
  grainHeightOffset,
  patternHeightOffset,
  synthesizeNormalMapPngBase64,
  type NormalGrainKind,
  type NormalPatternKind,
  type NormalRegionBounds,
} from '../../textures/normalMap';
import { encodeLinearRgbaPngBase64 } from '../program/asset/texture/pbr';

export type StructureMaterialClass =
  'metal' | 'glass' | 'water' | 'polished_stone' | 'wood' | 'plaster' | 'stone';

export interface TilePbrSpec {
  readonly materialClass: StructureMaterialClass;
  readonly roughness: number;
  readonly metallic: number;
  readonly roughnessVariation: number;
  readonly normalStrength: number;
}

const TILE_CLASS_DEFAULTS: Readonly<
  Record<StructureMaterialClass, Omit<TilePbrSpec, 'materialClass'>>
> = Object.freeze({
  metal: { roughness: 0.28, metallic: 0.88, roughnessVariation: 0.12, normalStrength: 0.3 },
  glass: { roughness: 0.08, metallic: 0.0, roughnessVariation: 0.02, normalStrength: 0.0 },
  water: { roughness: 0.06, metallic: 0.0, roughnessVariation: 0.04, normalStrength: 0.0 },
  polished_stone: { roughness: 0.46, metallic: 0.0, roughnessVariation: 0.08, normalStrength: 0.2 },
  wood: { roughness: 0.78, metallic: 0.0, roughnessVariation: 0.08, normalStrength: 0.28 },
  plaster: { roughness: 0.9, metallic: 0.0, roughnessVariation: 0.05, normalStrength: 0.14 },
  stone: { roughness: 0.86, metallic: 0.0, roughnessVariation: 0.08, normalStrength: 0.34 },
});

const METAL_TILES = new Set([
  'iron_block',
  'gold_block',
  'iron_door',
  'iron_bars',
  'lantern',
  'soul_lantern',
  'iron_flue',
]);

const POLISHED_TILES = new Set([
  'smooth_stone',
  'chiseled_stone_bricks',
  'deepslate_tiles',
  'slate_shingles',
]);

const PLASTER_TILES = new Set(['plaster_white', 'plaster_cream', 'terracotta']);

/** Classify a structure tile id into its calibrated PBR material class. */
export const classifyStructureTilePbr = (rawTileId: string): TilePbrSpec => {
  const tileId = rawTileId.replace(/^minecraft:/, '');
  let materialClass: StructureMaterialClass = 'stone';
  if (METAL_TILES.has(tileId) || tileId.includes('anvil') || tileId.includes('chain')) {
    materialClass = 'metal';
  } else if (tileId === 'glass' || tileId === 'window_glow') {
    materialClass = 'glass';
  } else if (tileId.includes('water')) {
    materialClass = 'water';
  } else if (POLISHED_TILES.has(tileId) || tileId.includes('polished_')) {
    materialClass = 'polished_stone';
  } else if (PLASTER_TILES.has(tileId)) {
    materialClass = 'plaster';
  } else if (
    tileId.includes('plank') ||
    tileId.includes('log_') ||
    tileId.includes('timber') ||
    tileId.includes('wood') ||
    tileId.includes('bookshelf') ||
    tileId.includes('crafting') ||
    tileId === 'chest' ||
    tileId.includes('barrel') ||
    tileId.includes('ladder') ||
    tileId.includes('trapdoor') ||
    tileId.includes('_door')
  ) {
    materialClass = 'wood';
  }
  return Object.freeze({ materialClass, ...TILE_CLASS_DEFAULTS[materialClass] });
};

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)));

export interface PackedTilePbrRegion {
  readonly tileId: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

const tileNormalPattern = (rawTileId: string): NormalPatternKind => {
  const id = rawTileId.replace(/^minecraft:/, '');
  if (id.includes('brick') || id.includes('cobble')) return 'brick';
  if (
    id.includes('plank') ||
    id.includes('log_') ||
    id.includes('timber') ||
    id.includes('bookshelf')
  )
    return 'plank';
  if (
    id.includes('tile') ||
    id.includes('slate') ||
    id.includes('shingle') ||
    id.includes('chiseled')
  )
    return 'tile';
  if (
    id.includes('door') ||
    id.includes('chest') ||
    id.includes('block') ||
    id.includes('trapdoor')
  )
    return 'seam';
  return 'none';
};

const tileNormalGrain = (materialClass: StructureMaterialClass): NormalGrainKind => {
  if (materialClass === 'metal') return 'brushed';
  if (materialClass === 'wood') return 'wood';
  if (materialClass === 'plaster') return 'soft';
  if (materialClass === 'stone' || materialClass === 'polished_stone') return 'stone';
  return 'none';
};

const regionMeanLuma = (
  albedoRgba: Uint8Array,
  atlasWidth: number,
  region: PackedTilePbrRegion,
): number => {
  let sum = 0;
  let count = 0;
  for (let ly = 0; ly < region.size; ly += 1) {
    for (let lx = 0; lx < region.size; lx += 1) {
      const off = ((region.y + ly) * atlasWidth + (region.x + lx)) * 4;
      if ((albedoRgba[off + 3] ?? 0) === 0) continue;
      sum += srgbLuma(albedoRgba[off]!, albedoRgba[off + 1]!, albedoRgba[off + 2]!);
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0.5;
};

const fillTileHeightRegion = (
  heights: Float32Array,
  atlasWidth: number,
  albedoRgba: Uint8Array,
  region: PackedTilePbrRegion,
  spec: TilePbrSpec,
  seedIdx: number,
): void => {
  const meanL = regionMeanLuma(albedoRgba, atlasWidth, region);
  const pattern = tileNormalPattern(region.tileId);
  const grain = tileNormalGrain(spec.materialClass);
  for (let ly = 0; ly < region.size; ly += 1) {
    for (let lx = 0; lx < region.size; lx += 1) {
      const off = ((region.y + ly) * atlasWidth + (region.x + lx)) * 4;
      const luma =
        (albedoRgba[off + 3] ?? 0) === 0
          ? meanL
          : srgbLuma(albedoRgba[off]!, albedoRgba[off + 1]!, albedoRgba[off + 2]!);
      const lumaDelta = (luma - meanL) * 0.85;
      const patOffset = patternHeightOffset(lx, ly, region.size, region.size, pattern);
      const grainOff = grainHeightOffset([lx, ly, seedIdx], 1337, grain, lx, ly) * 0.5;
      heights[(region.y + ly) * atlasWidth + (region.x + lx)] = Math.max(
        0,
        Math.min(1, 0.5 + lumaDelta + patOffset + grainOff),
      );
    }
  }
};

const synthesizeStructureNormalPng = (
  width: number,
  height: number,
  specs: readonly { readonly region: PackedTilePbrRegion; readonly spec: TilePbrSpec }[],
  albedoRgba: Uint8Array | undefined,
): string | undefined => {
  if (!albedoRgba || specs.every(({ spec }) => spec.normalStrength <= 0)) return undefined;
  const heights = new Float32Array(width * height).fill(0.5);
  const bounds: NormalRegionBounds[] = [];
  specs.forEach(({ region, spec }, idx) => {
    if (spec.normalStrength > 0) {
      fillTileHeightRegion(heights, width, albedoRgba, region, spec, idx);
    }
    bounds.push({
      x: region.x,
      y: region.y,
      width: region.size,
      height: region.size,
      strength: spec.normalStrength,
    });
  });
  return synthesizeNormalMapPngBase64(width, height, heights, bounds);
};

/** Synthesize one deterministic MetallicRoughness (+AO) and optional Normal PBR descriptor for a structure atlas. */
export const synthesizeStructureAtlasPbr = (
  width: number,
  height: number,
  regions: readonly PackedTilePbrRegion[],
  albedoRgba?: Uint8Array,
): TexturePbrMaterial => {
  if (regions.length === 0) return Object.freeze({ roughness: 0.86, metallic: 0.0 });
  const specs = regions.map((region) => ({
    region,
    spec: classifyStructureTilePbr(region.tileId),
  }));
  const first = specs[0]!.spec;
  const normalPng = synthesizeStructureNormalPng(width, height, specs, albedoRgba);
  const uniform = specs.every(
    ({ spec }) =>
      spec.roughnessVariation === 0 &&
      spec.roughness === first.roughness &&
      spec.metallic === first.metallic,
  );
  if (uniform) {
    return Object.freeze({
      roughness: first.roughness,
      metallic: first.metallic,
      ...(normalPng ? { normalPngBase64: normalPng } : {}),
    });
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 255;
    rgba[i + 1] = clampByte(first.roughness);
    rgba[i + 2] = clampByte(first.metallic);
    rgba[i + 3] = 255;
  }
  for (const { region, spec } of specs) {
    paintStructureTilePbr(rgba, width, height, region, spec);
  }
  return Object.freeze({
    roughness: first.roughness,
    metallic: first.metallic,
    metallicRoughnessPngBase64: encodeLinearRgbaPngBase64(width, height, rgba),
    ...(normalPng ? { normalPngBase64: normalPng } : {}),
  });
};

const paintStructureTilePbr = (
  rgba: Uint8Array,
  atlasWidth: number,
  atlasHeight: number,
  region: PackedTilePbrRegion,
  spec: TilePbrSpec,
): void => {
  const metallicByte = clampByte(spec.metallic);
  const xStart = Math.max(0, region.x - 1);
  const yStart = Math.max(0, region.y - 1);
  const xEnd = Math.min(atlasWidth, region.x + region.size + 1);
  const yEnd = Math.min(atlasHeight, region.y + region.size + 1);
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const lx = Math.max(0, Math.min(region.size - 1, x - region.x));
      const ly = Math.max(0, Math.min(region.size - 1, y - region.y));
      const border = lx === 0 || ly === 0 || lx === region.size - 1 || ly === region.size - 1;
      const checker = ((lx + ly) & 1) === 0 ? -0.5 : 0.5;
      const ao = border ? 228 : 255;
      const roughness = spec.roughness + checker * spec.roughnessVariation * 0.6;
      const dst = (y * atlasWidth + x) * 4;
      rgba[dst] = ao;
      rgba[dst + 1] = clampByte(roughness);
      rgba[dst + 2] = metallicByte;
      rgba[dst + 3] = 255;
    }
  }
};
