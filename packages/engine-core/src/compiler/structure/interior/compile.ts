import type { IntVec3 } from '../../../project/structure/contract';
import type { InteriorRoomOp } from '../../../project/structure/interiorDef';
import {
  qualifyCustomAssetKey,
  type StructureOpeningMeta,
  type StructureRoomMeta,
} from '../contract';
import { putVoxel, resolvePaletteEntry } from '../jigsaw';
import type { EvalState } from '../weathering';
import { evaluateInteriorAudit } from './audit';
import type { InteriorSubVoxelIR, PlayableInteriorMeta } from './contract';
import type { CompiledInteriorRoom, CustomPropMount } from './types';
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
import { buildSculptedVolumes } from './volume';

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

const isInteriorWallCarve = (state: EvalState, p: IntVec3): boolean => {
  const [w, , d] = state.size;
  const [x, y, z] = p;
  if (x <= 1 || x >= w - 2 || z <= 1 || z >= d - 2) return false;
  return (
    voxelAt(state, x + 1, y, z) > 0 &&
    voxelAt(state, x - 1, y, z) > 0 &&
    voxelAt(state, x, y, z + 1) > 0 &&
    voxelAt(state, x, y, z - 1) > 0
  );
};

const applyVolumeCarvesToGrid = (
  state: EvalState,
  ownerPath: string,
  carves: readonly IntVec3[],
  doorways: readonly IntVec3[],
): void => {
  for (const p of carves) {
    if (isInteriorWallCarve(state, p)) putVoxel(state, ownerPath, p, 'minecraft:air', null, true);
  }
  for (const p of doorways) {
    putVoxel(state, ownerPath, p, 'minecraft:air', null, true);
    putVoxel(state, ownerPath, [p[0], p[1] + 1, p[2]], 'minecraft:air', null, true);
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

const compileSingleInterior = (
  state: EvalState,
  ownerPath: string,
  op: InteriorRoomOp,
  room: StructureRoomMeta,
  roomOpenings: readonly StructureOpeningMeta[],
): CompiledInteriorRoom => {
  const ctx = lowerInteriorAstToInput(op, room, roomOpenings, state.seed);
  const shell = buildInteriorShell(ctx.roomInput, collectCorbelCandidates(room));
  const volumes = buildSculptedVolumes(ctx.roomInput);
  applyVolumeCarvesToGrid(state, ownerPath, volumes.alcove_carves, volumes.doorway_clearances);
  const solved = solveInteriorLayout(ctx.roomInput);
  const windowPanes = generateTranslucentWindowPanes(ctx.roomInput);
  const ir: InteriorSubVoxelIR = {
    room_id: ctx.roomInput.room_id,
    units_per_block: 16,
    boxes: [...shell.boxes, ...volumes.boxes, ...solved.boxes, ...windowPanes.map((w) => w.box)],
    clear_path_cells: solved.clearance.clear_path_cells,
    corbel_blocked_cells: shell.corbel_blocked_cells,
  };
  const radiosity = computeInteriorRadiosity(
    ctx.roomInput,
    ir,
    ctx.radiosityConfig,
    ctx.sunShaftConfig.sun_dir,
  );
  const sunShafts =
    ctx.sunShaftConfig.enabled === false
      ? []
      : generateInteriorSunShafts(ctx.roomInput, ctx.sunShaftConfig);
  const nbtLowering = lowerInteriorToVanillaNbt(ctx.roomInput, ir);
  const baseMeta = emitPlayableInteriorMeta(ctx.roomInput, ir, []);
  const seenHook = new Set(baseMeta.hooks.map((h) => h.id));
  const mergedHooks = [...baseMeta.hooks, ...solved.hooks.filter((h) => !seenHook.has(h.id))];
  const playableMeta: PlayableInteriorMeta = { ...baseMeta, hooks: mergedHooks };
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
  specs: readonly { readonly ownerPath: string; readonly op: InteriorRoomOp }[],
  rooms: readonly StructureRoomMeta[],
  openings: readonly StructureOpeningMeta[],
): readonly CompiledInteriorRoom[] => {
  const roomMap = new Map(rooms.map((r) => [r.name, r]));
  const out: CompiledInteriorRoom[] = [];
  for (const { ownerPath, op } of specs) {
    const targetName = op.room ?? rooms[0]?.name;
    const room = targetName ? roomMap.get(targetName) : undefined;
    if (!room) {
      throw new Error(`Unknown interior target room "${targetName ?? ''}" in ${ownerPath}`);
    }
    const roomOpenings = openings.filter((o) => o.room === room.name);
    out.push(compileSingleInterior(state, ownerPath, op, room, roomOpenings));
  }
  return out;
};
