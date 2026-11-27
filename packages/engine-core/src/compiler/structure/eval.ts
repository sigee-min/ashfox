import {
  MAX_STRUCTURE_OPS,
  type StructureOp,
  type StructureSourceUnit,
} from '../../project/structure/contract';
import { deepFreeze } from '../../immutable';
import { buildCustomPlacementsFromTags, parseFacingOf, verifyReachableHygiene } from './compound';
import type { EvaluatedStructureResult } from './contract';
import { finalizeEvaluatedGrid } from './jigsaw';
import { compileEvaluatedInteriors } from './interior/compile';
import { createOpContext, type StructureOpContext, type StructureOpHandler } from './opContext';
import { ARCH_OP_HANDLERS } from './opsArch';
import { TRANSFORM_OP_HANDLERS } from './opsTransform';
import { VOXEL_OP_HANDLERS } from './opsVoxel';
import { resolveOpeningConnections, resolveRoomEnclosure, solveBlockConnections } from './solver';
import { IDENTITY_FRAME, createEvalState, failEval, type EvalState } from './weathering';

export const STRUCTURE_OP_HANDLERS: Readonly<Record<StructureOp['op'], StructureOpHandler>> =
  Object.freeze({
    ...VOXEL_OP_HANDLERS,
    ...ARCH_OP_HANDLERS,
    ...TRANSFORM_OP_HANDLERS,
  });

const dispatchOp = (ctx: StructureOpContext, op: StructureOp): void => {
  if (++ctx.state.opCount > MAX_STRUCTURE_OPS || ctx.depth > 24) {
    ctx.fail('structure.budget', 'Structure evaluation exceeded budget');
  }
  STRUCTURE_OP_HANDLERS[op.op](ctx, op);
};

const finalizeEvalResult = (
  rootPath: string,
  root: StructureSourceUnit,
  state: EvalState,
): EvaluatedStructureResult => {
  solveBlockConnections(state.voxels, state.states, state.stateToIdx, state.size);
  const rooms = resolveRoomEnclosure([...state.rooms.values()], state.voxels, state.size);
  const openings = resolveOpeningConnections(state.openings, rooms);
  const localInteriors =
    state.interiorSpecs.length > 0
      ? compileEvaluatedInteriors(state, state.interiorSpecs, rooms, openings)
      : [];
  const combinedInteriors = [...state.childInteriors, ...localInteriors];
  const interiors = combinedInteriors.length > 0 ? combinedInteriors : undefined;
  verifyReachableHygiene(
    rootPath,
    state.units,
    state.relative,
    state.usedImports,
    state.usedPaletteKeys,
    state.usedPrefabs,
    failEval,
  );
  const placements = buildCustomPlacementsFromTags(
    state.size,
    state.voxels,
    state.states,
    state.customTags,
    parseFacingOf,
  );
  return {
    grid: finalizeEvaluatedGrid(
      root,
      state.size,
      state.voxels,
      state.states,
      state.customTags,
      state.floors,
      rooms,
      openings,
      state.sockets,
      state.hasRoofTrim,
      state.roofCount,
      state.dormerCount,
      state.chimneyCount,
      state.stats,
      placements,
      interiors,
    ),
    prefabUses: state.prefabUses,
    ...(state.compoundChildren.length > 0 ? { compoundChildren: state.compoundChildren } : {}),
  };
};

export const evaluateStructure = (
  rootPath: string,
  units: ReadonlyMap<string, StructureSourceUnit>,
  relative: (owner: string, specifier: string) => string,
  evaluatedGridCache?: Map<string, EvaluatedStructureResult>,
): EvaluatedStructureResult => {
  const cached = evaluatedGridCache?.get(rootPath);
  if (cached) return cached;
  const root = units.get(rootPath)!;
  const state = createEvalState(rootPath, units, relative, evaluatedGridCache);
  const rootCtx = createOpContext(state, rootPath, IDENTITY_FRAME, 0, dispatchOp, (childPath) =>
    evaluateStructure(childPath, state.units, state.relative, state.evaluatedGridCache),
  );
  for (const op of root.ops) dispatchOp(rootCtx, op);
  const result = finalizeEvalResult(rootPath, root, state);
  if (evaluatedGridCache) evaluatedGridCache.set(rootPath, deepFreeze(result));
  return result;
};
