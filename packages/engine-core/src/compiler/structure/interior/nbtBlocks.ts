import type { CardinalFacing, IntVec3 } from '../../../project/structure/contract';
import {
  type AlcoveVolumeSpec,
  type InteriorOpeningSpan,
  type InteriorRoomInput,
  type PartitionVolumeSpec,
  type RailingStyle,
  type StyleDnaArch,
  type VanillaNbtBlockCell,
} from './contract';

export interface ArchVanillaPalette {
  readonly floor: string;
  readonly wall: string;
  readonly trim: string;
  readonly slab: string;
  readonly door: string;
  readonly light: string;
}

export interface LowerCtx {
  readonly w: number;
  readonly h: number;
  readonly d: number;
  readonly off: IntVec3;
  readonly cells: string[];
  readonly protectedClear: Uint8Array;
  readonly pal: ArchVanillaPalette;
  readonly room: InteriorRoomInput;
}

const pal = (spec: string): ArchVanillaPalette => {
  const [floor = '', wall = '', trim = '', slab = '', door = '', light = ''] = spec.split('|');
  return { floor, wall, trim, slab, door, light };
};

export const VANILLA_BY_ARCH: Readonly<Record<StyleDnaArch, ArchVanillaPalette>> = {
  rustic: pal(
    'minecraft:oak_planks|minecraft:white_terracotta|minecraft:dark_oak_log[axis=y]|minecraft:oak_slab[type=bottom]|minecraft:oak_door|minecraft:lantern[hanging=true]',
  ),
  japanese: pal(
    'minecraft:birch_planks|minecraft:calcite|minecraft:spruce_log[axis=y]|minecraft:birch_slab[type=bottom]|minecraft:birch_door|minecraft:lantern[hanging=true]',
  ),
  modern: pal(
    'minecraft:birch_planks|minecraft:white_concrete|minecraft:dark_oak_planks|minecraft:smooth_stone_slab[type=bottom]|minecraft:dark_oak_door|minecraft:sea_lantern',
  ),
  scifi: pal(
    'minecraft:deepslate_tiles|minecraft:iron_block|minecraft:deepslate_bricks|minecraft:deepslate_tile_slab[type=bottom]|minecraft:iron_door|minecraft:sea_lantern',
  ),
  gothic: pal(
    'minecraft:deepslate_bricks|minecraft:stone_bricks|minecraft:chiseled_stone_bricks|minecraft:stone_brick_slab[type=bottom]|minecraft:dark_oak_door|minecraft:soul_lantern[hanging=true]',
  ),
  desert: pal(
    'minecraft:terracotta|minecraft:calcite|minecraft:oak_planks|minecraft:oak_slab[type=bottom]|minecraft:oak_door|minecraft:lantern[hanging=true]',
  ),
  industrial: pal(
    'minecraft:cobblestone|minecraft:bricks|minecraft:iron_block|minecraft:stone_brick_slab[type=bottom]|minecraft:iron_door|minecraft:lantern[hanging=true]',
  ),
  nordic: pal(
    'minecraft:spruce_planks|minecraft:birch_planks|minecraft:spruce_log[axis=y]|minecraft:spruce_slab[type=bottom]|minecraft:spruce_door|minecraft:lantern[hanging=true]',
  ),
};

const INWARD: Readonly<Record<CardinalFacing, readonly [number, number]>> = {
  north: [0, 1],
  south: [0, -1],
  west: [1, 0],
  east: [-1, 0],
};

export const railStateFor = (style: RailingStyle, arch: StyleDnaArch): string => {
  if (style === 'iron' || style === 'cable') return 'minecraft:iron_bars';
  if (style === 'glass') return 'minecraft:glass_pane';
  if (style === 'shoji') return 'minecraft:birch_fence';
  return arch === 'gothic' ? 'minecraft:stone_brick_wall' : 'minecraft:oak_fence';
};

export const alcoveBaseState = (kind: AlcoveVolumeSpec['alcove_kind'], dy: number): string => {
  if (dy !== 0) return 'minecraft:air';
  return kind === 'fireplace'
    ? 'minecraft:campfire'
    : kind === 'cryo_pod'
      ? 'minecraft:sea_lantern'
      : 'minecraft:air';
};

export const partitionBlockState = (
  style: PartitionVolumeSpec['style'],
  palEntry: ArchVanillaPalette,
): string =>
  style === 'colonnade'
    ? palEntry.trim
    : style === 'glass_wall'
      ? 'minecraft:glass_pane'
      : 'minecraft:oak_fence';

export const isPassableVanillaState = (s: string): boolean =>
  s === 'minecraft:air' ||
  s.includes('_door') ||
  s.includes('_carpet') ||
  s.includes('torch') ||
  (s.includes('lantern') && !s.includes('sea_lantern'));

const WALL_MOUNT_KEYS = ['torch', 'trapdoor', 'pane', 'bars', 'fence', 'slab'];
const isWallMountableState = (s: string): boolean =>
  WALL_MOUNT_KEYS.some((k) => s.includes(k)) ||
  (s.includes('lantern') && !s.includes('sea_lantern'));

const isHangingState = (state: string): boolean =>
  state.includes('hanging=true') || state.includes('chain');

export const idxOf = (c: LowerCtx, lx: number, ly: number, lz: number): number =>
  (ly * c.d + lz) * c.w + lx;

export const inBounds = (c: LowerCtx, lx: number, ly: number, lz: number): boolean =>
  lx >= 0 && lx < c.w && ly >= 0 && ly < c.h && lz >= 0 && lz < c.d;

export const setCell = (c: LowerCtx, lx: number, ly: number, lz: number, state: string): void => {
  if (!inBounds(c, lx, ly, lz)) return;
  const i = idxOf(c, lx, ly, lz);
  if (c.protectedClear[i] && !isPassableVanillaState(state)) return;
  c.cells[i] = state;
};

const fillShellCell = (c: LowerCtx, lx: number, ly: number, lz: number): void => {
  const perim = lx === 0 || lx === c.w - 1 || lz === 0 || lz === c.d - 1;
  const corner = (lx === 0 || lx === c.w - 1) && (lz === 0 || lz === c.d - 1);
  if (ly === 0) c.cells[idxOf(c, lx, ly, lz)] = corner ? c.pal.trim : c.pal.floor;
  else if (ly === c.h - 1)
    c.cells[idxOf(c, lx, ly, lz)] = c.room.kind === 'courtyard' ? 'minecraft:air' : c.pal.trim;
  else if (perim) c.cells[idxOf(c, lx, ly, lz)] = corner ? c.pal.trim : c.pal.wall;
};

export const fillBaseShell = (c: LowerCtx): void => {
  for (let ly = 0; ly < c.h; ly += 1) {
    for (let lz = 0; lz < c.d; lz += 1) {
      for (let lx = 0; lx < c.w; lx += 1) fillShellCell(c, lx, ly, lz);
    }
  }
};

const applyOpeningCell = (
  c: LowerCtx,
  op: InteriorOpeningSpan,
  lx: number,
  ly: number,
  lz: number,
  y0: number,
): void => {
  if (!inBounds(c, lx, ly, lz)) return;
  const idx = idxOf(c, lx, ly, lz);
  if (op.kind === 'window' || op.kind === 'bay_window') {
    c.cells[idx] = 'minecraft:glass_pane';
  } else {
    const isDoor = op.kind === 'door' && ly <= y0 + 1;
    const half = ly === y0 ? 'lower' : 'upper';
    c.cells[idx] = isDoor
      ? `${c.pal.door}[facing=${op.wall},half=${half},hinge=${op.hinge ?? 'left'},open=false]`
      : 'minecraft:air';
    c.protectedClear[idx] = 1;
  }
  const [ix, iz] = INWARD[op.wall];
  if (inBounds(c, lx + ix, ly, lz + iz)) {
    const inIdx = idxOf(c, lx + ix, ly, lz + iz);
    c.protectedClear[inIdx] = 1;
    c.cells[inIdx] = 'minecraft:air';
  }
};

export const applyOpeningsAndClearance = (c: LowerCtx): void => {
  for (const op of c.room.openings) {
    const [x0, y0, z0] = [op.from[0] - c.off[0], op.from[1] - c.off[1], op.from[2] - c.off[2]];
    const [x1, y1, z1] = [op.to[0] - c.off[0], op.to[1] - c.off[1], op.to[2] - c.off[2]];
    for (let ly = y0; ly <= y1; ly += 1) {
      for (let lz = z0; lz <= z1; lz += 1) {
        for (let lx = x0; lx <= x1; lx += 1) applyOpeningCell(c, op, lx, ly, lz, y0);
      }
    }
  }
};

const hasHorizontalSupport = (c: LowerCtx, lx: number, ly: number, lz: number): boolean => {
  const dirs: readonly [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  return dirs.some(([dx, dz]) => {
    const nx = lx + dx;
    const nz = lz + dz;
    return inBounds(c, nx, ly, nz) && !isPassableVanillaState(c.cells[idxOf(c, nx, ly, nz)]!);
  });
};

const pruneFloatingCell = (c: LowerCtx, lx: number, ly: number, lz: number): boolean => {
  const i = idxOf(c, lx, ly, lz);
  const s = c.cells[i]!;
  if (s === 'minecraft:air') return false;
  const below = c.cells[idxOf(c, lx, ly - 1, lz)]!;
  const above = c.cells[idxOf(c, lx, ly + 1, lz)]!;
  const supported =
    below !== 'minecraft:air' ||
    (isHangingState(s) && above !== 'minecraft:air') ||
    (isWallMountableState(s) && hasHorizontalSupport(c, lx, ly, lz));
  if (supported) return false;
  c.cells[i] = 'minecraft:air';
  return true;
};

export const runFloatingPrunePass = (c: LowerCtx): boolean => {
  let changed = false;
  for (let ly = 1; ly < c.h - 1; ly += 1) {
    for (let lz = 1; lz < c.d - 1; lz += 1)
      for (let lx = 1; lx < c.w - 1; lx += 1) if (pruneFloatingCell(c, lx, ly, lz)) changed = true;
  }
  return changed;
};

const columnHeadroom = (c: LowerCtx, lx: number, lz: number): number => {
  if (!isPassableVanillaState(c.cells[idxOf(c, lx, 1, lz)]!)) return c.h;
  let run = 0;
  for (let ly = 1; ly < c.h && isPassableVanillaState(c.cells[idxOf(c, lx, ly, lz)]!); ly += 1)
    run += 1;
  return run;
};

export const computeMinHeadroom = (c: LowerCtx): number => {
  let minHead = c.h;
  for (let lz = 1; lz < c.d - 1; lz += 1)
    for (let lx = 1; lx < c.w - 1; lx += 1) minHead = Math.min(minHead, columnHeadroom(c, lx, lz));
  return minHead;
};

export const countBlockedProtected = (c: LowerCtx): number => {
  let blocked = 0;
  for (let i = 0; i < c.cells.length; i += 1)
    if (c.protectedClear[i] && !isPassableVanillaState(c.cells[i]!)) blocked += 1;
  return blocked;
};

export const collectLoweredBlocks = (ctx: LowerCtx): readonly VanillaNbtBlockCell[] => {
  const blocks: VanillaNbtBlockCell[] = [];
  for (let ly = 0; ly < ctx.h; ly += 1)
    for (let lz = 0; lz < ctx.d; lz += 1)
      for (let lx = 0; lx < ctx.w; lx += 1)
        blocks.push({
          pos: [lx, ly, lz],
          state: ctx.cells[idxOf(ctx, lx, ly, lz)]!,
        });
  return blocks;
};
