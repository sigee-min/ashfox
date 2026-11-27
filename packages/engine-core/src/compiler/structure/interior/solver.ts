import {
  MIN_VANILLA_HEADROOM_BLOCKS,
  SUBVOXEL_UNITS_PER_BLOCK,
  type InteriorPropSpec,
  type InteriorRoomInput,
  type InteriorStorySpec,
  type PartitionVolumeSpec,
  type PlayableInteriorHook,
  type SubVoxelBoxIR,
} from './contract';
import type { IntVec3 } from '../../../project/structure/contract';
import type { Vec3 } from '../../../model/identity';
import { compileAllDraperies } from './drapery';
import { compileInteriorProps, type CustomPropMount } from './props';
import { hashSeed01 } from './propsGeo';
import { compileStoryVignette } from './vignettes';
import {
  DIRS_4,
  TALL_WALL_PROPS,
  addOccupied,
  boxCellRange16,
  cellKey,
  collectDoorClearZones,
  collectWindowZones,
  isCellBlockedAt,
  openingInwardCell,
  propFitsBounds,
  propFootprintCoords,
  propSpanY,
  resolveMezzanineYOffset,
  resolvePartitionDoorway,
  resolvePartitionSpan,
  resolveZoneRect,
  type OccupiedMap,
  type ZoneFootprint,
} from './zoneRect';

export interface ClearPathReport {
  readonly clear_path_cells: readonly IntVec3[];
  readonly walkable_ratio: number;
  readonly min_headroom_b: number;
  readonly blocked_opening_count: number;
  readonly blocked_seat_count: number;
  readonly blocked_stair_count: number;
  readonly passed: boolean;
}

export interface ResolvedPropPlacement {
  readonly id: string;
  readonly original_at: Vec3;
  readonly resolved_at: Vec3;
  readonly nudged: boolean;
  readonly surface_y_16: number;
}

export interface SolvedRoomLayout {
  readonly boxes: readonly SubVoxelBoxIR[];
  readonly custom_mounts: readonly CustomPropMount[];
  readonly hooks: readonly PlayableInteriorHook[];
  readonly clearance: ClearPathReport;
  readonly placed_props: readonly ResolvedPropPlacement[];
  readonly resolved_room: InteriorRoomInput;
}

const collectStairCells = (room: InteriorRoomInput): OccupiedMap => {
  const out: OccupiedMap = new Map();
  const iy0 = room.bounds_from[1] + 1;
  for (const vol of room.volumes) {
    if (vol.kind === 'mezzanine' && vol.stair_at) {
      const y1 = iy0 + resolveMezzanineYOffset(room, vol.y_offset_b);
      addOccupied(out, cellKey(vol.stair_at[0], vol.stair_at[1]), iy0, y1);
    }
  }
  return out;
};

const collectPartitionBlocked = (room: InteriorRoomInput): ReadonlySet<string> => {
  const blocked = new Set<string>();
  const iy0 = room.bounds_from[1] + 1;
  for (const vol of room.volumes) {
    if (vol.kind !== 'partition') continue;
    addPartitionCells(room, vol, (k, y0) => {
      if (y0 < iy0 + MIN_VANILLA_HEADROOM_BLOCKS) blocked.add(k);
    });
  }
  return blocked;
};

const addPartitionCells = (
  room: InteriorRoomInput,
  vol: PartitionVolumeSpec,
  visit: (k: string, y0: number, y1: number) => void,
): void => {
  const span = resolvePartitionSpan(room, vol);
  if (!span) return;
  const [lo, hi] = span;
  const { doorAt, doorW } = resolvePartitionDoorway(vol);
  const y0 = room.bounds_from[1] + 1;
  const y1 =
    vol.style === 'booth'
      ? y0 + 18 / SUBVOXEL_UNITS_PER_BLOCK
      : vol.style === 'screen'
        ? y0 + 24 / SUBVOXEL_UNITS_PER_BLOCK
        : room.bounds_to[1];
  for (let u = lo; u <= hi; u += 1) {
    if (u >= doorAt && u < doorAt + doorW) continue;
    if (vol.style === 'colonnade' && (u - vol.span_from) % 2 !== 0) continue;
    const x = vol.axis === 'x' ? u : vol.at_pos;
    const z = vol.axis === 'z' ? u : vol.at_pos;
    visit(cellKey(x, z), y0, y1);
  }
};

const NON_WALK_OBSTACLE_PREFIXES =
  'drapery:,floor_,baseboard_,wainscot_,molding_,volume_platform,volume_step,volume_sunken,volume_mezzanine,window_pane_,partition_door,railing_'.split(
    ',',
  );

const isNonWalkObstacle = (tag: string): boolean =>
  NON_WALK_OBSTACLE_PREFIXES.some((p) => tag.startsWith(p));

const boxHeightClearance = (
  box: SubVoxelBoxIR,
  floorY16: number,
): { blocksWalk: boolean; ceilingTop16: number | null } => {
  const tag = box.semantic_tag ?? '';
  if (isNonWalkObstacle(tag)) return { blocksWalk: false, ceilingTop16: null };
  const relBot = box.from_16[1] - floorY16;
  const relTop = box.to_16[1] - floorY16;
  if (relTop <= 3.5) return { blocksWalk: false, ceilingTop16: null };
  if (relBot >= MIN_VANILLA_HEADROOM_BLOCKS * SUBVOXEL_UNITS_PER_BLOCK) {
    return { blocksWalk: false, ceilingTop16: box.from_16[1] };
  }
  return { blocksWalk: true, ceilingTop16: null };
};

interface WalkGrid {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly floorY: number;
  readonly blocked: ReadonlySet<string>;
  readonly headroomB: ReadonlyMap<string, number>;
}

const buildWalkGrid = (room: InteriorRoomInput, boxes: readonly SubVoxelBoxIR[]): WalkGrid => {
  const x0 = room.bounds_from[0] + 1;
  const x1 = room.bounds_to[0] - 1;
  const z0 = room.bounds_from[2] + 1;
  const z1 = room.bounds_to[2] - 1;
  const floorY = room.bounds_from[1] + 1;
  const floorY16 = floorY * SUBVOXEL_UNITS_PER_BLOCK;
  const defaultCeil16 = room.bounds_to[1] * SUBVOXEL_UNITS_PER_BLOCK;
  const blocked = new Set<string>(collectPartitionBlocked(room));
  const ceilMap = new Map<string, number>();
  for (const box of boxes) markBoxOnGrid(box, floorY16, blocked, ceilMap);
  const headroomB = new Map<string, number>();
  for (let z = z0; z <= z1; z += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const k = cellKey(x, z);
      const ceil16 = ceilMap.get(k) ?? defaultCeil16;
      headroomB.set(k, (ceil16 - floorY16) / SUBVOXEL_UNITS_PER_BLOCK);
    }
  }
  return { x0, x1, z0, z1, floorY, blocked, headroomB };
};

const markCellForBox = (
  k: string,
  blocksWalk: boolean,
  ceilingTop16: number | null,
  blocked: Set<string>,
  ceilMap: Map<string, number>,
): void => {
  if (blocksWalk) blocked.add(k);
  if (ceilingTop16 === null) return;
  const prev = ceilMap.get(k);
  if (prev === undefined || ceilingTop16 < prev) ceilMap.set(k, ceilingTop16);
};

const markBoxOnGrid = (
  box: SubVoxelBoxIR,
  floorY16: number,
  blocked: Set<string>,
  ceilMap: Map<string, number>,
): void => {
  const { blocksWalk, ceilingTop16 } = boxHeightClearance(box, floorY16);
  if (!blocksWalk && ceilingTop16 === null) return;
  const [bx0, bz0, bx1, bz1] = boxCellRange16(box);
  for (let z = bz0; z <= bz1; z += 1) {
    for (let x = bx0; x <= bx1; x += 1) {
      markCellForBox(cellKey(x, z), blocksWalk, ceilingTop16, blocked, ceilMap);
    }
  }
};

const isCellPassable = (grid: WalkGrid, x: number, z: number): boolean => {
  if (x < grid.x0 || x > grid.x1 || z < grid.z0 || z > grid.z1) return false;
  const k = cellKey(x, z);
  return !grid.blocked.has(k) && (grid.headroomB.get(k) ?? 0) >= MIN_VANILLA_HEADROOM_BLOCKS;
};

const runCirculationBfs = (grid: WalkGrid, seeds: readonly IntVec3[]): readonly IntVec3[] => {
  const visited = new Set<string>();
  const queue: IntVec3[] = [];
  for (const [sx, , sz] of seeds) {
    const k = cellKey(sx, sz);
    if (!visited.has(k) && isCellPassable(grid, sx, sz)) {
      visited.add(k);
      queue.push([sx, grid.floorY, sz]);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const [cx, , cz] = queue[head]!;
    for (const [dx, dz] of DIRS_4) {
      const nx = cx + dx;
      const nz = cz + dz;
      const nk = cellKey(nx, nz);
      if (!visited.has(nk) && isCellPassable(grid, nx, nz)) {
        visited.add(nk);
        queue.push([nx, grid.floorY, nz]);
      }
    }
  }
  return queue.sort((a, b) => a[2] - b[2] || a[0] - b[0]);
};

const countBlockedOpenings = (
  room: InteriorRoomInput,
  grid: WalkGrid,
  boxes: readonly SubVoxelBoxIR[],
): number => {
  let blocked = 0;
  for (const op of room.openings) {
    const [ix, , iz] = openingInwardCell(op);
    if (op.kind === 'window' || op.kind === 'bay_window') {
      const sillY16 = op.from[1] * SUBVOXEL_UNITS_PER_BLOCK;
      const hit = boxes.some((b) => {
        if ((b.semantic_tag ?? '').startsWith('drapery:')) return false;
        const bx0 = Math.floor(b.from_16[0] / 16);
        const bx1 = Math.floor((b.to_16[0] - 0.01) / 16);
        const bz0 = Math.floor(b.from_16[2] / 16);
        const bz1 = Math.floor((b.to_16[2] - 0.01) / 16);
        return ix >= bx0 && ix <= bx1 && iz >= bz0 && iz <= bz1 && b.to_16[1] > sillY16 + 6;
      });
      if (hit) blocked += 1;
    } else if (!isCellPassable(grid, ix, iz)) {
      blocked += 1;
    }
  }
  return blocked;
};

const countBlockedSeats = (
  hooks: readonly PlayableInteriorHook[],
  reachable: ReadonlySet<string>,
): number => {
  let blocked = 0;
  for (const h of hooks) {
    if (h.kind !== 'sit') continue;
    const sx = Math.floor(h.position[0]);
    const sz = Math.floor(h.position[2]);
    const ok =
      reachable.has(cellKey(sx, sz)) ||
      DIRS_4.some(([dx, dz]) => reachable.has(cellKey(sx + dx, sz + dz)));
    if (!ok) blocked += 1;
  }
  return blocked;
};

const resolveBfsSeeds = (room: InteriorRoomInput, grid: WalkGrid): readonly IntVec3[] => {
  const entrySeeds = room.openings
    .filter((o) => o.kind !== 'window' && o.kind !== 'bay_window')
    .map(openingInwardCell);
  if (entrySeeds.length > 0) return entrySeeds;
  for (let z = grid.z0; z <= grid.z1; z += 1) {
    for (let x = grid.x0; x <= grid.x1; x += 1) {
      if (isCellPassable(grid, x, z)) return [[x, grid.floorY, z]];
    }
  }
  return [];
};

const minHeadroomForCells = (grid: WalkGrid, cells: readonly IntVec3[]): number => {
  if (cells.length === 0) return 0;
  let minHeadroom = Number.POSITIVE_INFINITY;
  for (const [x, , z] of cells) {
    minHeadroom = Math.min(minHeadroom, grid.headroomB.get(cellKey(x, z)) ?? 0);
  }
  return Number.isFinite(minHeadroom) ? minHeadroom : 0;
};

/** Validates BFS clear_path connectivity, headroom >= 2, and zero blocked openings/stairs/seats. */
export const validateClearPath = (
  room: InteriorRoomInput,
  boxes: readonly SubVoxelBoxIR[],
  hooks: readonly PlayableInteriorHook[] = [],
): ClearPathReport => {
  const grid = buildWalkGrid(room, boxes);
  const clearCells = runCirculationBfs(grid, resolveBfsSeeds(room, grid));
  const reachable = new Set(clearCells.map(([x, , z]) => cellKey(x, z)));
  const blockedOpenings = countBlockedOpenings(room, grid, boxes);
  const stairs = collectStairCells(room);
  const blockedStairs = [...stairs.keys()].filter((k) => grid.blocked.has(k)).length;
  const blockedSeats = countBlockedSeats(hooks, reachable);
  const totalCells = Math.max(1, (grid.x1 - grid.x0 + 1) * (grid.z1 - grid.z0 + 1));
  const finalHeadroom = minHeadroomForCells(grid, clearCells);
  return {
    clear_path_cells: clearCells,
    walkable_ratio: clearCells.length / totalCells,
    min_headroom_b: finalHeadroom,
    blocked_opening_count: blockedOpenings,
    blocked_seat_count: blockedSeats,
    blocked_stair_count: blockedStairs,
    passed:
      blockedOpenings === 0 &&
      blockedSeats === 0 &&
      blockedStairs === 0 &&
      finalHeadroom >= MIN_VANILLA_HEADROOM_BLOCKS &&
      clearCells.length > 0,
  };
};

const canPlacePropAt = (
  spec: InteriorPropSpec,
  x: number,
  z: number,
  bounds: ZoneFootprint,
  occupied: OccupiedMap,
  doorClear: OccupiedMap,
  winClear: OccupiedMap,
  stairCells: OccupiedMap,
): boolean => {
  if (!propFitsBounds(spec, x, z, bounds)) return false;
  const coords = propFootprintCoords(spec, x, z, bounds);
  const allowWindow = !TALL_WALL_PROPS.has(spec.kind);
  const highMount = spec.mount_on === 'wall' || spec.mount_on === 'ceiling';
  const span = propSpanY(spec);
  return coords.every(([cx, cz]) => {
    if (cx < bounds.x0 || cx > bounds.x1 || cz < bounds.z0 || cz > bounds.z1) return false;
    const c = cellKey(cx, cz);
    return (
      !isCellBlockedAt(stairCells, c, span) &&
      (highMount ||
        (!isCellBlockedAt(occupied, c, span) && !isCellBlockedAt(doorClear, c, span))) &&
      (allowWindow || !isCellBlockedAt(winClear, c, span))
    );
  });
};

const findCandidatePlacement = (
  spec: InteriorPropSpec,
  room: InteriorRoomInput,
  occupied: OccupiedMap,
  doorClear: OccupiedMap,
  winClear: OccupiedMap,
  stairCells: OccupiedMap,
): readonly [number, number] => {
  const bounds = resolveZoneRect(room, spec.zone_id);
  const sx = Math.round(spec.at[0]);
  const sz = Math.round(spec.at[2]);
  if (canPlacePropAt(spec, sx, sz, bounds, occupied, doorClear, winClear, stairCells)) {
    return [sx, sz];
  }
  const candidates: [number, number, number][] = [];
  for (let z = bounds.z0; z <= bounds.z1; z += 1) {
    for (let x = bounds.x0; x <= bounds.x1; x += 1) {
      if (canPlacePropAt(spec, x, z, bounds, occupied, doorClear, winClear, stairCells)) {
        const dist =
          Math.abs(x - sx) + Math.abs(z - sz) + hashSeed01(room.seed, `${spec.id}:${x},${z}`) * 0.1;
        candidates.push([dist, x, z]);
      }
    }
  }
  candidates.sort((a, b) => a[0] - b[0]);
  return candidates.length > 0 ? [candidates[0]![1], candidates[0]![2]] : [sx, sz];
};

const addStructuralBoxCells = (box: SubVoxelBoxIR, occupied: OccupiedMap): void => {
  const [bx0, bz0, bx1, bz1] = boxCellRange16(box);
  const [y0, y1] = [
    box.from_16[1] / SUBVOXEL_UNITS_PER_BLOCK,
    box.to_16[1] / SUBVOXEL_UNITS_PER_BLOCK,
  ];
  for (let z = bz0; z <= bz1; z += 1) {
    for (let x = bx0; x <= bx1; x += 1) addOccupied(occupied, cellKey(x, z), y0, y1);
  }
};

const collectStructuralOccupied = (
  room: InteriorRoomInput,
  structuralBoxes: readonly SubVoxelBoxIR[],
): OccupiedMap => {
  const occupied: OccupiedMap = new Map();
  for (const vol of room.volumes) {
    if (vol.kind === 'partition')
      addPartitionCells(room, vol, (k, y0, y1) => addOccupied(occupied, k, y0, y1));
  }
  for (const box of structuralBoxes) {
    if (isNonWalkObstacle(box.semantic_tag ?? '') || box.to_16[1] - box.from_16[1] <= 3.5) continue;
    addStructuralBoxCells(box, occupied);
  }
  return occupied;
};

const resolvePropSpecs = (
  room: InteriorRoomInput,
  structuralBoxes: readonly SubVoxelBoxIR[] = [],
): {
  resolvedSpecs: InteriorPropSpec[];
  placements: Omit<ResolvedPropPlacement, 'surface_y_16'>[];
} => {
  const occupied = collectStructuralOccupied(room, structuralBoxes);
  const doorClear = collectDoorClearZones(room.openings);
  const winClear = collectWindowZones(room.openings);
  const stairCells = collectStairCells(room);
  const resolvedSpecs: InteriorPropSpec[] = [];
  const placements: Omit<ResolvedPropPlacement, 'surface_y_16'>[] = [];
  for (const spec of room.props ?? []) {
    const [rx, rz] = findCandidatePlacement(spec, room, occupied, doorClear, winClear, stairCells);
    const nudged = rx !== Math.round(spec.at[0]) || rz !== Math.round(spec.at[2]);
    const nextAt: Vec3 = nudged ? [rx, spec.at[1], rz] : spec.at;
    if (spec.mount_on !== 'wall' && spec.mount_on !== 'ceiling') {
      const bounds = resolveZoneRect(room, spec.zone_id);
      const { y0, y1 } = propSpanY(spec);
      for (const [cx, cz] of propFootprintCoords(spec, rx, rz, bounds))
        addOccupied(occupied, cellKey(cx, cz), y0, y1);
    }
    resolvedSpecs.push({ ...spec, at: nextAt });
    placements.push({ id: spec.id, original_at: spec.at, resolved_at: nextAt, nudged });
  }
  return { resolvedSpecs, placements };
};

const resolveStoryForPlacement = (
  story: InteriorStorySpec,
  placementById: ReadonlyMap<string, Omit<ResolvedPropPlacement, 'surface_y_16'>>,
  surfaceMap: ReadonlyMap<string, number>,
): InteriorStorySpec => {
  const p = placementById.get(story.on_target);
  const dx16 = p ? (p.resolved_at[0] - p.original_at[0]) * SUBVOXEL_UNITS_PER_BLOCK : 0;
  const dz16 = p ? (p.resolved_at[2] - p.original_at[2]) * SUBVOXEL_UNITS_PER_BLOCK : 0;
  const targetSurface = surfaceMap.get(story.on_target);
  return {
    ...story,
    center_xz_16: [story.center_xz_16[0] + dx16, story.center_xz_16[1] + dz16],
    ...(targetSurface !== undefined ? { surface_y_16: targetSurface } : {}),
  };
};

/** Deterministically resolves prop placements, seats stories, compiles drapery, and validates BFS clear_path. */
export const solveInteriorLayout = (
  room: InteriorRoomInput,
  structuralBoxes: readonly SubVoxelBoxIR[] = [],
): SolvedRoomLayout => {
  const { resolvedSpecs, placements } = resolvePropSpecs(room, structuralBoxes);
  const compiledProps = compileInteriorProps(resolvedSpecs, room.style_dna, room.seed);
  const placed_props: ResolvedPropPlacement[] = placements.map((p) => ({
    ...p,
    surface_y_16: compiledProps.surface_y_map.get(p.id) ?? 0,
  }));
  const boxes: SubVoxelBoxIR[] = [...compiledProps.boxes];
  const hooks: PlayableInteriorHook[] = [...compiledProps.hooks];
  const resolvedStories: InteriorStorySpec[] = [];
  const pMap = new Map(placements.map((p) => [p.id, p]));
  for (const story of room.stories ?? []) {
    const resolvedStory = resolveStoryForPlacement(story, pMap, compiledProps.surface_y_map);
    resolvedStories.push(resolvedStory);
    const res = compileStoryVignette(resolvedStory, room.style_dna, room.seed);
    boxes.push(...res.boxes);
    hooks.push(...res.hooks);
  }
  boxes.push(...compileAllDraperies(room.draperies ?? []));
  const clearance = validateClearPath(room, [...structuralBoxes, ...boxes], hooks);
  return {
    boxes,
    custom_mounts: compiledProps.custom_mounts,
    hooks,
    clearance,
    placed_props,
    resolved_room: { ...room, props: resolvedSpecs, stories: resolvedStories },
  };
};
