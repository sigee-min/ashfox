import { compareText } from '@ashfox/internal-contracts';
import type { CardinalFacing, IntVec3 } from '../../../project/structure/contract';
import type { StructureGrid } from '../contract';
import { encodeStructureNbt } from '../nbt';
import {
  MIN_VANILLA_HEADROOM_BLOCKS,
  SUBVOXEL_UNITS_PER_BLOCK,
  VANILLA_NBT_DATA_VERSION,
  type AlcoveVolumeSpec,
  type InteriorOpeningSpan,
  type InteriorRoomInput,
  type InteriorSubVoxelIR,
  type MezzanineVolumeSpec,
  type PartitionVolumeSpec,
  type PlatformVolumeSpec,
  type RailingStyle,
  type StyleDnaArch,
  type VanillaNbtBlockCell,
  type VanillaNbtLoweringIR,
} from './contract';

interface ArchVanillaPalette {
  readonly floor: string;
  readonly wall: string;
  readonly trim: string;
  readonly slab: string;
  readonly door: string;
  readonly light: string;
}

const pal = (spec: string): ArchVanillaPalette => {
  const [floor = '', wall = '', trim = '', slab = '', door = '', light = ''] = spec.split('|');
  return { floor, wall, trim, slab, door, light };
};

const VANILLA_BY_ARCH: Readonly<Record<StyleDnaArch, ArchVanillaPalette>> = {
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

const railStateFor = (style: RailingStyle, arch: StyleDnaArch): string => {
  if (style === 'iron' || style === 'cable') return 'minecraft:iron_bars';
  if (style === 'glass') return 'minecraft:glass_pane';
  if (style === 'shoji') return 'minecraft:birch_fence';
  return arch === 'gothic' ? 'minecraft:stone_brick_wall' : 'minecraft:oak_fence';
};

const isPassableVanillaState = (state: string): boolean =>
  state === 'minecraft:air' ||
  state.includes('_door') ||
  state.includes('_carpet') ||
  state.includes('torch') ||
  state.includes('lantern');

const isWallMountableState = (state: string): boolean =>
  state.includes('torch') ||
  state.includes('lantern') ||
  state.includes('trapdoor') ||
  state.includes('pane') ||
  state.includes('bars') ||
  state.includes('fence') ||
  state.includes('slab');

const isHangingState = (state: string): boolean =>
  state.includes('hanging=true') || state.includes('chain') || state.includes('sea_lantern');

interface LowerCtx {
  readonly w: number;
  readonly h: number;
  readonly d: number;
  readonly off: IntVec3;
  readonly cells: string[];
  readonly protectedClear: Uint8Array;
  readonly pal: ArchVanillaPalette;
  readonly room: InteriorRoomInput;
}

const idxOf = (c: LowerCtx, lx: number, ly: number, lz: number): number =>
  (ly * c.d + lz) * c.w + lx;
const inBounds = (c: LowerCtx, lx: number, ly: number, lz: number): boolean =>
  lx >= 0 && lx < c.w && ly >= 0 && ly < c.h && lz >= 0 && lz < c.d;

const setCell = (c: LowerCtx, lx: number, ly: number, lz: number, state: string): void => {
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

const fillBaseShell = (c: LowerCtx): void => {
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

const applyOpeningsAndClearance = (c: LowerCtx): void => {
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

const applyPlatformVolume = (c: LowerCtx, vol: PlatformVolumeSpec): void => {
  if (vol.kind === 'sunken' || c.h < MIN_VANILLA_HEADROOM_BLOCKS + 3) return;
  const x0 = vol.from ? vol.from[0] - c.off[0] : 1;
  const z0 = vol.from ? vol.from[1] - c.off[2] : 1;
  const x1 = Math.min(c.w - 2, x0 + vol.size[0] - 1);
  const z1 = Math.min(c.d - 2, z0 + vol.size[1] - 1);
  for (let lz = Math.max(1, z0); lz <= z1; lz += 1) {
    for (let lx = Math.max(1, x0); lx <= x1; lx += 1) setCell(c, lx, 1, lz, c.pal.slab);
  }
};

const spanRange = (
  lo: number,
  hi: number,
  on: CardinalFacing,
  a: CardinalFacing,
  b: CardinalFacing,
  d: number,
): readonly [number, number] =>
  on === b ? [Math.max(lo, hi - d + 1), hi] : on === a ? [lo, Math.min(hi, lo + d - 1)] : [lo, hi];

const applyMezzanineRailing = (
  c: LowerCtx,
  vol: MezzanineVolumeSpec,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  yDeck: number,
): void => {
  if (vol.railing === 'none') return;
  const rail = railStateFor(vol.railing, c.room.style_dna.arch);
  const alongX = vol.on === 'north' || vol.on === 'south';
  const edgeMap: Record<CardinalFacing, number> = { north: z1, south: z0, west: x1, east: x0 };
  const fixed = edgeMap[vol.on];
  const [u0, u1] = alongX ? [x0, x1] : [z0, z1];
  for (let u = u0; u <= u1; u += 1)
    setCell(c, alongX ? u : fixed, yDeck + 1, alongX ? fixed : u, rail);
};

const applyMezzanineVolume = (c: LowerCtx, vol: MezzanineVolumeSpec): void => {
  const yDeck = vol.y_offset_b !== undefined ? vol.y_offset_b + 1 : Math.floor(c.h * 0.5);
  if (yDeck - 1 < MIN_VANILLA_HEADROOM_BLOCKS || c.h - 2 - yDeck < MIN_VANILLA_HEADROOM_BLOCKS)
    return;
  const [x0, x1] = spanRange(1, c.w - 2, vol.on, 'west', 'east', vol.depth);
  const [z0, z1] = spanRange(1, c.d - 2, vol.on, 'north', 'south', vol.depth);
  for (let lz = z0; lz <= z1; lz += 1) {
    for (let lx = x0; lx <= x1; lx += 1) setCell(c, lx, yDeck, lz, c.pal.slab);
  }
  applyMezzanineRailing(c, vol, x0, x1, z0, z1, yDeck);
  if (vol.support_pillars === false) return;
  for (const px of [x0, x1]) {
    for (const pz of [z0, z1]) {
      for (let ly = 1; ly < yDeck; ly += 1) setCell(c, px, ly, pz, c.pal.trim);
    }
  }
};

const alcoveBaseState = (kind: AlcoveVolumeSpec['alcove_kind'], dy: number): string => {
  if (dy !== 0) return 'minecraft:air';
  return kind === 'fireplace'
    ? 'minecraft:campfire'
    : kind === 'cryo_pod'
      ? 'minecraft:sea_lantern'
      : 'minecraft:air';
};

const applyAlcoveVolume = (c: LowerCtx, vol: AlcoveVolumeSpec): void => {
  const alongX = vol.wall === 'north' || vol.wall === 'south';
  const wallMap: Record<CardinalFacing, number> = {
    north: 0,
    west: 0,
    south: c.d - 1,
    east: c.w - 1,
  };
  const fixed = wallMap[vol.wall];
  const u0 = 1 + vol.at_u;
  const stateAt = (dy: number) => alcoveBaseState(vol.alcove_kind, dy);
  for (let du = 0; du < vol.width_b; du += 1) {
    for (let dy = 0; dy < vol.height_b; dy += 1) {
      const [lx, ly, lz] = alongX ? [u0 + du, 1 + dy, fixed] : [fixed, 1 + dy, u0 + du];
      if (inBounds(c, lx, ly, lz)) c.cells[idxOf(c, lx, ly, lz)] = stateAt(dy);
    }
  }
};

const applyPartitionCol = (
  c: LowerCtx,
  vol: PartitionVolumeSpec,
  lx: number,
  lz: number,
  inDoor: boolean,
  partState: string,
): void => {
  if (inDoor) {
    for (let ly = 1; ly <= Math.min(2, c.h - 2); ly += 1) {
      if (inBounds(c, lx, ly, lz)) c.protectedClear[idxOf(c, lx, ly, lz)] = 1;
    }
    return;
  }
  const maxY = vol.style === 'booth' || vol.style === 'screen' ? 2 : c.h - 2;
  for (let ly = 1; ly <= maxY; ly += 1) setCell(c, lx, ly, lz, partState);
};

const applyPartitionVolume = (c: LowerCtx, vol: PartitionVolumeSpec): void => {
  const alongX = vol.axis === 'x';
  const [baseU, baseF] = alongX ? [c.off[0], c.off[2]] : [c.off[2], c.off[0]];
  const fixed = vol.at_pos - baseF;
  const [s0, s1] = [vol.span_from - baseU, vol.span_to - baseU];
  const doorAt = (vol.doorway_at ?? Math.floor((vol.span_from + vol.span_to) / 2)) - baseU;
  const doorW = Math.max(2, vol.doorway_width ?? 2);
  const partState =
    vol.style === 'colonnade'
      ? c.pal.trim
      : vol.style === 'glass_wall'
        ? 'minecraft:glass_pane'
        : 'minecraft:oak_fence';
  for (let u = s0; u <= s1; u += 1) {
    const inDoor = u >= doorAt && u < doorAt + doorW;
    if (!inDoor && vol.style === 'colonnade' && (u - s0) % 2 !== 0) continue;
    applyPartitionCol(c, vol, alongX ? u : fixed, alongX ? fixed : u, inDoor, partState);
  }
};

const lowerSubVoxelBoxes = (c: LowerCtx, subVoxelIR: InteriorSubVoxelIR): void => {
  const shellPrefixes = [
    'floor_',
    'baseboard_',
    'wainscot_',
    'molding_',
    'ceiling_',
    'volume_',
    'mezzanine_',
    'partition_',
    'alcove_',
    'truss_',
  ];
  for (const box of subVoxelIR.boxes) {
    if (box.semantic_tag && shellPrefixes.some((p) => box.semantic_tag!.startsWith(p))) continue;
    if (box.layer !== 'emissive') continue;
    const lx =
      Math.floor((box.from_16[0] + box.to_16[0]) / (2 * SUBVOXEL_UNITS_PER_BLOCK)) - c.off[0];
    const ly = Math.floor(box.from_16[1] / SUBVOXEL_UNITS_PER_BLOCK) - c.off[1];
    const lz =
      Math.floor((box.from_16[2] + box.to_16[2]) / (2 * SUBVOXEL_UNITS_PER_BLOCK)) - c.off[2];
    if (ly >= 1 && ly < c.h - 1) setCell(c, lx, ly, lz, c.pal.light);
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

const runFloatingPrunePass = (c: LowerCtx): boolean => {
  let changed = false;
  for (let ly = 1; ly < c.h - 1; ly += 1) {
    for (let lz = 1; lz < c.d - 1; lz += 1) {
      for (let lx = 1; lx < c.w - 1; lx += 1) {
        if (pruneFloatingCell(c, lx, ly, lz)) changed = true;
      }
    }
  }
  return changed;
};

const columnHeadroom = (c: LowerCtx, lx: number, lz: number): number => {
  if (!isPassableVanillaState(c.cells[idxOf(c, lx, 1, lz)]!)) return c.h;
  let run = 0;
  for (let ly = 1; ly < c.h; ly += 1) {
    if (!isPassableVanillaState(c.cells[idxOf(c, lx, ly, lz)]!)) break;
    run += 1;
  }
  return run;
};

const computeMinHeadroom = (c: LowerCtx): number => {
  let minHead = c.h;
  for (let lz = 1; lz < c.d - 1; lz += 1) {
    for (let lx = 1; lx < c.w - 1; lx += 1) minHead = Math.min(minHead, columnHeadroom(c, lx, lz));
  }
  return minHead;
};

const countBlockedProtected = (c: LowerCtx): number => {
  let blocked = 0;
  for (let i = 0; i < c.cells.length; i += 1) {
    if (c.protectedClear[i] && !isPassableVanillaState(c.cells[i]!)) blocked += 1;
  }
  return blocked;
};

const applyVolumes = (ctx: LowerCtx, room: InteriorRoomInput): void => {
  for (const vol of room.volumes) {
    if (vol.kind === 'platform' || vol.kind === 'sunken') applyPlatformVolume(ctx, vol);
    else if (vol.kind === 'mezzanine') applyMezzanineVolume(ctx, vol);
    else if (vol.kind === 'alcove') applyAlcoveVolume(ctx, vol);
    else if (vol.kind === 'partition') applyPartitionVolume(ctx, vol);
  }
};

const collectLoweredBlocks = (ctx: LowerCtx): readonly VanillaNbtBlockCell[] => {
  const blocks: VanillaNbtBlockCell[] = [];
  for (let ly = 0; ly < ctx.h; ly += 1) {
    for (let lz = 0; lz < ctx.d; lz += 1) {
      for (let lx = 0; lx < ctx.w; lx += 1) {
        blocks.push({ pos: [lx, ly, lz], state: ctx.cells[idxOf(ctx, lx, ly, lz)]! });
      }
    }
  }
  return blocks;
};

/** Deterministically lowers an interior room into vanilla Minecraft `.nbt` IR (DataVersion 3955). */
export const lowerInteriorToVanillaNbt = (
  room: InteriorRoomInput,
  subVoxelIR?: InteriorSubVoxelIR,
): VanillaNbtLoweringIR => {
  const [w, h, d] = [
    Math.max(3, room.bounds_to[0] - room.bounds_from[0] + 1),
    Math.max(4, room.bounds_to[1] - room.bounds_from[1] + 1),
    Math.max(3, room.bounds_to[2] - room.bounds_from[2] + 1),
  ];
  const ctx: LowerCtx = {
    w,
    h,
    d,
    off: room.bounds_from,
    cells: new Array<string>(w * h * d).fill('minecraft:air'),
    protectedClear: new Uint8Array(w * h * d),
    pal: VANILLA_BY_ARCH[room.style_dna.arch],
    room,
  };
  fillBaseShell(ctx);
  applyOpeningsAndClearance(ctx);
  applyVolumes(ctx, room);
  if (subVoxelIR) lowerSubVoxelBoxes(ctx, subVoxelIR);
  while (runFloatingPrunePass(ctx)) continue;
  const min_headroom_b = computeMinHeadroom(ctx);
  const blocked_opening_count = countBlockedProtected(ctx);
  const palette = [
    'minecraft:air',
    ...[...new Set(ctx.cells)].filter((s) => s !== 'minecraft:air').sort(compareText),
  ];
  return {
    data_version: VANILLA_NBT_DATA_VERSION,
    size: [w, h, d],
    palette,
    blocks: collectLoweredBlocks(ctx),
    clearance: {
      min_headroom_b,
      floating_block_count: 0,
      blocked_opening_count,
      passed: min_headroom_b >= MIN_VANILLA_HEADROOM_BLOCKS && blocked_opening_count === 0,
    },
  };
};

/** Encodes a VanillaNbtLoweringIR into gzip-compressed vanilla `.nbt` bytes via the shared NBT encoder. */
export const encodeLoweredVanillaNbt = (
  lowering: VanillaNbtLoweringIR,
  id = 'interior',
): Uint8Array => {
  const [w, h, d] = lowering.size;
  const idxByState = new Map<string, number>(lowering.palette.map((s, i) => [s, i]));
  const voxels = new Int32Array(w * h * d).fill(-1);
  for (const cell of lowering.blocks) {
    const [x, y, z] = cell.pos;
    voxels[(y * d + z) * w + x] = idxByState.get(cell.state) ?? 0;
  }
  const grid: StructureGrid = {
    id,
    dataVersion: lowering.data_version,
    density: 2,
    seed: 1,
    size: lowering.size,
    states: lowering.palette,
    voxels,
    customTags: new Array<string | null>(w * h * d).fill(null),
    customPlacements: [],
    floors: [],
    rooms: [],
    openings: [],
    sockets: [],
    hasRoofTrim: false,
    roofCount: 0,
    dormerCount: 0,
    chimneyCount: 0,
    semanticStats: {
      roomCount: 1,
      facadeCount: 0,
      stairCount: 0,
      furnishCount: 0,
      weatheringCount: 0,
      rawSetCount: 0,
    },
  };
  return encodeStructureNbt(grid);
};
