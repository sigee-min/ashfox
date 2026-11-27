import type { CardinalFacing, IntVec3 } from '../../../project/structure/contract';
import type { InteriorRoomOp } from '../../../project/structure/interiorDef';
import {
  qualifyCustomAssetKey,
  type StructureOpeningMeta,
  type StructureRoomMeta,
} from '../contract';
import { putVoxel, resolvePaletteEntry } from '../jigsaw';
import type { EvalState, FrameTransform } from '../weathering';
import { evaluateInteriorAudit } from './audit';
import type { InteriorRoomInput, InteriorSubVoxelIR } from './contract';
import type { CompiledInteriorRoom, CustomPropMount } from './types';
import { transformInteriorOpByFrame } from './frameOp';
import { lowerInteriorAstToInput } from './lowerAst';
import { lowerInteriorToVanillaNbt } from './nbtLower';
import { computeInteriorRadiosity } from './radiosity';
import { buildInteriorShell } from './shell';
import { solveInteriorLayout } from './solver';
import {
  emitPlayableInteriorMeta,
  generateInteriorSunShafts,
  generateTranslucentWindowPanes,
} from './sunShaft';
import { buildSculptedVolumes, type AlcoveCarveSpec } from './volume';

export type { CompiledInteriorRoom };

const collectCorbelCandidates = (room: StructureRoomMeta): readonly IntVec3[] => {
  if (room.from[1] <= 0) return [];
  const y = room.from[1] - 1;
  const out: IntVec3[] = [];
  for (let x = room.from[0]; x <= room.to[0]; x += 1) {
    out.push([x, y, room.from[2]], [x, y, room.to[2]]);
  }
  for (let z = room.from[2] + 1; z < room.to[2]; z += 1) {
    out.push([room.from[0], y, z], [room.to[0], y, z]);
  }
  return out;
};

const voxelAt = (state: EvalState, x: number, y: number, z: number): number => {
  const [w, h, d] = state.size;
  if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) return -1;
  return state.voxels[(y * d + z) * w + x]!;
};

const WALL_INWARD: Readonly<Record<CardinalFacing, readonly [number, number]>> = {
  north: [0, 1],
  south: [0, -1],
  west: [1, 0],
  east: [-1, 0],
};

const FRAGILE_EXTERIOR_SUBSTRS = [
  '_slab',
  '_trapdoor',
  'lantern',
  'torch',
  '_stairs',
  '_fence',
  '_wall',
  'glass_pane',
  'iron_bars',
  '_sign',
  '_banner',
  '_button',
  'chain',
  'flower_pot',
  'vine',
  '_door',
];

const isOpeningColumn = (
  openings: readonly StructureOpeningMeta[],
  wall: CardinalFacing,
  x: number,
  z: number,
): boolean =>
  openings.some(
    (op) =>
      op.wall === wall && x >= op.from[0] && x <= op.to[0] && z >= op.from[2] && z <= op.to[2],
  );

const isFragileOutwardBlock = (state: EvalState, x: number, y: number, z: number): boolean => {
  const v = voxelAt(state, x, y, z);
  if (v <= 0) return false;
  const name = state.states[v] ?? '';
  return FRAGILE_EXTERIOR_SUBSTRS.some((s) => name.includes(s));
};

const canCarveAlcoveCell = (
  state: EvalState,
  carve: AlcoveCarveSpec,
  openings: readonly StructureOpeningMeta[],
): boolean => {
  if (carve.depth_16 <= 0) return false;
  const [w, h, d] = state.size;
  const [x, y, z] = carve.pos;
  if (x < 0 || y <= 0 || z < 0 || x >= w || y >= h - 1 || z >= d) return false;
  if (isOpeningColumn(openings, carve.wall, x, z)) return false;
  const cur = voxelAt(state, x, y, z);
  if (cur <= 0) return false;
  const curState = state.states[cur] ?? '';
  if (curState.includes('_door') || curState.includes('glass_pane')) return false;
  const [ix, iz] = WALL_INWARD[carve.wall];
  if (isFragileOutwardBlock(state, x - ix, y, z - iz)) return false;
  return voxelAt(state, x + ix, y, z + iz) <= 0 || voxelAt(state, x - ix, y, z - iz) > 0;
};

const applyVolumeCarvesToGrid = (
  state: EvalState,
  ownerPath: string,
  carves: readonly AlcoveCarveSpec[],
  doorways: readonly IntVec3[],
  sunkenCells: readonly IntVec3[],
  openings: readonly StructureOpeningMeta[],
): void => {
  for (const c of carves) {
    if (canCarveAlcoveCell(state, c, openings))
      putVoxel(state, ownerPath, c.pos, 'minecraft:air', null, true);
  }
  for (const p of doorways) {
    putVoxel(state, ownerPath, p, 'minecraft:air', null, true);
    putVoxel(state, ownerPath, [p[0], p[1] + 1, p[2]], 'minecraft:air', null, true);
  }
  const [w, h, d] = state.size;
  for (const [x, y, z] of sunkenCells) {
    if (x >= 0 && x < w && y >= 0 && y < h && z >= 0 && z < d) {
      putVoxel(state, ownerPath, [x, y, z], 'minecraft:oak_slab[type=bottom]', null, true);
    }
  }
};

const resolveMountAliases = (
  state: EvalState,
  ownerPath: string,
  mounts: readonly CustomPropMount[],
): readonly CustomPropMount[] =>
  mounts.map((m) => {
    const res = resolvePaletteEntry(state, m.asset_alias, ownerPath, [0, 0, 0]);
    const qualified = res.assetAlias
      ? res.assetAlias
      : qualifyCustomAssetKey(ownerPath, m.asset_alias);
    return { ...m, asset_alias: qualified };
  });

const hasUpperRoomFloorAt = (
  rooms: readonly StructureRoomMeta[],
  self: StructureRoomMeta,
  x: number,
  y: number,
  z: number,
): boolean =>
  rooms.some(
    (r) =>
      r !== self &&
      x >= r.from[0] &&
      x <= r.to[0] &&
      z >= r.from[2] &&
      z <= r.to[2] &&
      y >= r.from[1] &&
      y <= r.to[1],
  );

const findRoofCoverY = (state: EvalState, x: number, yStart: number, z: number): number => {
  const [, h] = state.size;
  for (let y = yStart; y < h; y += 1) {
    if (voxelAt(state, x, y, z) > 0) return y;
  }
  return -1;
};

const isHangingBelowCell = (state: EvalState, x: number, yBelow: number, z: number): boolean => {
  const v = voxelAt(state, x, yBelow, z);
  if (v <= 0) return false;
  const name = state.states[v] ?? '';
  return (
    name.includes('hanging=true') ||
    name.includes('chain') ||
    name.includes('lantern') ||
    name.includes('bell') ||
    name.includes('banner')
  );
};

const clearTrussCeilingCell = (
  state: EvalState,
  ownerPath: string,
  room: StructureRoomMeta,
  rooms: readonly StructureRoomMeta[],
  x: number,
  z: number,
): void => {
  const y = room.to[1];
  if (hasUpperRoomFloorAt(rooms, room, x, y, z) || voxelAt(state, x, y, z) <= 0) return;
  const yRoof = findRoofCoverY(state, x, y + 1, z);
  if (yRoof <= y + 1) return;
  if (!isHangingBelowCell(state, x, y - 1, z)) {
    putVoxel(state, ownerPath, [x, y, z], 'minecraft:air', null, true);
    return;
  }
  for (let cy = y; cy < yRoof; cy += 1) {
    putVoxel(state, ownerPath, [x, cy, z], 'minecraft:chain', null, true);
  }
};

const canClearWholeTrussCeiling = (
  state: EvalState,
  room: StructureRoomMeta,
  rooms: readonly StructureRoomMeta[],
): boolean => {
  const y = room.to[1];
  for (let z = room.from[2] + 1; z <= room.to[2] - 1; z += 1) {
    for (let x = room.from[0] + 1; x <= room.to[0] - 1; x += 1) {
      if (hasUpperRoomFloorAt(rooms, room, x, y, z)) return false;
      if (findRoofCoverY(state, x, y + 1, z) < 0) return false;
    }
  }
  return true;
};

const clearOpenTrussCeiling = (
  state: EvalState,
  ownerPath: string,
  room: StructureRoomMeta,
  rooms: readonly StructureRoomMeta[],
  input: Pick<InteriorRoomInput, 'architecture' | 'volumes'>,
): void => {
  if (
    input.architecture.ceiling !== 'open_truss' &&
    !input.volumes.some((v) => v.kind === 'open_truss')
  ) {
    return;
  }
  if (!canClearWholeTrussCeiling(state, room, rooms)) return;
  for (let z = room.from[2] + 1; z <= room.to[2] - 1; z += 1) {
    for (let x = room.from[0] + 1; x <= room.to[0] - 1; x += 1) {
      clearTrussCeilingCell(state, ownerPath, room, rooms, x, z);
    }
  }
};

const reconcileRoomVoxels = (
  state: EvalState,
  ownerPath: string,
  volumes: ReturnType<typeof buildSculptedVolumes>,
  roomOpenings: readonly StructureOpeningMeta[],
  room: StructureRoomMeta,
  rooms: readonly StructureRoomMeta[],
  input: InteriorRoomInput,
): void => {
  applyVolumeCarvesToGrid(
    state,
    ownerPath,
    volumes.alcove_carve_specs,
    volumes.doorway_clearances,
    volumes.sunken_cells,
    roomOpenings,
  );
  clearOpenTrussCeiling(state, ownerPath, room, rooms, input);
};

const compileSingleInterior = (
  state: EvalState,
  ownerPath: string,
  op: InteriorRoomOp,
  room: StructureRoomMeta,
  roomOpenings: readonly StructureOpeningMeta[],
  rooms: readonly StructureRoomMeta[],
): CompiledInteriorRoom => {
  const ctx = lowerInteriorAstToInput(op, room, roomOpenings, state.seed);
  const shell = buildInteriorShell(ctx.roomInput, collectCorbelCandidates(room));
  const volumes = buildSculptedVolumes(ctx.roomInput);
  reconcileRoomVoxels(state, ownerPath, volumes, roomOpenings, room, rooms, ctx.roomInput);
  const solved = solveInteriorLayout(ctx.roomInput, [...shell.boxes, ...volumes.boxes]);
  const windowPanes = generateTranslucentWindowPanes(ctx.roomInput);
  const ir: InteriorSubVoxelIR = {
    room_id: ctx.roomInput.room_id,
    units_per_block: 16,
    boxes: [...shell.boxes, ...volumes.boxes, ...solved.boxes, ...windowPanes.map((w) => w.box)],
    clear_path_cells: solved.clearance.clear_path_cells,
    corbel_blocked_cells: shell.corbel_blocked_cells,
  };
  const radiosity = computeInteriorRadiosity(
    solved.resolved_room,
    ir,
    ctx.radiosityConfig,
    ctx.sunShaftConfig.sun_dir,
  );
  const sunShafts =
    ctx.sunShaftConfig.enabled === false
      ? []
      : generateInteriorSunShafts(ctx.roomInput, ctx.sunShaftConfig);
  const nbtLowering = lowerInteriorToVanillaNbt(solved.resolved_room, ir);
  const playableMeta = emitPlayableInteriorMeta(solved.resolved_room, ir, [], solved.hooks);
  const audit = evaluateInteriorAudit({
    room: ctx.roomInput,
    ir,
    radiosity,
    sunShafts,
    playableMeta,
    nbt: nbtLowering,
  });
  return {
    room_id: ctx.roomInput.room_id,
    input: ctx.roomInput,
    ir,
    radiosity: { ...radiosity, compute_ms: 0 },
    sun_shafts: sunShafts,
    window_panes: windowPanes,
    nbt_lowering: nbtLowering,
    playable_meta: playableMeta,
    audit,
    custom_mounts: resolveMountAliases(state, ownerPath, solved.custom_mounts),
  };
};

/** Compiles all declared ashfox 1 interior ops against evaluated rooms & openings. */
export const compileEvaluatedInteriors = (
  state: EvalState,
  specs: readonly {
    readonly ownerPath: string;
    readonly op: InteriorRoomOp;
    readonly frame?: FrameTransform;
  }[],
  rooms: readonly StructureRoomMeta[],
  openings: readonly StructureOpeningMeta[],
): readonly CompiledInteriorRoom[] => {
  const roomMap = new Map(rooms.map((r) => [r.name, r]));
  const out: CompiledInteriorRoom[] = [];
  for (const { ownerPath, op, frame } of specs) {
    const targetName = op.room ?? rooms[0]?.name;
    const room = targetName ? roomMap.get(targetName) : undefined;
    if (!room) {
      throw new Error(`Unknown interior target room "${targetName ?? ''}" in ${ownerPath}`);
    }
    const roomOpenings = openings.filter((o) => o.room === room.name);
    const transformedOp = frame ? transformInteriorOpByFrame(op, frame, room) : op;
    out.push(compileSingleInterior(state, ownerPath, transformedOp, room, roomOpenings, rooms));
  }
  return out;
};
