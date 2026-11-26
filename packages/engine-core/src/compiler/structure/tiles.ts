import type { StructureDensity } from '../../project/structure/contract';
import {
  expandRampFive,
  generateHueShiftedRamp,
  lerpOklchHex,
  type RampPreset,
} from '../../textures/oklch';

export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: string;
  readonly alpha: 0 | 255;
}

export type FiveToneRamp = readonly [string, string, string, string, string];

const RAMP_CACHE = new Map<string, FiveToneRamp>();

const ramp = (hex: string, preset: RampPreset): FiveToneRamp => {
  const key = `${hex}:${preset}`;
  const cached = RAMP_CACHE.get(key);
  if (cached) return cached;
  const built = expandRampFive(generateHueShiftedRamp(hex, preset));
  RAMP_CACHE.set(key, built);
  return built;
};

const hash3 = (a: number, b: number, c: number): number => {
  let h = (a * 374761393 + b * 668265263 + c * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
};

const r = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: 0 | 255 = 255,
): TileRect => ({ x, y, w, h, color, alpha });

const deepTone = (tone: string, amount = 0.42): string => lerpOklchHex(tone, '#1b1d24', amount);

const paintPlanks = (
  baseHex: string,
  seed: number,
  variant: number,
  nailHex = '#2c2f36',
): readonly TileRect[] => {
  const [t0, t1, t2, t3, t4] = ramp(baseHex, 'wood');
  const seam = deepTone(t0, 0.32);
  const out: TileRect[] = [r(0, 0, 16, 16, t2)];
  const vSeed = seed + variant * 31;
  for (let row = 0; row < 4; row += 1) {
    const y = row * 4;
    const tone = (hash3(row, variant, seed) & 1) === 0 ? t2 : t1;
    out.push(r(0, y, 16, 4, tone), r(0, y, 16, 1, t3), r(0, y + 3, 16, 1, seam));
    const jx = (hash3(row + 7, vSeed, 3) % 12) + 2;
    out.push(r(jx, y, 1, 4, seam), r((jx + 1) % 16, y + 1, 1, 1, nailHex));
    out.push(r((jx + 14) % 16, y + 2, 1, 1, nailHex));
    const gx = (hash3(row + 13, vSeed, 5) % 10) + 1;
    out.push(r(gx, y + 1, 4, 1, t4), r((gx + 6) % 12, y + 2, 3, 1, t0));
  }
  return out;
};

const paintLogSide = (baseHex: string, seed: number, variant: number): readonly TileRect[] => {
  const [t0, t1, t2, t3] = ramp(baseHex, 'wood');
  const furrow = deepTone(t0, 0.45);
  const out: TileRect[] = [r(0, 0, 16, 16, t1)];
  for (let x = 0; x < 16; x += 2) {
    const h = hash3(x, variant, seed) % 3;
    out.push(r(x, 0, 1, 16, h === 0 ? furrow : h === 1 ? t2 : t0));
  }
  const ky = (hash3(variant, seed, 19) % 10) + 2;
  const kx = (hash3(seed, variant, 23) % 10) + 3;
  out.push(r(kx, ky, 2, 3, furrow), r(kx + 1, ky + 1, 1, 1, t3));
  return out;
};

const paintLogTop = (barkHex: string, coreHex: string): readonly TileRect[] => {
  const [b0, b1] = ramp(barkHex, 'wood');
  const [c0, c1, c2, c3] = ramp(coreHex, 'wood');
  return [
    r(0, 0, 16, 16, deepTone(b0, 0.3)),
    r(1, 1, 14, 14, b1),
    r(2, 2, 12, 12, c2),
    r(3, 3, 10, 10, c1),
    r(5, 5, 6, 6, c3),
    r(7, 7, 2, 2, c0),
  ];
};

const paintMasonry = (
  baseHex: string,
  preset: RampPreset,
  mortarHex: string,
  rows: number,
  seed: number,
  variant: number,
  moss = false,
): readonly TileRect[] => {
  const [t0, t1, t2, t3, t4] = ramp(baseHex, preset);
  const tones = [t1, t2, t2, t3];
  const out: TileRect[] = [r(0, 0, 16, 16, mortarHex)];
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor((row * 16) / rows);
    const y1 = Math.floor(((row + 1) * 16) / rows);
    const h = Math.max(2, y1 - y0);
    const shift = row % 2 === 0 ? 0 : 4;
    for (let col = 0; col < 2; col += 1) {
      const bx = (shift + col * 8) % 16;
      const bw = 7;
      const tone = tones[hash3(row * 3 + col, variant, seed) % tones.length]!;
      const end = Math.min(16, bx + bw);
      out.push(r(bx, y0 + 1, end - bx, Math.max(1, h - 1), tone));
      out.push(r(bx, y0 + 1, end - bx, 1, t4));
      if (bx + bw > 16) {
        const wrapW = bx + bw - 16;
        out.push(r(0, y0 + 1, wrapW, Math.max(1, h - 1), tone), r(0, y0 + 1, wrapW, 1, t4));
      }
      if (h >= 3) out.push(r((bx + 2) % 16, y0 + h - 1, 3, 1, t0));
    }
  }
  if (moss) paintMossOverlay(out, seed, variant);
  return out;
};

const paintMossOverlay = (out: TileRect[], seed: number, variant: number): void => {
  const [m0, m1, m2] = ramp('#4f823a', 'organic');
  for (let i = 0; i < 4; i += 1) {
    const mx = hash3(i, variant, seed + 41) % 12;
    const my = hash3(i + 5, variant, seed + 59) % 12;
    out.push(r(mx, my, 4, 2, m1), r(mx + 1, my, 2, 1, m2), r(mx + 1, my + 2, 2, 1, m0));
  }
};

const paintCobble = (
  baseHex: string,
  seed: number,
  variant: number,
  moss = false,
): readonly TileRect[] => {
  const [t0, t1, t2, t3, t4] = ramp(baseHex, 'stone');
  const mortar = deepTone(t0, 0.48);
  const out: TileRect[] = [r(0, 0, 16, 16, mortar)];
  const stones = [
    [0, 1, 7, 4],
    [8, 0, 8, 5],
    [1, 6, 5, 4],
    [7, 6, 6, 4],
    [14, 6, 2, 4],
    [0, 11, 8, 4],
    [9, 11, 7, 4],
  ];
  for (let i = 0; i < stones.length; i += 1) {
    const [sx, sy, sw, sh] = stones[i]!;
    const dx = (hash3(i, variant, seed) % 3) - 1;
    const x = Math.max(0, Math.min(15, sx + (sx > 0 && sx < 13 ? dx : 0)));
    const w = Math.max(2, Math.min(16 - x, sw));
    const fill = [t1, t2, t3, t2][hash3(i + 9, variant, seed) % 4]!;
    out.push(
      r(x, sy, w, sh, fill),
      r(x, sy, Math.max(1, w - 1), 1, t4),
      r(x, sy + sh - 1, w, 1, t0),
    );
  }
  if (moss) paintMossOverlay(out, seed, variant);
  return out;
};

const paintSlate = (baseHex: string, seed: number, variant: number): readonly TileRect[] => {
  const [t0, t1, t2, t3, t4] = ramp(baseHex, 'stone');
  const edge = deepTone(t0, 0.45);
  const out: TileRect[] = [r(0, 0, 16, 16, edge)];
  for (let row = 0; row < 4; row += 1) {
    const y = row * 4;
    const off = (row % 2) * 3;
    for (let col = 0; col < 3; col += 1) {
      const x = (col * 5 + off) % 16;
      const w = Math.min(4, 16 - x);
      const tone = [t1, t2, t3][hash3(row * 4 + col, variant, seed) % 3]!;
      out.push(r(x, y, w, 3, tone), r(x, y + 2, w, 1, t4), r(x, y + 3, w, 1, edge));
    }
  }
  return out;
};

const paintSpeckled = (
  baseHex: string,
  preset: RampPreset,
  seed: number,
  variant: number,
  step = 2,
): readonly TileRect[] => {
  const tones = ramp(baseHex, preset);
  const out: TileRect[] = [r(0, 0, 16, 16, tones[2])];
  for (let y = 0; y < 16; y += step) {
    for (let x = 0; x < 16; x += step) {
      const h = hash3(x + variant * 16, y + variant * 16, seed) % 8;
      if (h < 5) out.push(r(x, y, step, step, tones[h]!));
    }
  }
  return out;
};

const leafTone = (h: number, tones: FiveToneRamp): string => {
  const [t0, t1, t2, t3, t4] = tones;
  if (h < 4) return deepTone(t0, 0.25);
  if (h < 6) return t1;
  if (h < 8) return t2;
  return h === 8 ? t3 : t4;
};

const paintLeaves = (baseHex: string, seed: number, variant: number): readonly TileRect[] => {
  const tones = ramp(baseHex, 'organic');
  const out: TileRect[] = [r(0, 0, 16, 16, '#000000', 0)];
  for (let y = 0; y < 16; y += 2) {
    for (let x = 0; x < 16; x += 2) {
      const h = hash3(x + variant * 7, y + variant * 11, seed) % 10;
      if (h >= 2) out.push(r(x, y, 2, 2, leafTone(h, tones)));
    }
  }
  return out;
};

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
  dark_oak_planks: (s, v) => paintPlanks('#422917', s + 31, v),
  birch_planks: (s, v) => paintPlanks('#cbb88a', s + 41, v),
  oak_log_side: (s, v) => paintLogSide('#5e4529', s + 13, v),
  spruce_log_side: (s, v) => paintLogSide('#3b2817', s + 17, v),
  dark_oak_log_side: (s, v) => paintLogSide('#332217', s + 29, v),
  oak_log_top: () => paintLogTop('#4d3820', '#9e7747'),
  spruce_log_top: () => paintLogTop('#332111', '#6b4728'),
  dark_oak_log_top: () => paintLogTop('#26180f', '#422917'),
  cobblestone: (s, v) => paintCobble('#757980', s + 37, v, false),
  mossy_cobblestone: (s, v) => paintCobble('#6e7573', s + 43, v, true),
  stone_bricks: (s, v) => paintMasonry('#767b82', 'stone', '#41454c', 4, s + 47, v),
  mossy_stone_bricks: (s, v) => paintMasonry('#71787d', 'stone', '#40474b', 4, s + 53, v, true),
  deepslate_bricks: (s, v) => paintMasonry('#464b54', 'stone', '#212429', 4, s + 61, v),
  deepslate_tiles: (s, v) => paintSlate('#444a54', s + 67, v),
  slate_shingles: (s, v) => paintSlate('#444a54', s + 67, v),
  bricks: (s, v) => paintMasonry('#914736', 'warm', '#bfb2a1', 4, s + 71, v),
  terracotta: (s, v) => paintSpeckled('#945a44', 'warm', s + 73, v),
  plaster_white: (s, v) => paintSpeckled('#ded9ce', 'warm', s + 79, v),
  iron_block: (s, v) => paintMasonry('#b8c0c9', 'metal', '#7b838c', 2, s + 83, v),
  gold_block: (s, v) => paintMasonry('#e3ae34', 'warm', '#8f6314', 2, s + 89, v),
  dirt: (s, v) => paintSpeckled('#7a5436', 'warm', s + 97, v),
  grass_top: (s, v) => paintSpeckled('#619e43', 'organic', s + 101, v),
  leaves: (s, v) => paintLeaves('#498233', s + 107, v),
  oak_door: () => paintDoor('#9c7240', '#e0b34c'),
  spruce_door: () => paintDoor('#694526', '#c7ccd4'),
  iron_door: () => paintDoor('#b8c0c9', '#59626e'),
  glass: paintGlass,
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
    ...paintSpeckled('#7a5436', 'warm', s, v),
    r(0, 0, 16, 4, '#5e9941'),
    r(2, 4, 3, 2, '#4f8236'),
    r(10, 4, 4, 2, '#4f8236'),
  ],
};

const paintMaterial16 = (tileId: string, seed: number, variant: number): readonly TileRect[] => {
  const staticHit = STATIC_BOXES[tileId];
  if (staticHit) return parseBoxString(staticHit);
  const painter = TILE_PAINTERS[tileId];
  return painter ? painter(seed, variant) : paintSpeckled('#7c818a', 'stone', seed, variant);
};

const addSubDetail = (out: TileRect[], base: TileRect, seed: number, variant: number): void => {
  if (base.alpha === 0 || base.w < 2 || base.h < 2) return;
  const x = base.x * 2;
  const y = base.y * 2;
  const w = base.w * 2;
  const h = base.h * 2;
  if (hash3(x, y, seed + variant) % 3 === 0) {
    out.push(r(x, y, Math.max(1, w - 1), 1, lerpOklchHex(base.color, '#ffffff', 0.12)));
  }
  if (w >= 4 && h >= 4 && hash3(y, x, seed + variant + 7) % 4 === 0) {
    out.push(r(x + w - 2, y + h - 1, 2, 1, lerpOklchHex(base.color, '#181a20', 0.14)));
  }
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
    if (density === 2) addSubDetail(out, item, seed, variant);
  }
  return out;
};
