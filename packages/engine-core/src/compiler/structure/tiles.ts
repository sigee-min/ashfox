export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: string;
  readonly alpha: 0 | 255;
}

const seedHash = (x: number, y: number, seed: number): number => {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
};

const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: 0 | 255 = 255,
): TileRect => ({
  x,
  y,
  w,
  h,
  color,
  alpha,
});

const paintPlanks = (
  ramp: readonly [string, string, string, string],
  seed: number,
): readonly TileRect[] => {
  const out: TileRect[] = [rect(0, 0, 16, 16, ramp[1])];
  for (let row = 0; row < 4; row += 1) {
    const y = row * 4;
    out.push(rect(0, y, 16, 1, ramp[2]), rect(0, y + 3, 16, 1, ramp[0]));
    const seamX = ((row * 5 + (seed % 7) + 2) % 14) + 1;
    out.push(rect(seamX, y, 1, 4, ramp[0]));
    const hiX = ((seamX + 4) % 12) + 1;
    out.push(rect(hiX, y + 1, 3, 1, ramp[3]));
  }
  return out;
};

const paintLogSide = (bark: readonly [string, string, string]): readonly TileRect[] => {
  const out: TileRect[] = [rect(0, 0, 16, 16, bark[1])];
  for (let x = 0; x < 16; x += 2) {
    out.push(rect(x, 0, 1, 16, x % 4 === 0 ? bark[0] : bark[2]));
  }
  out.push(rect(3, 2, 1, 4, bark[0]), rect(11, 8, 1, 5, bark[0]), rect(7, 4, 1, 6, bark[2]));
  return out;
};

const paintLogTop = (bark: string, ring: readonly [string, string]): readonly TileRect[] => [
  rect(0, 0, 16, 16, bark),
  rect(2, 2, 12, 12, ring[0]),
  rect(4, 4, 8, 8, ring[1]),
  rect(6, 6, 4, 4, ring[0]),
  rect(7, 7, 2, 2, bark),
];

const paintBricks = (
  bg: string,
  mortar: string,
  hi: string,
  lo: string,
  rows = 4,
): readonly TileRect[] => {
  const out: TileRect[] = [rect(0, 0, 16, 16, bg)];
  for (let r = 0; r < rows; r += 1) {
    const y = Math.floor((r * 16) / rows);
    const nextY = Math.floor(((r + 1) * 16) / rows);
    const stepY = Math.max(2, nextY - y);
    out.push(rect(0, y, 16, 1, mortar), rect(0, y + 1, 16, 1, hi));
    const offset = r % 2 === 0 ? 0 : 4;
    for (let c = 0; c < 2; c += 1) {
      const vx = (offset + c * 8) % 16;
      out.push(rect(vx, y, 1, stepY, mortar));
      const loX = (vx + 2) % 16;
      out.push(rect(loX, y + stepY - 1, Math.min(5, 16 - loX), 1, lo));
    }
  }
  return out;
};

const paintSpeckled = (
  palette: readonly [string, string, string, string],
  seed: number,
): readonly TileRect[] => {
  const out: TileRect[] = [rect(0, 0, 16, 16, palette[1])];
  for (let y = 0; y < 16; y += 2) {
    for (let x = 0; x < 16; x += 2) {
      const idx = seedHash(x, y, seed) % 4;
      if (idx !== 1) out.push(rect(x, y, 2, 2, palette[idx]!));
    }
  }
  return out;
};

const paintDoor = (
  dark: string,
  mid: string,
  light: string,
  brass: string,
): readonly TileRect[] => [
  rect(0, 0, 16, 16, mid),
  rect(0, 0, 16, 1, dark),
  rect(0, 15, 16, 1, dark),
  rect(0, 0, 1, 16, dark),
  rect(15, 0, 1, 16, dark),
  rect(3, 2, 4, 4, light),
  rect(9, 2, 4, 4, light),
  rect(4, 3, 2, 2, '#9ec9d9', 0),
  rect(10, 3, 2, 2, '#9ec9d9', 0),
  rect(3, 9, 10, 4, dark),
  rect(4, 10, 8, 2, light),
  rect(12, 7, 2, 2, brass),
];

const paintBookshelf = (): readonly TileRect[] => [
  ...paintPlanks(['#5e3e23', '#8c5e35', '#ad7847', '#c48f5a'], 3),
  rect(1, 2, 14, 5, '#2b1b10'),
  rect(1, 9, 14, 5, '#2b1b10'),
  rect(2, 2, 2, 5, '#a83632'),
  rect(4, 3, 2, 4, '#366899'),
  rect(7, 2, 2, 5, '#468247'),
  rect(10, 3, 2, 4, '#c79734'),
  rect(12, 2, 2, 5, '#7e488c'),
  rect(2, 10, 3, 4, '#366899'),
  rect(5, 9, 2, 5, '#c79734'),
  rect(8, 10, 3, 4, '#a83632'),
  rect(12, 9, 2, 5, '#598249'),
];

const TILE_BUILDERS: Readonly<Record<string, () => readonly TileRect[]>> = {
  oak_planks: () => paintPlanks(['#7d5a34', '#a67b48', '#be925b', '#cfa672'], 11),
  spruce_planks: () => paintPlanks(['#4c321c', '#6b4728', '#805734', '#946840'], 23),
  dark_oak_planks: () => paintPlanks(['#2a1a0f', '#422917', '#54351e', '#664226'], 31),
  birch_planks: () => paintPlanks(['#a3936c', '#cbb88a', '#dfd0a5', '#eee1bc'], 41),
  oak_log_side: () => paintLogSide(['#3d2c19', '#5e4529', '#735634']),
  spruce_log_side: () => paintLogSide(['#26190e', '#3b2817', '#4d351f']),
  dark_oak_log_side: () => paintLogSide(['#1f140d', '#332217', '#422d1f']),
  oak_log_top: () => paintLogTop('#4d3820', ['#9e7747', '#be945b']),
  spruce_log_top: () => paintLogTop('#332111', ['#6b4728', '#805734']),
  dark_oak_log_top: () => paintLogTop('#26180f', ['#422917', '#54351e']),
  oak_door: () => paintDoor('#54381c', '#9c7240', '#ba8c52', '#e0b34c'),
  spruce_door: () => paintDoor('#362111', '#694526', '#825732', '#c7ccd4'),
  oak_trapdoor: () => [
    rect(0, 0, 16, 16, '#9c7240'),
    rect(2, 2, 5, 5, '#000000', 0),
    rect(9, 2, 5, 5, '#000000', 0),
    rect(2, 9, 5, 5, '#000000', 0),
    rect(9, 9, 5, 5, '#000000', 0),
  ],
  stone: () => paintSpeckled(['#63676e', '#7c818a', '#8c919b', '#70747d'], 53),
  smooth_stone: () => [
    rect(0, 0, 16, 16, '#9499a1'),
    rect(0, 0, 16, 1, '#b2b7bf'),
    rect(0, 15, 16, 1, '#686d75'),
  ],
  cobblestone: () => [
    ...paintBricks('#757980', '#484c52', '#9499a1', '#5c6066', 3),
    rect(5, 2, 3, 2, '#5c6066'),
    rect(10, 9, 3, 3, '#9499a1'),
  ],
  mossy_cobblestone: () => [
    ...paintBricks('#6e7573', '#434a48', '#8a9491', '#545c5a', 3),
    rect(2, 1, 5, 3, '#4f7a3e'),
    rect(9, 7, 5, 3, '#5d8f49'),
    rect(3, 12, 4, 3, '#416632'),
  ],
  stone_bricks: () => paintBricks('#767b82', '#4c5057', '#9499a1', '#5f636b', 4),
  mossy_stone_bricks: () => [
    ...paintBricks('#71787d', '#495054', '#8e969c', '#5b6268', 4),
    rect(1, 2, 4, 3, '#4f7a3e'),
    rect(10, 10, 5, 3, '#5e8f48'),
  ],
  chiseled_stone_bricks: () => [
    rect(0, 0, 16, 16, '#767b82'),
    rect(1, 1, 14, 14, '#5a5f66'),
    rect(3, 3, 10, 10, '#90969e'),
    rect(5, 5, 6, 6, '#50555c'),
    rect(7, 7, 2, 2, '#a3abb5'),
  ],
  deepslate_bricks: () => paintBricks('#41454d', '#23262b', '#565c66', '#31343b', 4),
  bricks: () => paintBricks('#8f4534', '#b8ab9a', '#ab5946', '#6e3225', 4),
  terracotta: () => paintSpeckled(['#7d4a36', '#945a44', '#a36750', '#87513d'], 67),
  plaster_white: () => paintSpeckled(['#c9c4b9', '#dcd7cc', '#ebe7dd', '#d4cfc4'], 73),
  iron_block: () => [
    rect(0, 0, 16, 16, '#b8c0c9'),
    rect(0, 0, 16, 1, '#e1e7ed'),
    rect(0, 0, 1, 16, '#e1e7ed'),
    rect(15, 0, 1, 16, '#7b838c'),
    rect(0, 15, 16, 1, '#7b838c'),
    rect(3, 3, 10, 10, '#cbd3db'),
  ],
  gold_block: () => [
    rect(0, 0, 16, 16, '#d9a42e'),
    rect(0, 0, 16, 1, '#ffde6b'),
    rect(0, 15, 16, 1, '#8f6314'),
    rect(3, 3, 10, 10, '#f2c144'),
  ],
  glass: () => [
    rect(0, 0, 16, 16, '#b8e3f2', 0),
    rect(0, 0, 16, 1, '#a3cfde'),
    rect(0, 15, 16, 1, '#7faec2'),
    rect(0, 0, 1, 16, '#a3cfde'),
    rect(15, 0, 1, 16, '#7faec2'),
    rect(3, 2, 3, 1, '#e8f8ff'),
    rect(2, 3, 1, 2, '#e8f8ff'),
  ],
  iron_bars: () => [
    rect(0, 0, 16, 16, '#000000', 0),
    rect(2, 0, 2, 16, '#4c545e'),
    rect(12, 0, 2, 16, '#4c545e'),
    rect(7, 0, 2, 16, '#6f7987'),
    rect(0, 3, 16, 2, '#3d434a'),
    rect(0, 11, 16, 2, '#3d434a'),
  ],
  torch: () => [
    rect(0, 0, 16, 16, '#000000', 0),
    rect(6, 5, 4, 11, '#7a5530'),
    rect(6, 1, 4, 4, '#ffae33'),
    rect(7, 2, 2, 2, '#fff299'),
  ],
  lantern: () => [
    rect(0, 0, 16, 16, '#2d3542'),
    rect(0, 0, 16, 2, '#c48f37'),
    rect(0, 14, 16, 2, '#c48f37'),
    rect(3, 3, 10, 10, '#ffae3b'),
    rect(5, 5, 6, 6, '#fff099'),
  ],
  soul_lantern: () => [
    rect(0, 0, 16, 16, '#233038'),
    rect(0, 0, 16, 2, '#3f525c'),
    rect(0, 14, 16, 2, '#3f525c'),
    rect(3, 3, 10, 10, '#45d4e0'),
    rect(5, 5, 6, 6, '#b8fcff'),
  ],
  glowstone: () => [
    rect(0, 0, 16, 16, '#cc8431'),
    rect(2, 2, 12, 12, '#ffcf5c'),
    rect(5, 5, 6, 6, '#fff4ad'),
  ],
  campfire: () => [
    rect(0, 0, 16, 16, '#4f321c'),
    rect(3, 1, 10, 9, '#ff8f26'),
    rect(5, 3, 6, 6, '#ffe775'),
    rect(2, 10, 12, 5, '#332011'),
  ],
  bookshelf: paintBookshelf,
  crafting_top: () => [
    rect(0, 0, 16, 16, '#9c6e3b'),
    rect(1, 1, 14, 14, '#bd8951'),
    rect(5, 1, 1, 14, '#5e3c1e'),
    rect(10, 1, 1, 14, '#5e3c1e'),
    rect(1, 5, 14, 1, '#5e3c1e'),
    rect(1, 10, 14, 1, '#5e3c1e'),
  ],
  crafting_side: () => [
    ...paintPlanks(['#5e3e23', '#8c5e35', '#ad7847', '#c48f5a'], 7),
    rect(3, 3, 3, 7, '#a3adb8'),
    rect(10, 3, 2, 8, '#54351e'),
  ],
  furnace_front: () => [
    ...paintBricks('#6e737a', '#484c52', '#8c9199', '#585c63', 3),
    rect(4, 2, 8, 3, '#26282b'),
    rect(4, 9, 8, 5, '#212326'),
  ],
  furnace_lit: () => [
    ...paintBricks('#6e737a', '#484c52', '#8c9199', '#585c63', 3),
    rect(4, 2, 8, 3, '#26282b'),
    rect(4, 9, 8, 5, '#ff731c'),
    rect(6, 10, 4, 3, '#ffe169'),
  ],
  barrel_side: () => [
    ...paintPlanks(['#4f341d', '#785130', '#91633d', '#a6744a'], 9),
    rect(0, 3, 16, 2, '#3d424a'),
    rect(0, 11, 16, 2, '#3d424a'),
  ],
  chest: () => [
    rect(0, 0, 16, 16, '#9c6835'),
    rect(0, 0, 16, 2, '#3b2613'),
    rect(0, 14, 16, 2, '#3b2613'),
    rect(0, 5, 16, 2, '#291a0d'),
    rect(6, 4, 4, 4, '#d9b54c'),
  ],
  bed_red: () => [
    rect(0, 0, 16, 16, '#b8322c'),
    rect(0, 0, 16, 5, '#ebe7dd'),
    rect(0, 5, 16, 2, '#d43d35'),
  ],
  bed_blue: () => [
    rect(0, 0, 16, 16, '#3252a8'),
    rect(0, 0, 16, 5, '#ebe7dd'),
    rect(0, 5, 16, 2, '#4169c9'),
  ],
  ladder: () => [
    rect(0, 0, 16, 16, '#000000', 0),
    rect(2, 0, 2, 16, '#8f6338'),
    rect(12, 0, 2, 16, '#8f6338'),
    rect(2, 2, 12, 2, '#b07d4b'),
    rect(2, 6, 12, 2, '#b07d4b'),
    rect(2, 10, 12, 2, '#b07d4b'),
    rect(2, 14, 12, 2, '#b07d4b'),
  ],
  flower_pot: () => [
    rect(0, 0, 16, 16, '#000000', 0),
    rect(4, 8, 8, 8, '#8c4e37'),
    rect(6, 4, 4, 5, '#477a38'),
    rect(4, 1, 8, 4, '#d9534f'),
  ],
  carpet_red: () => [
    rect(0, 0, 16, 16, '#a82c2c'),
    rect(2, 2, 12, 12, '#c73a3a'),
    rect(4, 4, 8, 8, '#db9e3b'),
  ],
  carpet_blue: () => [
    rect(0, 0, 16, 16, '#2b478f'),
    rect(2, 2, 12, 12, '#3b5fb8'),
    rect(4, 4, 8, 8, '#d4c37b'),
  ],
  carpet_moss: () => [
    rect(0, 0, 16, 16, '#3b662b'),
    rect(2, 2, 12, 12, '#4f853a'),
    rect(4, 4, 8, 8, '#b8a363'),
  ],
  dirt: () => paintSpeckled(['#5c3e26', '#7a5436', '#8c613f', '#6b492e'], 89),
  grass_top: () => paintSpeckled(['#4a7d32', '#619e43', '#75b554', '#568c3b'], 97),
  grass_side: () => [
    ...paintSpeckled(['#5c3e26', '#7a5436', '#8c613f', '#6b492e'], 89),
    rect(0, 0, 16, 4, '#5e9941'),
    rect(2, 4, 3, 2, '#4f8236'),
    rect(10, 4, 4, 2, '#4f8236'),
  ],
  leaves: () => [
    rect(0, 0, 16, 16, '#345e23'),
    rect(2, 2, 4, 4, '#4e8537'),
    rect(9, 1, 5, 5, '#4e8537'),
    rect(5, 8, 6, 5, '#629e47'),
    rect(0, 11, 4, 4, '#244517'),
    rect(11, 10, 4, 4, '#000000', 0),
  ],
  hay_side: () => [
    rect(0, 0, 16, 16, '#c7a436'),
    rect(0, 4, 16, 2, '#8c312b'),
    rect(0, 11, 16, 2, '#8c312b'),
    rect(3, 0, 2, 16, '#dec052'),
    rect(10, 0, 2, 16, '#b08f28'),
  ],
};

export const paintTileRects = (tileId: string): readonly TileRect[] =>
  (TILE_BUILDERS[tileId] ?? TILE_BUILDERS.stone!)().map((r) => {
    const x = Math.max(0, Math.min(15, Math.floor(r.x)));
    const y = Math.max(0, Math.min(15, Math.floor(r.y)));
    return {
      ...r,
      x,
      y,
      w: Math.max(1, Math.min(16 - x, Math.floor(r.w))),
      h: Math.max(1, Math.min(16 - y, Math.floor(r.h))),
    };
  });
