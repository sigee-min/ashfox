import { compareText } from '@ashfox/internal-contracts';
import type { CardinalFacing } from '../../../project/structure/contract';
import type { StructureGrid } from '../contract';
import { encodeStructureNbt } from '../nbt';
import {
  MIN_VANILLA_HEADROOM_BLOCKS,
  SUBVOXEL_UNITS_PER_BLOCK,
  VANILLA_NBT_DATA_VERSION,
  type AlcoveVolumeSpec,
  type InteriorRoomInput,
  type InteriorSubVoxelIR,
  type MezzanineVolumeSpec,
  type PartitionVolumeSpec,
  type PlatformVolumeSpec,
  type VanillaNbtLoweringIR,
} from './contract';
import {
  VANILLA_BY_ARCH,
  alcoveBaseState,
  applyOpeningsAndClearance,
  collectLoweredBlocks,
  computeMinHeadroom,
  countBlockedProtected,
  fillBaseShell,
  idxOf,
  inBounds,
  partitionBlockState,
  railStateFor,
  runFloatingPrunePass,
  setCell,
  type LowerCtx,
} from './nbtBlocks';
import { resolvePartitionDoorway, resolvePartitionSpan, resolvePlatformRect } from './zoneRect';

const applyPlatformVolume = (c: LowerCtx, vol: PlatformVolumeSpec): void => {
  if (vol.kind !== 'sunken' && c.h < MIN_VANILLA_HEADROOM_BLOCKS + 3) return;
  const rect = resolvePlatformRect(c.room, vol);
  const [x0, z0] = [rect.ox - c.off[0], rect.oz - c.off[2]];
  const [x1, z1] = [Math.min(c.w - 2, x0 + rect.w - 1), Math.min(c.d - 2, z0 + rect.d - 1)];
  const ly = vol.kind === 'sunken' ? 0 : 1;
  for (let lz = Math.max(1, z0); lz <= z1; lz += 1) {
    for (let lx = Math.max(1, x0); lx <= x1; lx += 1) setCell(c, lx, ly, lz, c.pal.slab);
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
  const edgeMap: Record<CardinalFacing, number> = {
    north: z1,
    south: z0,
    west: x1,
    east: x0,
  };
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
  const span = resolvePartitionSpan(c.room, vol);
  if (!span) return;
  const alongX = vol.axis === 'x';
  const [baseU, baseF] = alongX ? [c.off[0], c.off[2]] : [c.off[2], c.off[0]];
  const fixed = vol.at_pos - baseF;
  const [s0, s1] = [span[0] - baseU, span[1] - baseU];
  const origS0 = vol.span_from - baseU;
  const { doorAt: rawDoorAt, doorW } = resolvePartitionDoorway(vol);
  const doorAt = rawDoorAt - baseU;
  const partState = partitionBlockState(vol.style, c.pal);
  for (let u = s0; u <= s1; u += 1) {
    const inDoor = u >= doorAt && u < doorAt + doorW;
    if (!inDoor && vol.style === 'colonnade' && (u - origS0) % 2 !== 0) continue;
    applyPartitionCol(c, vol, alongX ? u : fixed, alongX ? fixed : u, inDoor, partState);
  }
};

const SHELL_PREFIXES = [
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

const lowerSubVoxelBoxes = (c: LowerCtx, subVoxelIR: InteriorSubVoxelIR): void => {
  for (const box of subVoxelIR.boxes) {
    if (box.semantic_tag && SHELL_PREFIXES.some((p) => box.semantic_tag!.startsWith(p))) continue;
    if (box.layer !== 'emissive') continue;
    const lx =
      Math.floor((box.from_16[0] + box.to_16[0]) / (2 * SUBVOXEL_UNITS_PER_BLOCK)) - c.off[0];
    const ly = Math.floor(box.from_16[1] / SUBVOXEL_UNITS_PER_BLOCK) - c.off[1];
    const lz =
      Math.floor((box.from_16[2] + box.to_16[2]) / (2 * SUBVOXEL_UNITS_PER_BLOCK)) - c.off[2];
    if (ly >= 1 && ly < c.h - 1) setCell(c, lx, ly, lz, c.pal.light);
  }
};

const applyVolumes = (ctx: LowerCtx, room: InteriorRoomInput): void => {
  for (const vol of room.volumes) {
    if (vol.kind === 'platform' || vol.kind === 'sunken') applyPlatformVolume(ctx, vol);
    else if (vol.kind === 'mezzanine') applyMezzanineVolume(ctx, vol);
    else if (vol.kind === 'alcove') applyAlcoveVolume(ctx, vol);
    else if (vol.kind === 'partition') applyPartitionVolume(ctx, vol);
  }
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
