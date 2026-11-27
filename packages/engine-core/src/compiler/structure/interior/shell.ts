import type { IntVec3 } from '../../../project/structure/contract';
import type { StructureRoomMeta } from '../contract';
import {
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
import {
  U,
  bx,
  emitBaseAndMold,
  emitCeiling,
  emitWainscot,
  roomWallCoords,
  type B6,
  type TileTuple,
} from './shellTrim';
import { resolvePlatformRect } from './volume';

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

const collectSunkenMask = (input: InteriorRoomInput): ReadonlySet<string> => {
  const cut = new Set<string>();
  for (const vol of input.volumes) {
    if (vol.kind !== 'sunken') continue;
    const { ox, oz, w, d } = resolvePlatformRect(input, vol);
    for (let z = oz; z < oz + d; z += 1) for (let x = ox; x < ox + w; x += 1) cut.add(`${x},${z}`);
  }
  return cut;
};

const emitFloorPattern = (
  from: IntVec3,
  to: IntVec3,
  pat: FloorPatternStyle,
  p: TileTuple,
  cutMask: ReadonlySet<string>,
): readonly SubVoxelBoxIR[] => {
  const out: SubVoxelBoxIR[] = [];
  const fy = (from[1] + 1) * U;
  for (let z = from[2] + 1; z <= to[2] - 1; z += 1) {
    for (let x = from[0] + 1; x <= to[0] - 1; x += 1)
      if (!cutMask.has(`${x},${z}`)) emitFloorCell(x, z, fy, pat, p, out);
  }
  return out;
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
    ...emitFloorPattern(from, to, arch.floor_pattern, p, collectSunkenMask(input)),
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
