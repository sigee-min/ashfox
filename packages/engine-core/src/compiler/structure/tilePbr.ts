import type { TexturePbrMaterial } from '../../model/texture';
import { encodeLinearRgbaPngBase64 } from '../program/asset/texture/pbr';

export type StructureMaterialClass =
  'metal' | 'glass' | 'water' | 'polished_stone' | 'wood' | 'plaster' | 'stone';

export interface TilePbrSpec {
  readonly materialClass: StructureMaterialClass;
  readonly roughness: number;
  readonly metallic: number;
  readonly roughnessVariation: number;
}

const TILE_CLASS_DEFAULTS: Readonly<
  Record<StructureMaterialClass, Omit<TilePbrSpec, 'materialClass'>>
> = Object.freeze({
  metal: { roughness: 0.28, metallic: 0.88, roughnessVariation: 0.12 },
  glass: { roughness: 0.08, metallic: 0.0, roughnessVariation: 0.02 },
  water: { roughness: 0.06, metallic: 0.0, roughnessVariation: 0.04 },
  polished_stone: { roughness: 0.46, metallic: 0.0, roughnessVariation: 0.08 },
  wood: { roughness: 0.78, metallic: 0.0, roughnessVariation: 0.08 },
  plaster: { roughness: 0.9, metallic: 0.0, roughnessVariation: 0.05 },
  stone: { roughness: 0.86, metallic: 0.0, roughnessVariation: 0.08 },
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

/** Synthesize one deterministic MetallicRoughness (+AO) PBR descriptor for a structure atlas. */
export const synthesizeStructureAtlasPbr = (
  width: number,
  height: number,
  regions: readonly PackedTilePbrRegion[],
): TexturePbrMaterial => {
  if (regions.length === 0) return Object.freeze({ roughness: 0.86, metallic: 0.0 });
  const specs = regions.map((region) => ({
    region,
    spec: classifyStructureTilePbr(region.tileId),
  }));
  const first = specs[0]!.spec;
  const uniform = specs.every(
    ({ spec }) =>
      spec.roughnessVariation === 0 &&
      spec.roughness === first.roughness &&
      spec.metallic === first.metallic,
  );
  if (uniform) return Object.freeze({ roughness: first.roughness, metallic: first.metallic });
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
