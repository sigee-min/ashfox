import type { CardinalFacing, IntVec3 } from '../../../project/structure/contract';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type CeilingStyle,
  type InteriorArchitectureSpec,
  type InteriorOpeningSpan,
  type SubVoxelBoxIR,
  type WainscotStyle,
} from './contract';

export type B6 = readonly [number, number, number, number, number, number];
export type TileTuple = readonly [string, string, string, string, string, string];
type Layer = SubVoxelBoxIR['layer'];
type BandTuple = readonly [string, number, number, number, number, string, string, Layer, string?];

export interface WallSpan {
  readonly wall: CardinalFacing;
  readonly fixed: number;
  readonly inward: 1 | -1;
  readonly alongX: boolean;
  readonly uMin: number;
  readonly uMax: number;
}

export const U = SUBVOXEL_UNITS_PER_BLOCK;

export const bx = (
  id: string,
  b: B6,
  tile_id: string,
  semantic_tag?: string,
  layer: SubVoxelBoxIR['layer'] = 'opaque',
  color_tint?: string,
): SubVoxelBoxIR => ({
  id,
  from_16: [b[0], b[1], b[2]],
  to_16: [b[3], b[4], b[5]],
  tile_id,
  layer,
  ...(semantic_tag ? { semantic_tag } : {}),
  ...(color_tint ? { color_tint } : {}),
});

export const roomWallCoords = (from: IntVec3, to: IntVec3): readonly WallSpan[] => {
  const [xMin, xMax, zMin, zMax] = [from[0] + 1, to[0] - 1, from[2] + 1, to[2] - 1];
  return [
    { wall: 'north', fixed: (from[2] + 1) * U, inward: 1, alongX: true, uMin: xMin, uMax: xMax },
    { wall: 'south', fixed: to[2] * U, inward: -1, alongX: true, uMin: xMin, uMax: xMax },
    { wall: 'west', fixed: (from[0] + 1) * U, inward: 1, alongX: false, uMin: zMin, uMax: zMax },
    { wall: 'east', fixed: to[0] * U, inward: -1, alongX: false, uMin: zMin, uMax: zMax },
  ];
};

const isOpeningAt = (
  openings: readonly InteriorOpeningSpan[],
  wall: CardinalFacing,
  u: number,
  yLo: number,
  yHi: number,
): boolean => {
  const ax = wall === 'north' || wall === 'south';
  return openings.some((op) => {
    if (op.wall !== wall) return false;
    const [u0, u1] = ax ? [op.from[0], op.to[0]] : [op.from[2], op.to[2]];
    return u >= u0 && u <= u1 && yHi >= op.from[1] && yLo <= op.to[1];
  });
};

const st = (
  id: string,
  wc: WallSpan,
  s: readonly [number, number, number, number, number],
  tile: string,
  tag: string,
  layer: SubVoxelBoxIR['layer'] = 'opaque',
  tint?: string,
): SubVoxelBoxIR => {
  const [u0, u1, y0, y1, depth] = s;
  const [d0, d1] = wc.inward > 0 ? [wc.fixed, wc.fixed + depth] : [wc.fixed - depth, wc.fixed];
  const b: B6 = wc.alongX ? [u0, y0, d0, u1, y1, d1] : [d0, y0, u0, d1, y1, u1];
  return bx(id, b, tile, tag, layer, tint);
};

const emitPerimeterBand = (
  walls: readonly WallSpan[],
  openings: readonly InteriorOpeningSpan[],
  [px, y0, y1, depth, openY, tile, tag, layer, tint]: BandTuple,
): readonly SubVoxelBoxIR[] => {
  const out: SubVoxelBoxIR[] = [];
  for (const wc of walls) {
    for (let u = wc.uMin; u <= wc.uMax; u += 1) {
      if (!isOpeningAt(openings, wc.wall, u, openY, openY)) {
        out.push(
          st(
            `${px}_${wc.wall}_${u}`,
            wc,
            [u * U, (u + 1) * U, y0, y1, depth],
            tile,
            tag,
            layer,
            tint,
          ),
        );
      }
    }
  }
  return out;
};

const emitWainscotCell = (
  wc: WallSpan,
  u: number,
  fy: number,
  baseH: number,
  cy: number,
  style: WainscotStyle,
  p: TileTuple,
  out: SubVoxelBoxIR[],
): void => {
  const [u0, u1] = [u * U, (u + 1) * U];
  const dado = style === 'stone_dado' ? 'stone_bricks' : style === 'brick_dado' ? 'bricks' : p[3];
  const rows: readonly [string, number, number, number, number, number, string, Layer?, string?][] =
    style === 'shoji_lattice'
      ? [
          ['b', u0, u1, fy + baseH, cy - 3, 0.6, 'plaster_white', 'translucent', '#f6eedc'],
          ['s', u0, u0 + 1.5, fy + baseH, cy - 3, 1.4, p[2]],
          ['t', u0, u1, fy + 15, fy + 16.5, 1.4, p[2]],
        ]
      : style === 'tech_ribbed'
        ? [
            ['1', u0 + 1, u0 + 3, fy + baseH, cy - 3, 1.5, 'iron_flue'],
            ['2', u0 + 9, u0 + 11, fy + baseH, cy - 3, 1.5, 'iron_flue'],
            ['h', u0, u1, fy + 16, fy + 17.5, 1.8, 'iron_block'],
          ]
        : [
            ['l', u0, u1, fy + baseH, fy + baseH + 1.5, 1.5, p[2]],
            ['m', u0 + 1, u1 - 1, fy + baseH + 1.5, fy + 14.5, 1.0, dado],
            ['c', u0, u1, fy + 14.5, fy + 16.5, 2.0, p[2]],
          ];
  for (const [suf, a, b, y0, y1, dep, tl, ly, tn] of rows) {
    out.push(
      st(`ws_${wc.wall}_${u}_${suf}`, wc, [a, b, y0, y1, dep], tl, `wainscot_${style}`, ly, tn),
    );
  }
};

export const emitWainscot = (
  walls: readonly WallSpan[],
  openings: readonly InteriorOpeningSpan[],
  fromY: number,
  toY: number,
  baseH: number,
  style: WainscotStyle,
  p: TileTuple,
): readonly SubVoxelBoxIR[] => {
  if (style === 'none') return [];
  const [fy, cy, out] = [(fromY + 1) * U, toY * U, [] as SubVoxelBoxIR[]];
  for (const wc of walls)
    for (let u = wc.uMin; u <= wc.uMax; u += 1)
      if (!isOpeningAt(openings, wc.wall, u, fromY + 1, fromY + 2))
        emitWainscotCell(wc, u, fy, baseH, cy, style, p, out);
  return out;
};

const baseboardBand = (
  fromY: number,
  arch: InteriorArchitectureSpec,
  p: TileTuple,
): BandTuple | null => {
  if (arch.baseboard === 'none') return null;
  const fy = (fromY + 1) * U;
  const plinth = arch.baseboard === 'stone_plinth';
  const em = arch.baseboard === 'led_strip';
  const h = plinth ? 4 : em ? 1.5 : 2;
  const tl = plinth ? p[4] : em ? 'soul_lantern' : p[2];
  return [
    'bb',
    fy,
    fy + h,
    plinth ? 2 : 1.25,
    fromY + 1,
    tl,
    `baseboard_${arch.baseboard}`,
    em ? 'emissive' : 'opaque',
    em ? arch.strip_light_color : undefined,
  ];
};

const moldingBand = (
  toY: number,
  arch: InteriorArchitectureSpec,
  p: TileTuple,
): BandTuple | null => {
  const mold = arch.molding ?? 'none';
  if (mold === 'none') return null;
  const cy = toY * U;
  const em = mold === 'strip_light' || mold === 'neon_channel';
  const tl = em ? 'soul_lantern' : mold === 'stone_cornice' ? 'stone_bricks' : p[2];
  return [
    'md',
    cy - 2.5,
    cy,
    2.0,
    toY - 1,
    tl,
    `molding_${mold}`,
    em ? 'emissive' : 'opaque',
    em ? arch.strip_light_color : undefined,
  ];
};

export const emitBaseAndMold = (
  walls: readonly WallSpan[],
  ops: readonly InteriorOpeningSpan[],
  fromY: number,
  toY: number,
  arch: InteriorArchitectureSpec,
  p: TileTuple,
): readonly SubVoxelBoxIR[] =>
  [baseboardBand(fromY, arch, p), moldingBand(toY, arch, p)]
    .filter((b): b is BandTuple => b !== null)
    .flatMap((b) => emitPerimeterBand(walls, ops, b));

const emitCeilingRibs = (
  from: IntVec3,
  to: IntVec3,
  [ix0, ix1, iz0, iz1, cy]: readonly [number, number, number, number, number],
  style: CeilingStyle,
  p: TileTuple,
): readonly SubVoxelBoxIR[] => {
  const out: SubVoxelBoxIR[] = [];
  if (style === 'beamed' || style === 'coffered') {
    const ax = ix1 - ix0 <= iz1 - iz0;
    const [u0, u1] = ax ? [from[2] + 2, to[2] - 1] : [from[0] + 2, to[0] - 1];
    for (let u = u0; u <= u1; u += 2) {
      const b0 = u * U - 2;
      const b6: B6 = ax
        ? [ix0, cy - 4.5, b0, ix1, cy - 0.5, b0 + 4]
        : [b0, cy - 4.5, iz0, b0 + 4, cy - 0.5, iz1];
      out.push(bx(`cl_bm_${u}`, b6, p[2], `ceiling_${style}`));
    }
  } else if (style === 'slatted') {
    for (let u = ix0 + 2; u < ix1 - 1; u += 4)
      out.push(bx(`cl_sl_${u}`, [u, cy - 2, iz0, u + 1.5, cy - 0.5, iz1], p[2], 'ceiling_slatted'));
  } else if (style === 'vault') {
    out.push(bx('cl_vw', [ix0, cy - 6, iz0, ix0 + 8, cy - 0.5, iz1], p[4], 'ceiling_vault'));
    out.push(bx('cl_ve', [ix1 - 8, cy - 6, iz0, ix1, cy - 0.5, iz1], p[4], 'ceiling_vault'));
  }
  return out;
};

export const emitCeiling = (
  from: IntVec3,
  to: IntVec3,
  style: CeilingStyle,
  p: TileTuple,
): readonly SubVoxelBoxIR[] => {
  const rect = [(from[0] + 1) * U, to[0] * U, (from[2] + 1) * U, to[2] * U, to[1] * U] as const;
  const [ix0, ix1, iz0, iz1, cy] = rect;
  if (style === 'open_truss') {
    return [
      bx('cl_pn', [ix0, cy - 3, iz0, ix1, cy, iz0 + 3], p[2], 'ceiling_open_truss'),
      bx('cl_ps', [ix0, cy - 3, iz1 - 3, ix1, cy, iz1], p[2], 'ceiling_open_truss'),
    ];
  }
  return [
    bx('cl_skin', [ix0, cy - 0.5, iz0, ix1, cy, iz1], p[5], `ceiling_${style}`),
    ...emitCeilingRibs(from, to, rect, style, p),
  ];
};
