import { parseBlockState } from '../../project/structure/state';

export type BlockShapeKind =
  | 'full'
  | 'stair'
  | 'slab'
  | 'fence'
  | 'wall'
  | 'pane'
  | 'door'
  | 'trapdoor'
  | 'lantern'
  | 'torch'
  | 'bed'
  | 'chest'
  | 'ladder'
  | 'carpet'
  | 'chain'
  | 'pot'
  | 'campfire'
  | 'anvil'
  | 'cauldron';

export type BlockRenderLayer = 'opaque' | 'cutout' | 'emissive';
export type BlockZoneKind = 'exterior' | 'interior';

export interface BlockDescriptor {
  readonly shape: BlockShapeKind;
  readonly layer: BlockRenderLayer;
  readonly zone: BlockZoneKind;
  readonly solidOpaque: boolean;
  readonly furniture: boolean;
  readonly light: boolean;
  readonly top: string;
  readonly bottom: string;
  readonly side: string;
  readonly front: string;
}

const full = (
  top: string,
  side = top,
  bottom = top,
  front = side,
  extra?: Partial<BlockDescriptor>,
): BlockDescriptor => ({
  shape: 'full',
  layer: 'opaque',
  zone: 'exterior',
  solidOpaque: true,
  furniture: false,
  light: false,
  top,
  bottom,
  side,
  front,
  ...extra,
});

const shapeBlock = (
  shape: BlockShapeKind,
  tile: string,
  extra?: Partial<BlockDescriptor>,
): BlockDescriptor => ({
  shape,
  layer:
    extra?.layer ??
    ([
      'pane',
      'door',
      'trapdoor',
      'ladder',
      'fence',
      'chain',
      'lantern',
      'torch',
      'campfire',
      'pot',
    ].includes(shape)
      ? 'cutout'
      : 'opaque'),
  zone:
    extra?.zone ??
    (['bed', 'chest', 'carpet', 'pot', 'ladder'].includes(shape) ? 'interior' : 'exterior'),
  solidOpaque: false,
  furniture: extra?.furniture ?? ['bed', 'chest', 'pot', 'campfire', 'carpet'].includes(shape),
  light: extra?.light ?? ['lantern', 'torch', 'campfire'].includes(shape),
  top: extra?.top ?? tile,
  bottom: extra?.bottom ?? tile,
  side: extra?.side ?? tile,
  front: extra?.front ?? tile,
});

const WOOD_CATALOG: Readonly<Record<string, BlockDescriptor>> = {
  'minecraft:oak_planks': full('oak_planks'),
  'minecraft:spruce_planks': full('spruce_planks'),
  'minecraft:dark_oak_planks': full('dark_oak_planks'),
  'minecraft:birch_planks': full('birch_planks'),
  'minecraft:oak_log': full('oak_log_top', 'oak_log_side'),
  'minecraft:spruce_log': full('spruce_log_top', 'spruce_log_side'),
  'minecraft:dark_oak_log': full('dark_oak_log_top', 'dark_oak_log_side'),
  'minecraft:stripped_oak_log': full('oak_log_top', 'oak_planks'),
  'minecraft:stripped_spruce_log': full('spruce_log_top', 'spruce_planks'),
  'minecraft:oak_stairs': shapeBlock('stair', 'oak_planks'),
  'minecraft:spruce_stairs': shapeBlock('stair', 'spruce_planks'),
  'minecraft:dark_oak_stairs': shapeBlock('stair', 'dark_oak_planks'),
  'minecraft:oak_slab': shapeBlock('slab', 'oak_planks'),
  'minecraft:spruce_slab': shapeBlock('slab', 'spruce_planks'),
  'minecraft:dark_oak_slab': shapeBlock('slab', 'dark_oak_planks'),
  'minecraft:oak_fence': shapeBlock('fence', 'oak_planks'),
  'minecraft:spruce_fence': shapeBlock('fence', 'spruce_planks'),
  'minecraft:oak_door': shapeBlock('door', 'oak_door', { zone: 'exterior', layer: 'cutout' }),
  'minecraft:spruce_door': shapeBlock('door', 'spruce_door', { zone: 'exterior', layer: 'cutout' }),
  'minecraft:dark_oak_door': shapeBlock('door', 'spruce_door', {
    zone: 'exterior',
    layer: 'cutout',
  }),
  'minecraft:iron_door': shapeBlock('door', 'iron_block', { zone: 'exterior', layer: 'cutout' }),
  'minecraft:dark_oak_fence': shapeBlock('fence', 'dark_oak_planks'),
  'minecraft:oak_trapdoor': shapeBlock('trapdoor', 'oak_trapdoor', {
    zone: 'interior',
    layer: 'cutout',
  }),
  'minecraft:spruce_trapdoor': shapeBlock('trapdoor', 'spruce_planks', {
    zone: 'interior',
    layer: 'cutout',
  }),
  'minecraft:dark_oak_trapdoor': shapeBlock('trapdoor', 'dark_oak_planks', {
    zone: 'interior',
    layer: 'cutout',
  }),
};

const STONE_CATALOG: Readonly<Record<string, BlockDescriptor>> = {
  'minecraft:stone': full('stone'),
  'minecraft:smooth_stone': full('smooth_stone'),
  'minecraft:cobblestone': full('cobblestone'),
  'minecraft:mossy_cobblestone': full('mossy_cobblestone'),
  'minecraft:stone_bricks': full('stone_bricks'),
  'minecraft:cracked_stone_bricks': full('stone_bricks'),
  'minecraft:mossy_stone_bricks': full('mossy_stone_bricks'),
  'minecraft:chiseled_stone_bricks': full('chiseled_stone_bricks'),
  'minecraft:deepslate_bricks': full('deepslate_bricks'),
  'minecraft:deepslate_tiles': full('deepslate_bricks'),
  'minecraft:bricks': full('bricks'),
  'minecraft:terracotta': full('terracotta'),
  'minecraft:white_terracotta': full('plaster_white'),
  'minecraft:light_gray_wool': full('plaster_white'),
  'minecraft:white_wool': full('plaster_white'),
  'minecraft:white_concrete': full('plaster_white'),
  'minecraft:cobblestone_stairs': shapeBlock('stair', 'cobblestone'),
  'minecraft:stone_brick_stairs': shapeBlock('stair', 'stone_bricks'),
  'minecraft:deepslate_brick_stairs': shapeBlock('stair', 'deepslate_bricks'),
  'minecraft:brick_stairs': shapeBlock('stair', 'bricks'),
  'minecraft:cobblestone_slab': shapeBlock('slab', 'cobblestone'),
  'minecraft:stone_brick_slab': shapeBlock('slab', 'stone_bricks'),
  'minecraft:smooth_stone_slab': shapeBlock('slab', 'smooth_stone'),
  'minecraft:cobblestone_wall': shapeBlock('wall', 'cobblestone'),
  'minecraft:stone_brick_wall': shapeBlock('wall', 'stone_bricks'),
  'minecraft:mossy_stone_brick_wall': shapeBlock('wall', 'mossy_stone_bricks'),
};

const INTERIOR_CATALOG: Readonly<Record<string, BlockDescriptor>> = {
  'minecraft:glass': shapeBlock('full', 'glass', { layer: 'cutout', solidOpaque: false }),
  'minecraft:glass_pane': shapeBlock('pane', 'glass', { layer: 'cutout' }),
  'minecraft:iron_bars': shapeBlock('pane', 'iron_bars', { layer: 'cutout' }),
  'minecraft:iron_block': full('iron_block'),
  'minecraft:gold_block': full('gold_block'),
  'minecraft:torch': shapeBlock('torch', 'torch', { layer: 'emissive', zone: 'interior' }),
  'minecraft:wall_torch': shapeBlock('torch', 'torch', { layer: 'emissive', zone: 'interior' }),
  'minecraft:lantern': shapeBlock('lantern', 'lantern', { layer: 'emissive', zone: 'exterior' }),
  'minecraft:soul_lantern': shapeBlock('lantern', 'soul_lantern', {
    layer: 'emissive',
    zone: 'exterior',
  }),
  'minecraft:glowstone': full('glowstone', 'glowstone', 'glowstone', 'glowstone', {
    layer: 'emissive',
    zone: 'interior',
    light: true,
  }),
  'minecraft:sea_lantern': full('soul_lantern', 'soul_lantern', 'soul_lantern', 'soul_lantern', {
    layer: 'emissive',
    zone: 'interior',
    light: true,
  }),
  'minecraft:campfire': shapeBlock('campfire', 'campfire', { layer: 'emissive', zone: 'interior' }),
  'minecraft:bookshelf': full('oak_planks', 'bookshelf', 'oak_planks', 'bookshelf', {
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:crafting_table': full('crafting_top', 'crafting_side', 'oak_planks', 'crafting_side', {
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:furnace': full('smooth_stone', 'stone', 'smooth_stone', 'furnace_front', {
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:blast_furnace': full(
    'smooth_stone',
    'deepslate_bricks',
    'smooth_stone',
    'furnace_front',
    { zone: 'interior', furniture: true },
  ),
  'minecraft:magma_block': full('furnace_lit', 'furnace_lit', 'furnace_lit', 'furnace_lit', {
    layer: 'emissive',
    zone: 'interior',
    light: true,
  }),
  'minecraft:lava': full('furnace_lit', 'furnace_lit', 'furnace_lit', 'furnace_lit', {
    layer: 'emissive',
    zone: 'interior',
    light: true,
  }),
  'minecraft:barrel': full('spruce_planks', 'barrel_side', 'spruce_planks', 'barrel_side', {
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:chest': shapeBlock('chest', 'chest', {
    layer: 'opaque',
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:trapped_chest': shapeBlock('chest', 'chest', {
    layer: 'opaque',
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:red_bed': shapeBlock('bed', 'bed_red', {
    layer: 'opaque',
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:blue_bed': shapeBlock('bed', 'bed_blue', {
    layer: 'opaque',
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:ladder': shapeBlock('ladder', 'ladder', {
    layer: 'cutout',
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:chain': shapeBlock('chain', 'iron_bars', { layer: 'cutout', zone: 'exterior' }),
  'minecraft:flower_pot': shapeBlock('pot', 'flower_pot', {
    layer: 'cutout',
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:anvil': shapeBlock('anvil', 'iron_block', {
    layer: 'opaque',
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:cauldron': shapeBlock('cauldron', 'deepslate_bricks', {
    layer: 'opaque',
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:red_carpet': shapeBlock('carpet', 'carpet_red', {
    layer: 'opaque',
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:blue_carpet': shapeBlock('carpet', 'carpet_blue', {
    layer: 'opaque',
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:green_carpet': shapeBlock('carpet', 'carpet_moss', {
    layer: 'opaque',
    zone: 'interior',
    furniture: true,
  }),
  'minecraft:dirt': full('dirt'),
  'minecraft:grass_block': full('grass_top', 'grass_side', 'dirt'),
  'minecraft:oak_leaves': full('leaves', 'leaves', 'leaves', 'leaves', {
    layer: 'cutout',
    solidOpaque: false,
  }),
  'minecraft:spruce_leaves': full('leaves', 'leaves', 'leaves', 'leaves', {
    layer: 'cutout',
    solidOpaque: false,
  }),
  'minecraft:hay_block': full('hay_side'),
};

const ALL_BLOCKS: Readonly<Record<string, BlockDescriptor>> = {
  ...WOOD_CATALOG,
  ...STONE_CATALOG,
  ...INTERIOR_CATALOG,
};

const hashFallbackTile = (name: string): string => {
  if (name.includes('stair')) return 'stone_bricks';
  if (name.includes('plank') || name.includes('wood') || name.includes('oak')) return 'oak_planks';
  if (name.includes('deepslate') || name.includes('dark')) return 'deepslate_bricks';
  if (name.includes('brick')) return 'bricks';
  return 'stone';
};

export const describeBlockState = (state: string): BlockDescriptor => {
  const parsed = parseBlockState(state);
  const direct = ALL_BLOCKS[parsed.name];
  if (direct) {
    if (
      (parsed.name === 'minecraft:furnace' || parsed.name === 'minecraft:blast_furnace') &&
      parsed.properties.lit === 'true'
    ) {
      return { ...direct, layer: 'emissive', light: true, front: 'furnace_lit' };
    }
    return direct;
  }
  const tile = hashFallbackTile(parsed.name);
  if (parsed.name.includes('stairs')) return shapeBlock('stair', tile);
  if (parsed.name.includes('slab')) return shapeBlock('slab', tile);
  if (parsed.name.includes('carpet'))
    return shapeBlock('carpet', 'carpet_red', {
      layer: 'opaque',
      zone: 'interior',
      furniture: true,
    });
  return full(tile);
};
