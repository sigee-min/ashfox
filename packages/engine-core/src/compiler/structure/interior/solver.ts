import type { Vec3 } from '../../../model/identity';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type InteriorPropSpec,
  type InteriorRoomInput,
  type InteriorStorySpec,
  type PlayableInteriorHook,
  type SubVoxelBoxIR,
} from './contract';
import { compileAllDraperies } from './drapery';
import { compileInteriorProps, type CustomPropMount } from './props';
import { hashSeed01 } from './propsGeo';
import {
  addPartitionCells,
  collectStairCells,
  isNonWalkObstacle,
  validateClearPath,
  type ClearPathReport,
} from './solverPath';
import { compileStoryVignette } from './vignettes';
import {
  TALL_WALL_PROPS,
  addMezzanineDeckCells,
  addOccupied,
  boxCellRange16,
  cellKey,
  collectDoorClearZones,
  collectWindowZones,
  isCellBlockedAt,
  propFitsBounds,
  propFootprintCoords,
  propSpanY,
  resolveZoneRect,
  type OccupiedMap,
  type ZoneFootprint,
} from './zoneRect';

export { validateClearPath, type ClearPathReport } from './solverPath';

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
  const [ax, az] = [spec.at[0], spec.at[2]];
  if (canPlacePropAt(spec, ax, az, bounds, occupied, doorClear, winClear, stairCells)) {
    return [ax, az];
  }
  const [sx, sz] = [Math.round(ax), Math.round(az)];
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
  return candidates.length > 0 ? [candidates[0]![1], candidates[0]![2]] : [ax, az];
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
  const hasMezzBox = structuralBoxes.some((b) => b.semantic_tag === 'volume_mezzanine');
  for (const vol of room.volumes) {
    if (vol.kind === 'partition')
      addPartitionCells(room, vol, (k, y0, y1) => addOccupied(occupied, k, y0, y1));
    else if (vol.kind === 'mezzanine' && !hasMezzBox) addMezzanineDeckCells(room, vol, occupied);
  }
  for (const box of structuralBoxes) {
    const tag = box.semantic_tag ?? '';
    const keepForPlacement = tag === 'volume_mezzanine';
    if (!keepForPlacement && (isNonWalkObstacle(tag) || box.to_16[1] - box.from_16[1] <= 3.5))
      continue;
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
    const nudged = rx !== spec.at[0] || rz !== spec.at[2];
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
