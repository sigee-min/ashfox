import type { StructureDensity } from '../../project/structure/contract';
import {
  deepTone,
  hash3,
  paintCobble,
  paintFlowerBox,
  paintHearthEmber,
  paintIronFlue,
  paintLeaves,
  paintLogSide,
  paintLogTop,
  paintMasonry,
  paintPlanks,
  paintSlate,
  paintTimberTrim,
  paintWash,
  paintWindowGlow,
  r,
  ramp,
  type FiveToneRamp,
  type TileRect,
} from './tilePalette';

export type { FiveToneRamp, TileRect };

type BoxRow = readonly [number, number, number, number, string, (0 | 255)?];

const paintBoxes = (rows: readonly BoxRow[]): TileRect[] =>
  rows.map(([x, y, w, h, c, a]) => r(x, y, w, h, c, a ?? 255));

const paintDoor = (baseHex: string, brassHex: string): readonly TileRect[] => {
  const [t0, t1, t2, t3, t4] = ramp(baseHex, 'wood');
  const dark = deepTone(t0, 0.35);
  return paintBoxes([
    [0, 0, 16, 16, t2],
    [0, 0, 16, 1, dark],
    [0, 15, 16, 1, dark],
    [0, 0, 1, 16, dark],
    [15, 0, 1, 16, dark],
    [3, 2, 4, 4, t3],
    [9, 2, 4, 4, t3],
    [4, 3, 2, 2, '#9ec9d9', 0],
    [10, 3, 2, 2, '#9ec9d9', 0],
    [3, 8, 10, 5, t1],
    [4, 9, 8, 3, t4],
    [12, 7, 2, 2, brassHex],
  ]);
};

const paintGlass = (): readonly TileRect[] => {
  const [g0, , g2, g3, g4] = ramp('#9ad6eb', 'cool');
  return paintBoxes([
    [0, 0, 16, 16, g2, 0],
    [0, 0, 16, 1, g3],
    [0, 15, 16, 1, g0],
    [0, 0, 1, 16, g3],
    [15, 0, 1, 16, g0],
    [3, 2, 3, 1, g4],
    [2, 3, 1, 2, g4],
    [10, 11, 2, 1, g4],
  ]);
};

const paintIronBars = (): readonly TileRect[] => {
  const [m0, m1, m2, m3] = ramp('#59626e', 'metal');
  const dark = deepTone(m0, 0.35);
  return paintBoxes([
    [0, 0, 16, 16, '#000000', 0],
    [2, 0, 2, 16, m1],
    [12, 0, 2, 16, m1],
    [7, 0, 2, 16, m2],
    [7, 0, 1, 16, m3],
    [0, 3, 16, 2, dark],
    [0, 11, 16, 2, dark],
  ]);
};

const paintLantern = (soul: boolean): readonly TileRect[] => {
  const [m0, m1] = ramp('#3b434f', 'metal');
  const [e0, , e2, e3, e4] = ramp(soul ? '#42dce8' : '#ffab38', 'emissive');
  return paintBoxes([
    [0, 0, 16, 16, deepTone(m0, 0.4)],
    [0, 0, 16, 2, m1],
    [0, 14, 16, 2, m1],
    [2, 2, 12, 12, e0],
    [3, 3, 10, 10, e2],
    [5, 5, 6, 6, e3],
    [6, 6, 4, 4, e4],
  ]);
};

const paintBookshelf = (seed: number, variant: number): readonly TileRect[] => {
  const out = [
    ...paintPlanks('#9e6c3b', seed, variant),
    r(1, 2, 14, 5, '#24160d'),
    r(1, 9, 14, 5, '#24160d'),
  ];
  const spines = ['#a83632', '#366899', '#468247', '#c79734', '#7e488c'];
  for (const rowY of [2, 9]) {
    for (let bx = 2; bx < 13; bx += 2) {
      const topGap = hash3(bx + 3, rowY, variant) % 2;
      out.push(
        r(
          bx,
          rowY + topGap,
          2,
          5 - topGap,
          spines[hash3(bx, rowY + variant, seed) % spines.length]!,
        ),
      );
    }
  }
  return out;
};

type TilePainter = (seed: number, variant: number) => readonly TileRect[];

const paintFurnace = (lit: boolean, seed: number, variant: number): readonly TileRect[] => [
  ...paintMasonry('#7c818a', 'stone', '#484c52', 3, seed, variant),
  r(4, 2, 8, 3, '#26282b'),
  r(4, 9, 8, 5, lit ? '#ff731c' : '#212326'),
  ...(lit ? [r(6, 10, 4, 3, '#ffe169')] : []),
];

const paintBed = (base: string, trim: string): readonly TileRect[] =>
  paintBoxes([
    [0, 0, 16, 16, base],
    [0, 0, 16, 5, '#ebe7dd'],
    [0, 5, 16, 2, trim],
  ]);

const paintCarpet = (a: string, b: string, c: string): readonly TileRect[] =>
  paintBoxes([
    [0, 0, 16, 16, a],
    [2, 2, 12, 12, b],
    [4, 4, 8, 8, c],
  ]);

const parseBoxString = (spec: string): TileRect[] =>
  spec.split(';').map((part) => {
    const [x, y, w, h, col] = part.split(',');
    return r(Number(x), Number(y), Number(w), Number(h), col || '#000000', col ? 255 : 0);
  });

const PLASTER_WASH = ['#ede5d4', '#eae1cf', '#e7decb', '#e4dac6'] as const;
const PLASTER_CREAM_WASH = ['#ece4d2', '#e9e0ce', '#e6dcc9', '#e3d8c4'] as const;
const TERRACOTTA_WASH = ['#ae6b51', '#a6634a', '#9e5d45', '#96563f'] as const;
const DIRT_WASH = ['#805b3e', '#785438', '#704d33', '#68472e'] as const;
const GRASS_WASH = ['#6ba34a', '#639b44', '#5c923e', '#72ab50'] as const;
const STONE_WASH = ['#82878f', '#7a7f87', '#737880', '#898e96'] as const;

const STATIC_BOXES: Readonly<Record<string, string>> = {
  chiseled_stone_bricks:
    '0,0,16,16,#767b82;1,1,14,14,#5a5f66;3,3,10,10,#90969e;5,5,6,6,#50555c;7,7,2,2,#a3abb5',
  smooth_stone: '0,0,16,16,#9499a1;0,0,16,1,#b2b7bf;0,15,16,1,#686d75',
  oak_trapdoor: '0,0,16,16,#9c7240;2,2,5,5,;9,2,5,5,;2,9,5,5,;9,9,5,5,',
  spruce_trapdoor: '0,0,16,16,#6b4728;1,1,14,1,#8c6139;1,14,14,1,#402814;4,4,8,8,#54351e',
  torch: '0,0,16,16,;6,5,4,11,#7a5530;6,1,4,4,#ffae33;7,2,2,2,#fff299',
  glowstone: '0,0,16,16,#cc8431;2,2,12,12,#ffcf5c;5,5,6,6,#fff4ad',
  campfire: '0,0,16,16,#4f321c;3,1,10,9,#ff8f26;5,3,6,6,#ffe775;2,10,12,5,#332011',
  crafting_top:
    '0,0,16,16,#9c6e3b;1,1,14,14,#bd8951;5,1,1,14,#5e3c1e;10,1,1,14,#5e3c1e;1,5,14,1,#5e3c1e;1,10,14,1,#5e3c1e',
  chest: '0,0,16,16,#9c6835;0,0,16,2,#3b2613;0,14,16,2,#3b2613;0,5,16,2,#291a0d;6,4,4,4,#d9b54c',
  ladder:
    '0,0,16,16,;2,0,2,16,#8f6338;12,0,2,16,#8f6338;2,2,12,2,#b07d4b;2,6,12,2,#b07d4b;2,10,12,2,#b07d4b;2,14,12,2,#b07d4b',
  flower_pot: '0,0,16,16,;4,8,8,8,#8c4e37;6,4,4,5,#477a38;4,1,8,4,#d9534f',
  hay_side:
    '0,0,16,16,#c7a436;0,4,16,2,#8c312b;0,11,16,2,#8c312b;3,0,2,16,#dec052;10,0,2,16,#b08f28',
};

const TILE_PAINTERS: Readonly<Record<string, TilePainter>> = {
  oak_planks: (s, v) => paintPlanks('#a67b48', s + 11, v),
  spruce_planks: (s, v) => paintPlanks('#6b4728', s + 23, v),
  dark_oak_planks: (s, v) => paintPlanks('#422917', s + 31, v, true),
  birch_planks: (s, v) => paintPlanks('#cbb88a', s + 41, v),
  oak_log_side: (s, v) => paintLogSide('#5e4529', s + 13, v),
  spruce_log_side: (s, v) => paintLogSide('#3b2817', s + 17, v),
  dark_oak_log_side: (s, v) => paintLogSide('#332217', s + 29, v),
  oak_log_top: () => paintLogTop('#4d3820', '#9e7747'),
  spruce_log_top: () => paintLogTop('#332111', '#6b4728'),
  dark_oak_log_top: () => paintLogTop('#26180f', '#422917'),
  cobblestone: (s, v) => paintCobble('#777b82', s + 37, v, false),
  mossy_cobblestone: (s, v) => paintCobble('#6f7774', s + 43, v, true),
  stone_bricks: (s, v) => paintMasonry('#7b8087', 'stone', '#50555e', 4, s + 47, v),
  mossy_stone_bricks: (s, v) => paintMasonry('#737a7f', 'stone', '#4c5358', 4, s + 53, v, true),
  deepslate_bricks: (s, v) => paintMasonry('#484e57', 'stone', '#2b2f36', 4, s + 61, v),
  deepslate_tiles: (s, v) => paintSlate('#454c57', s + 67, v),
  slate_shingles: (s, v) => paintSlate('#454c57', s + 67, v),
  bricks: (s, v) => paintMasonry('#944d3b', 'warm', '#a89b8a', 4, s + 71, v),
  terracotta: (s, v) => paintWash(TERRACOTTA_WASH, s + 73, v),
  plaster_white: (s, v) => paintWash(PLASTER_WASH, s + 79, v),
  plaster_cream: (s, v) => paintWash(PLASTER_CREAM_WASH, s + 81, v),
  iron_block: (s, v) => paintMasonry('#b8c0c9', 'metal', '#7b838c', 2, s + 83, v),
  gold_block: (s, v) => paintMasonry('#e3ae34', 'warm', '#8f6314', 2, s + 89, v),
  copper_block: (s, v) => paintMasonry('#c46c47', 'warm', '#7d3e24', 2, s + 131, v),
  exposed_copper: (s, v) => paintMasonry('#a86b4c', 'warm', '#6e4532', 2, s + 113, v),
  weathered_copper: (s, v) => paintMasonry('#6c9980', 'stone', '#486b59', 2, s + 119, v),
  oxidized_copper: (s, v) => paintMasonry('#4e9985', 'stone', '#326658', 2, s + 127, v),
  sand: (s, v) => paintWash(['#dbd0a7', '#d2c69b', '#c9bc90', '#e0d6b1'], s + 137, v),
  gravel: (s, v) => paintCobble('#7a7875', s + 139, v, false),
  black_concrete: (s, v) => paintWash(['#23262d', '#1f2228', '#272a32', '#1b1e24'], s + 149, v),
  cyan_concrete: (s, v) => paintWash(['#226b78', '#1e606c', '#267582', '#1a5661'], s + 151, v),
  dirt: (s, v) => paintWash(DIRT_WASH, s + 97, v),
  grass_top: (s, v) => paintWash(GRASS_WASH, s + 101, v),
  leaves: (s, v) => paintLeaves('#498233', s + 107, v),
  oak_door: () => paintDoor('#9c7240', '#e0b34c'),
  spruce_door: () => paintDoor('#694526', '#c7ccd4'),
  iron_door: () => paintDoor('#b8c0c9', '#59626e'),
  glass: paintGlass,
  stained_glass: () =>
    paintBoxes([
      [0, 0, 16, 16, '#f4fbff'],
      [0, 0, 16, 1, '#ffffff'],
      [0, 15, 16, 1, '#d8ebf5'],
      [0, 0, 1, 16, '#ffffff'],
      [15, 0, 1, 16, '#d8ebf5'],
      [3, 2, 3, 1, '#ffffff'],
      [10, 11, 2, 1, '#ffffff'],
    ]),
  sun_shaft_beam: () => [r(0, 0, 16, 16, '#ffffff')],
  iron_bars: paintIronBars,
  lantern: () => paintLantern(false),
  soul_lantern: () => paintLantern(true),
  bookshelf: paintBookshelf,
  crafting_side: (s, v) => [
    ...paintPlanks('#8c5e35', s, v),
    r(3, 3, 3, 7, '#a3adb8'),
    r(10, 3, 2, 8, '#54351e'),
  ],
  furnace_front: (s, v) => paintFurnace(false, s, v),
  furnace_lit: (s, v) => paintFurnace(true, s, v),
  barrel_side: (s, v) => [
    ...paintPlanks('#785130', s, v),
    r(0, 3, 16, 2, '#3d424a'),
    r(0, 11, 16, 2, '#3d424a'),
  ],
  bed_red: () => paintBed('#b8322c', '#d43d35'),
  bed_blue: () => paintBed('#3252a8', '#4169c9'),
  carpet_red: () => paintCarpet('#a82c2c', '#c73a3a', '#db9e3b'),
  carpet_blue: () => paintCarpet('#2b478f', '#3b5fb8', '#d4c37b'),
  carpet_moss: () => paintCarpet('#3b662b', '#4f853a', '#b8a363'),
  grass_side: (s, v) => [
    ...paintWash(DIRT_WASH, s, v),
    r(0, 0, 16, 4, '#639b44'),
    r(0, 0, 16, 1, '#6ba34a'),
    r(2, 4, 3, 2, '#598e3c'),
    r(10, 4, 4, 2, '#598e3c'),
  ],
  window_glow: () => paintWindowGlow(),
  timber_trim: (_s, v) => paintTimberTrim(v),
  hearth_ember: (_s, v) => paintHearthEmber(v),
  flower_box: (_s, v) => paintFlowerBox(v),
  iron_flue: (_s, v) => paintIronFlue(v),
};

const SEED_INVARIANT_PAINTERS = new Set<string>([
  'oak_log_top',
  'spruce_log_top',
  'dark_oak_log_top',
  'oak_door',
  'spruce_door',
  'iron_door',
  'glass',
  'stained_glass',
  'sun_shaft_beam',
  'iron_bars',
  'lantern',
  'soul_lantern',
  'bed_red',
  'bed_blue',
  'carpet_red',
  'carpet_blue',
  'carpet_moss',
  'window_glow',
  'timber_trim',
  'hearth_ember',
  'flower_box',
  'iron_flue',
]);

/** Returns true when a tile's raster output does not depend on the structure seed. */
export const isSeedInvariantTile = (tileId: string): boolean =>
  Object.prototype.hasOwnProperty.call(STATIC_BOXES, tileId) || SEED_INVARIANT_PAINTERS.has(tileId);

const paintMaterial16 = (tileId: string, seed: number, variant: number): readonly TileRect[] => {
  const staticHit = STATIC_BOXES[tileId];
  if (staticHit) return parseBoxString(staticHit);
  const painter = TILE_PAINTERS[tileId];
  return painter ? painter(seed, variant) : paintWash(STONE_WASH, seed, variant);
};

export const paintTileRects = (
  tileId: string,
  density: StructureDensity = 1,
  seed = 1,
  variant = 0,
): readonly TileRect[] => {
  const tilePx = density === 2 ? 32 : 16;
  const raw = paintMaterial16(tileId, seed, variant & 3);
  const scale = density === 2 ? 2 : 1;
  const out: TileRect[] = [];
  for (const item of raw) {
    const x = Math.max(0, Math.min(tilePx - 1, Math.floor(item.x * scale)));
    const y = Math.max(0, Math.min(tilePx - 1, Math.floor(item.y * scale)));
    const w = Math.max(1, Math.min(tilePx - x, Math.floor(item.w * scale)));
    const h = Math.max(1, Math.min(tilePx - y, Math.floor(item.h * scale)));
    out.push(r(x, y, w, h, item.color, item.alpha));
  }
  return out;
};
