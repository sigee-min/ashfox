import type { CardinalFacing, IntVec3 } from '../../../project/structure/contract';
import type { StructureRoomMeta } from '../contract';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type BaseboardStyle,
  type CeilingStyle,
  type FloorPatternStyle,
  type InteriorArchitectureSpec,
  type InteriorOpeningSpan,
  type InteriorRoomInput,
  type MoldingStyle,
  type StyleDna,
  type StyleDnaArch,
  type SubVoxelBoxIR,
  type WainscotStyle,
} from './contract';

export interface InteriorShellResult {
  readonly architecture: InteriorArchitectureSpec;
  readonly boxes: readonly SubVoxelBoxIR[];
  readonly corbel_blocked_cells: readonly IntVec3[];
  readonly shell_layer_count: number;
}

export interface SafeCorbelPartition {
  readonly safe: readonly IntVec3[];
  readonly blocked: readonly IntVec3[];
}

type B6 = readonly [number, number, number, number, number, number];
type TileTuple = readonly [string, string, string, string, string, string];

const U = SUBVOXEL_UNITS_PER_BLOCK;

const bx = (
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

const archSpec = (
  floor_pattern: FloorPatternStyle,
  baseboard: BaseboardStyle,
  wainscot: WainscotStyle,
  molding: MoldingStyle,
  ceiling: CeilingStyle,
  strip_light_color?: string,
): InteriorArchitectureSpec => ({
  floor_pattern,
  baseboard,
  wainscot,
  molding,
  ceiling,
  ...(strip_light_color ? { strip_light_color } : {}),
});

export const DEFAULT_ARCHITECTURE_BY_ARCH: Readonly<
  Record<StyleDnaArch, InteriorArchitectureSpec>
> = {
  rustic: archSpec('plank', 'stone_plinth', 'paneled', 'timber_cornice', 'beamed'),
  japanese: archSpec('tatami', 'trim', 'shoji_lattice', 'timber_cornice', 'slatted'),
  modern: archSpec('herringbone', 'trim', 'none', 'strip_light', 'coffered', '#fff1d0'),
  scifi: archSpec('grate', 'led_strip', 'tech_ribbed', 'neon_channel', 'coffered', '#4ce8ff'),
  gothic: archSpec('stone_slab', 'stone_plinth', 'stone_dado', 'stone_cornice', 'vault'),
  desert: archSpec('tile', 'stone_plinth', 'brick_dado', 'stone_cornice', 'beamed'),
  industrial: archSpec('stone_slab', 'stone_plinth', 'brick_dado', 'timber_cornice', 'open_truss'),
  nordic: archSpec('plank', 'trim', 'paneled', 'timber_cornice', 'open_truss'),
};

const TILES_BY_ARCH: Readonly<Record<StyleDnaArch, string>> = {
  rustic: 'oak_planks|spruce_planks|timber_trim|spruce_planks|stone_bricks|dark_oak_planks',
  japanese: 'birch_planks|oak_planks|timber_trim|plaster_cream|spruce_planks|birch_planks',
  modern: 'birch_planks|smooth_stone|dark_oak_planks|plaster_white|iron_flue|plaster_white',
  scifi: 'iron_flue|deepslate_tiles|iron_block|deepslate_bricks|soul_lantern|deepslate_tiles',
  gothic:
    'deepslate_tiles|stone_bricks|deepslate_bricks|stone_bricks|stone_bricks|deepslate_bricks',
  desert: 'terracotta|plaster_cream|oak_planks|bricks|gold_block|oak_planks',
  industrial: 'iron_flue|cobblestone|iron_block|bricks|iron_flue|deepslate_bricks',
  nordic: 'birch_planks|spruce_planks|timber_trim|birch_planks|stone_bricks|birch_planks',
};

const tilesFor = (arch: StyleDnaArch): TileTuple => {
  const [a = '', b = '', c = '', d = '', e = '', f = ''] = TILES_BY_ARCH[arch].split('|');
  return [a, b, c, d, e, f];
};

export const resolveInteriorArchitecture = (
  dna: StyleDna,
  spec?: Partial<InteriorArchitectureSpec>,
): InteriorArchitectureSpec => {
  const base = DEFAULT_ARCHITECTURE_BY_ARCH[dna.arch];
  const stripColor = spec?.strip_light_color ?? base.strip_light_color;
  return {
    floor_pattern: spec?.floor_pattern ?? base.floor_pattern,
    baseboard: spec?.baseboard ?? base.baseboard,
    wainscot: spec?.wainscot ?? base.wainscot,
    molding: spec?.molding ?? base.molding ?? 'none',
    ceiling: spec?.ceiling ?? base.ceiling,
    ...(spec?.trim_tile ? { trim_tile: spec.trim_tile } : {}),
    ...(spec?.accent_color ? { accent_color: spec.accent_color } : {}),
    ...(stripColor ? { strip_light_color: stripColor } : {}),
  };
};

/** Checks whether a block cell lies inside an enclosed room's interior air volume. */
export const isInteriorRoomAirCell = (
  rooms: readonly Pick<StructureRoomMeta, 'from' | 'to' | 'enclosed'>[],
  x: number,
  y: number,
  z: number,
): boolean =>
  rooms.some(
    (r) =>
      r.enclosed &&
      x >= r.from[0] + 1 &&
      x <= r.to[0] - 1 &&
      y >= r.from[1] + 1 &&
      y <= r.to[1] - 1 &&
      z >= r.from[2] + 1 &&
      z <= r.to[2] - 1,
  );

/** Guards exterior corbels against penetrating enclosed interior rooms or openings. */
export const filterSafeExteriorCorbels = (
  candidates: readonly IntVec3[],
  rooms: readonly Pick<StructureRoomMeta, 'from' | 'to' | 'enclosed'>[],
  openings: readonly InteriorOpeningSpan[] = [],
): SafeCorbelPartition => {
  const safe: IntVec3[] = [];
  const blocked: IntVec3[] = [];
  const hitsOp = (x: number, y: number, z: number) =>
    openings.some(
      (o) =>
        x >= o.from[0] &&
        x <= o.to[0] &&
        y >= o.from[1] &&
        y <= o.to[1] &&
        z >= o.from[2] &&
        z <= o.to[2],
    );
  for (const cell of candidates) {
    if (
      hitsOp(cell[0], cell[1], cell[2]) ||
      isInteriorRoomAirCell(rooms, cell[0], cell[1], cell[2])
    )
      blocked.push(cell);
    else safe.push(cell);
  }
  return { safe, blocked };
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

interface WallSpan {
  readonly wall: CardinalFacing;
  readonly fixed: number;
  readonly inward: 1 | -1;
  readonly alongX: boolean;
  readonly uMin: number;
  readonly uMax: number;
}

const roomWallCoords = (from: IntVec3, to: IntVec3): readonly WallSpan[] => {
  const [xMin, xMax, zMin, zMax] = [from[0] + 1, to[0] - 1, from[2] + 1, to[2] - 1];
  return [
    { wall: 'north', fixed: (from[2] + 1) * U, inward: 1, alongX: true, uMin: xMin, uMax: xMax },
    { wall: 'south', fixed: to[2] * U, inward: -1, alongX: true, uMin: xMin, uMax: xMax },
    { wall: 'west', fixed: (from[0] + 1) * U, inward: 1, alongX: false, uMin: zMin, uMax: zMax },
    { wall: 'east', fixed: to[0] * U, inward: -1, alongX: false, uMin: zMin, uMax: zMax },
  ];
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

const emitFloorCell = (
  x: number,
  z: number,
  fy: number,
  pat: FloorPatternStyle,
  p: TileTuple,
  out: SubVoxelBoxIR[],
): void => {
  const [x0, z0, id] = [x * U, z * U, `fl_${x}_${z}`];
  const push = (k: string, b: B6, tl: string, tg: string, tn?: string) =>
    out.push(bx(`${id}_${k}`, b, tl, tg, 'opaque', tn));
  if (pat === 'tatami') {
    const tint = (x + z) % 2 === 0 ? '#cfd69c' : '#c6ce92';
    push(
      'm',
      [x0 + 0.5, fy, z0 + 0.5, x0 + 15.5, fy + 1, z0 + 15.5],
      'birch_planks',
      'floor_tatami',
      tint,
    );
    push('r', [x0, fy, z0, x0 + 16, fy + 0.8, z0 + 0.5], 'dark_oak_planks', 'floor_tatami_border');
    return;
  }
  if (pat === 'grate') {
    push('s', [x0, fy - 1, z0, x0 + 16, fy - 0.2, z0 + 16], 'deepslate_tiles', 'floor_grate_base');
    push('a', [x0 + 2, fy - 0.2, z0, x0 + 4, fy + 0.5, z0 + 16], 'iron_flue', 'floor_grate');
    push('b', [x0 + 10, fy - 0.2, z0, x0 + 12, fy + 0.5, z0 + 16], 'iron_flue', 'floor_grate');
    return;
  }
  const alt = pat === 'herringbone' || pat === 'tile' ? (x + z) % 2 === 0 : z % 2 === 0;
  const tile = pat === 'stone_slab' ? 'smooth_stone' : alt ? p[0] : p[1];
  push('c', [x0, fy - 0.5, z0, x0 + 16, fy + 0.25, z0 + 16], tile, `floor_${pat}`);
};

const emitFloorPattern = (
  from: IntVec3,
  to: IntVec3,
  pat: FloorPatternStyle,
  p: TileTuple,
): readonly SubVoxelBoxIR[] => {
  const out: SubVoxelBoxIR[] = [];
  const fy = (from[1] + 1) * U;
  for (let z = from[2] + 1; z <= to[2] - 1; z += 1) {
    for (let x = from[0] + 1; x <= to[0] - 1; x += 1) emitFloorCell(x, z, fy, pat, p, out);
  }
  return out;
};

type Layer = SubVoxelBoxIR['layer'];
type BandTuple = readonly [string, number, number, number, number, string, string, Layer, string?];

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

const emitWainscot = (
  walls: readonly WallSpan[],
  openings: readonly InteriorOpeningSpan[],
  fromY: number,
  toY: number,
  baseH: number,
  style: WainscotStyle,
  p: TileTuple,
): readonly SubVoxelBoxIR[] => {
  if (style === 'none') return [];
  const [fy, cy] = [(fromY + 1) * U, toY * U];
  const out: SubVoxelBoxIR[] = [];
  for (const wc of walls) {
    for (let u = wc.uMin; u <= wc.uMax; u += 1) {
      if (!isOpeningAt(openings, wc.wall, u, fromY + 1, fromY + 2))
        emitWainscotCell(wc, u, fy, baseH, cy, style, p, out);
    }
  }
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

const emitBaseAndMold = (
  walls: readonly WallSpan[],
  ops: readonly InteriorOpeningSpan[],
  fromY: number,
  toY: number,
  arch: InteriorArchitectureSpec,
  p: TileTuple,
): readonly SubVoxelBoxIR[] => {
  const bands = [baseboardBand(fromY, arch, p), moldingBand(toY, arch, p)].filter(
    (b): b is BandTuple => b !== null,
  );
  return bands.flatMap((b) => emitPerimeterBand(walls, ops, b));
};

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

const emitCeiling = (
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

/** Generates the 5-layer interior architectural shell and checks exterior corbel guard. */
export const buildInteriorShell = (
  input: InteriorRoomInput,
  corbelCandidates: readonly IntVec3[] = [],
): InteriorShellResult => {
  const arch = resolveInteriorArchitecture(input.style_dna, input.architecture);
  const p = tilesFor(input.style_dna.arch);
  const walls = roomWallCoords(input.bounds_from, input.bounds_to);
  const baseH = arch.baseboard === 'stone_plinth' ? 4 : arch.baseboard === 'led_strip' ? 1.5 : 2;
  const [from, to, ops] = [input.bounds_from, input.bounds_to, input.openings];
  const boxes: SubVoxelBoxIR[] = [
    ...emitFloorPattern(from, to, arch.floor_pattern, p),
    ...emitBaseAndMold(walls, ops, from[1], to[1], arch, p),
    ...emitWainscot(walls, ops, from[1], to[1], baseH, arch.wainscot, p),
    ...emitCeiling(from, to, arch.ceiling, p),
  ];
  const guard = filterSafeExteriorCorbels(
    corbelCandidates,
    [{ from, to, enclosed: input.kind !== 'courtyard' }],
    ops,
  );
  const layerList = [
    arch.floor_pattern,
    arch.baseboard,
    arch.wainscot,
    arch.molding ?? 'none',
    arch.ceiling,
  ];
  return {
    architecture: arch,
    boxes,
    corbel_blocked_cells: guard.blocked,
    shell_layer_count: layerList.filter((l) => l !== 'none').length,
  };
};
