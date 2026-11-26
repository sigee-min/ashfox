import {
  MAX_STRUCTURE_OPS,
  type CardinalFacing,
  type ExprVec2,
  type ExprVec3,
  type IntVec2,
  type IntVec3,
  type StructureOp,
  type StructureScalarExpr,
  type StructureSourceUnit,
} from '../../project/structure/contract';
import {
  evaluateExprVec2,
  evaluateExprVec3,
  evaluateScalarInt,
} from '../../project/structure/expr';
import { parseBlockState, withBlockFacing } from '../../project/structure/state';
import { deepFreeze } from '../../immutable';
import {
  buildCustomPlacementsFromTags,
  checkStructureUnitHygiene,
  collectReachableUnits,
  resolveStructurePrefab,
} from './compound';
import type { EvaluatedStructureResult, StructureFloorMeta } from './contract';
import { emitRoomShell } from './facade';
import {
  buildFrameRoofOp,
  composeRotation,
  emitRoomJetty,
  expandRoomInFloor,
  getRoofGuard,
  registerFloorJetty,
  runCompoundMerge,
  runWeatherAndSocketOp,
  transformAnchor,
  transformFacing,
  transformJetty,
  transformRoomBounds,
} from './frameOps';
import {
  finalizeEvaluatedGrid,
  putUnprotected,
  putVoxel,
  resolvePaletteEntry,
  runFacadeOp,
  runHangItem,
  runRoofOp,
  runStaircaseOp,
} from './jigsaw';
import { resolveOpeningConnections, resolveRoomEnclosure, solveBlockConnections } from './solver';
import { collectPrefabLocalBounds, computeAnchoredOffset } from './staircase';
import {
  IDENTITY_FRAME,
  applyFrame,
  composeFrames,
  createEvalState,
  emitLayerOp,
  emitRegionOp,
  failEval,
  mirrorFrame,
  stepOffset,
  transformBlockState,
  type EvalState,
  type FrameTransform,
} from './weathering';

const paramsOf = (state: EvalState, ownerPath: string) => state.units.get(ownerPath)?.params ?? {};
const evalScalar = (state: EvalState, ownerPath: string, expr: StructureScalarExpr): number =>
  evaluateScalarInt(expr, paramsOf(state, ownerPath), ownerPath);
const evalVec2 = (state: EvalState, ownerPath: string, vec: ExprVec2): IntVec2 =>
  evaluateExprVec2(vec, paramsOf(state, ownerPath), ownerPath);
const evalVec3 = (state: EvalState, ownerPath: string, vec: ExprVec3): IntVec3 =>
  evaluateExprVec3(vec, paramsOf(state, ownerPath), ownerPath);

const evalRoomOp = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'room' }>,
  frame: FrameTransform,
): void => {
  const floor = state.currentFloor;
  if (!floor)
    return failEval(
      ownerPath,
      'structure.room-no-floor',
      `Room "${op.name}" must be inside a floor`,
    );
  const [rawX, rawZ] = evalVec2(state, ownerPath, op.from);
  const [rawW, rawD] = evalVec2(state, ownerPath, op.size);
  if (rawW < 3 || rawD < 3)
    return failEval(ownerPath, 'structure.invalid-room', `Room "${op.name}" size >= 3x3`);
  const exp = expandRoomInFloor(floor, rawX, rawZ, rawW, rawD);
  const bounds = transformRoomBounds(exp.rx, exp.rz, exp.rw, exp.rd, floor.y, floor.height, frame);
  const meta = emitRoomShell(
    {
      name: op.name,
      kind: op.kind,
      shape: op.shape,
      from: bounds.from,
      to: bounds.to,
      plinth: op.plinth,
      floor: op.floor,
      wall: op.wall,
      frame: op.frame,
      ceiling: op.ceiling,
    },
    ownerPath,
    state.rooms,
    (p, s, a) => putVoxel(state, ownerPath, p, transformBlockState(s, frame), a),
    (p, s, a) => putUnprotected(state, ownerPath, p, transformBlockState(s, frame), a),
    (k, o, p) => resolvePaletteEntry(state, k, o, p),
    (c, m) => failEval(ownerPath, c, m),
  );
  emitRoomJetty(state, ownerPath, op, bounds, exp.edges, frame);
  state.rooms.set(op.name, meta);
  state.stats.roomCount += 1;
};

const evalFloorOp = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'floor' }>,
  frame: FrameTransform,
  depth: number,
): void => {
  const y = evalScalar(state, ownerPath, op.y) + frame.offset[1];
  const height = evalScalar(state, ownerPath, op.height);
  if (height < 3 || y < 0 || y + height >= state.size[1])
    failEval(ownerPath, 'structure.invalid-floor', `Floor "${op.name}" out of height`);
  if (state.floorNames.has(op.name))
    failEval(ownerPath, 'structure.duplicate-floor', `Duplicate floor "${op.name}"`);
  state.floorNames.add(op.name);
  const jetty = transformJetty(op.jetty, frame);
  const meta: StructureFloorMeta = { name: op.name, y, height, ...(jetty ? { jetty } : {}) };
  registerFloorJetty(meta, op.ops, op.jetty, (v) => evalVec2(state, ownerPath, v));
  state.floors.push(meta);
  const prev = state.currentFloor;
  state.currentFloor = meta;
  for (const child of op.ops) evalOp(state, ownerPath, child, frame, depth + 1);
  state.currentFloor = prev;
};

const evalFurnishOp = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'furnish' }>,
  frame: FrameTransform,
  depth: number,
): void => {
  const room = state.rooms.get(op.room);
  if (!room)
    return failEval(ownerPath, 'structure.unknown-room', `Unknown room "${op.room}" in furnish`);
  for (const item of op.items) {
    if (item.kind === 'hang') {
      runHangItem(
        ownerPath,
        room,
        item.block,
        item.at,
        item.drop,
        (p, s, a) => putVoxel(state, ownerPath, p, s, a),
        (k, o, p) => resolvePaletteEntry(state, k, o, p),
      );
      continue;
    }
    state.prefabUses += 1;
    const target = resolveStructurePrefab(
      state.units,
      state.relative,
      ownerPath,
      item.prefab,
      state.usedImports,
      state.usedPrefabs,
      failEval,
    );
    const rot = composeRotation(item.rotate ?? 0, frame);
    const pts = collectPrefabLocalBounds(
      target.ops,
      rot,
      (v) => evalVec2(state, target.targetPath, v),
      (v) => evalVec3(state, target.targetPath, v),
      (s) => evalScalar(state, target.targetPath, s),
    );
    const sub: FrameTransform = {
      offset: computeAnchoredOffset(
        room,
        pts,
        transformAnchor(item.on, frame),
        item.offset ?? [0, 0],
      ),
      rotate: rot,
      mirrorX: frame.mirrorX,
    };
    for (const child of target.ops) evalOp(state, target.targetPath, child, sub, depth + 1);
  }
  state.stats.furnishCount += 1;
};

const evalCompoundPlace = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'compound_place' }>,
  frame: FrameTransform,
): void => {
  const imp = state.units.get(ownerPath)?.imports.find((i) => i.alias === op.alias);
  if (!imp) return failEval(ownerPath, 'structure.unknown-import', `Unknown import "${op.alias}"`);
  state.usedImports.get(ownerPath)?.add(op.alias);
  const childPath = state.relative(ownerPath, imp.path);
  const childUnit = state.units.get(childPath);
  if (!childUnit || childUnit.kind !== 'structure')
    return failEval(
      ownerPath,
      'structure.invalid-compound',
      `compound_place "${op.alias}" must target structure`,
    );
  const child = evaluateStructure(childPath, state.units, state.relative, state.evaluatedGridCache);
  const placed = applyFrame(evalVec3(state, ownerPath, op.at), frame);
  runCompoundMerge(state, ownerPath, op.alias, childPath, child, placed, op.rotate);
};

const evalTransformOp = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'repeat' | 'mirror' | 'place' }>,
  frame: FrameTransform,
  depth: number,
): void => {
  if (op.op === 'repeat') {
    for (let i = 0; i < op.count; i += 1) {
      const sub = composeFrames(frame, {
        offset: stepOffset(op.axis, i * op.step),
        rotate: 0,
        mirrorX: false,
      });
      for (const child of op.ops) evalOp(state, ownerPath, child, sub, depth + 1);
    }
  } else if (op.op === 'mirror') {
    for (const child of op.ops) evalOp(state, ownerPath, child, frame, depth + 1);
    const mirrored = composeFrames(frame, mirrorFrame(op.axis, op.center));
    for (const child of op.ops) evalOp(state, ownerPath, child, mirrored, depth + 1);
  } else {
    state.prefabUses += 1;
    const target = resolveStructurePrefab(
      state.units,
      state.relative,
      ownerPath,
      op.prefab,
      state.usedImports,
      state.usedPrefabs,
      failEval,
    );
    const sub = composeFrames(frame, {
      offset: evalVec3(state, ownerPath, op.at),
      rotate: op.rotate,
      mirrorX: false,
    });
    for (const child of target.ops) evalOp(state, target.targetPath, child, sub, depth + 1);
  }
};

const evalStairOp = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'staircase' }>,
  frame: FrameTransform,
): void => {
  const room = op.inRoom ? (state.rooms.get(op.inRoom) ?? null) : null;
  if (op.inRoom && !room)
    failEval(ownerPath, 'structure.unknown-room', `Unknown room "${op.inRoom}"`);
  const yFrom =
    op.yFrom !== undefined
      ? evalScalar(state, ownerPath, op.yFrom) + frame.offset[1]
      : (room?.from[1] ?? state.currentFloor?.y ?? 0);
  const yTo =
    op.yTo !== undefined
      ? evalScalar(state, ownerPath, op.yTo) + frame.offset[1]
      : (room?.to[1] ??
        (state.currentFloor ? state.currentFloor.y + state.currentFloor.height : yFrom + 4));
  const [lx, lz] = evalVec2(state, ownerPath, op.at);
  const [wx, _wy, wz] = applyFrame([lx, 0, lz], frame);
  runStaircaseOp(
    ownerPath,
    state.size,
    state.voxels,
    { ...op, facing: transformFacing(op.facing, frame) },
    [wx, wz],
    yFrom,
    yTo,
    room,
    state.openings,
    (x, y, z, s, a) => putVoxel(state, ownerPath, [x, y, z], s, a),
    (x, y, z) => putVoxel(state, ownerPath, [x, y, z], 'minecraft:air', null, true),
    (k, o, p) => resolvePaletteEntry(state, k, o, p),
    (c, m) => failEval(ownerPath, c, m),
  );
  state.stats.stairCount += 1;
};

const evalRoofOp = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'roof' }>,
  frame: FrameTransform,
): void => {
  const worldPlaced = Boolean(op.on);
  const guard = getRoofGuard(state, worldPlaced, frame);
  const toW = (c: IntVec3): IntVec3 => (worldPlaced ? c : applyFrame(c, frame));
  const res = runRoofOp(
    ownerPath,
    state.size,
    buildFrameRoofOp(op, frame),
    op.from ? evalVec3(state, ownerPath, op.from) : null,
    op.to ? evalVec3(state, ownerPath, op.to) : null,
    state.rooms,
    (x, y, z, b, a) =>
      putVoxel(
        state,
        ownerPath,
        toW([x, y, z]),
        worldPlaced ? b : transformBlockState(b, frame),
        a,
      ),
    (x, y, z) => putVoxel(state, ownerPath, toW([x, y, z]), 'minecraft:air', null),
    (k, o, p) => resolvePaletteEntry(state, k, o, p ?? [0, 0, 0]),
    (c, m) => failEval(ownerPath, c, m),
    guard.canPlace,
  );
  const worldCells = res.roofCells.map(toW);
  guard.record(worldCells);
  state.roofCount += 1;
  if (res.hasTrim) state.hasRoofTrim = true;
  state.dormerCount += res.dormerCount;
  state.chimneyCount += res.chimneyCount;
  state.chimneyTops.push(...res.chimneyTops.map(toW));
  state.roofCells.push(...worldCells);
};

const evalSemanticOp = (
  state: EvalState,
  ownerPath: string,
  op: StructureOp,
  frame: FrameTransform,
  depth: number,
): boolean => {
  if (op.op === 'floor') evalFloorOp(state, ownerPath, op, frame, depth);
  else if (op.op === 'room') evalRoomOp(state, ownerPath, op, frame);
  else if (op.op === 'staircase') evalStairOp(state, ownerPath, op, frame);
  else if (op.op === 'roof') evalRoofOp(state, ownerPath, op, frame);
  else if (op.op === 'facade') {
    state.stats.facadeCount += 1;
    runFacadeOp(
      ownerPath,
      { ...op, targets: op.targets.map((t) => ({ ...t, wall: transformFacing(t.wall, frame) })) },
      state.rooms,
      state.openings,
      (x, y, z, s, a) => putVoxel(state, ownerPath, [x, y, z], s, a),
      (x, y, z) => putVoxel(state, ownerPath, [x, y, z], 'minecraft:air', null),
      (k, o, p) => resolvePaletteEntry(state, k, o, p),
      (c, m) => failEval(ownerPath, c, m),
    );
  } else if (op.op === 'furnish') evalFurnishOp(state, ownerPath, op, frame, depth);
  else if (op.op === 'compound_place') evalCompoundPlace(state, ownerPath, op, frame);
  else
    return runWeatherAndSocketOp(state, ownerPath, op, frame, (v) => evalVec3(state, ownerPath, v));
  return true;
};

const evalOp = (
  state: EvalState,
  ownerPath: string,
  op: StructureOp,
  frame: FrameTransform,
  depth: number,
): void => {
  if (++state.opCount > MAX_STRUCTURE_OPS || depth > 24)
    failEval(ownerPath, 'structure.budget', 'Structure evaluation exceeded budget');
  if (op.op === 'set') {
    state.stats.rawSetCount += 1;
    const pos = applyFrame(evalVec3(state, ownerPath, op.at), frame);
    const res = resolvePaletteEntry(state, op.block, ownerPath, pos);
    putVoxel(
      state,
      ownerPath,
      pos,
      transformBlockState(op.facing ? withBlockFacing(res.state, op.facing) : res.state, frame),
      res.assetAlias,
    );
  } else if (op.op === 'layer') {
    const [ox, oz] = evalVec2(state, ownerPath, op.origin);
    emitLayerOp(
      op,
      ox,
      oz,
      evalScalar(state, ownerPath, op.y),
      frame,
      ownerPath,
      (k, o, p) => resolvePaletteEntry(state, k, o, p),
      (p, s, a) => putVoxel(state, ownerPath, p, s, a),
      (c, m) => failEval(ownerPath, c, m),
    );
  } else if (op.op === 'repeat' || op.op === 'mirror' || op.op === 'place')
    evalTransformOp(state, ownerPath, op, frame, depth);
  else if (!evalSemanticOp(state, ownerPath, op, frame, depth)) {
    const reg = op as Extract<StructureOp, { op: 'box' | 'hollow' | 'walls' | 'frame' | 'carve' }>;
    emitRegionOp(
      reg,
      evalVec3(state, ownerPath, reg.from),
      evalVec3(state, ownerPath, reg.to),
      frame,
      ownerPath,
      (k, o, p) => resolvePaletteEntry(state, k, o, p),
      (p, s, a) => putVoxel(state, ownerPath, p, s, a),
    );
  }
};

const parseFacingOf = (state: string): CardinalFacing => {
  const f = parseBlockState(state).properties.facing;
  return f === 'south' || f === 'east' || f === 'west' ? f : 'north';
};

const finalizeEvalResult = (
  rootPath: string,
  root: StructureSourceUnit,
  state: EvalState,
): EvaluatedStructureResult => {
  const reachable = collectReachableUnits(rootPath, state.units, state.relative);
  for (const [filePath, unit] of state.units) {
    if (reachable.has(filePath))
      checkStructureUnitHygiene(
        filePath,
        rootPath,
        unit,
        state.usedImports,
        state.usedPaletteKeys,
        state.usedPrefabs,
        failEval,
      );
  }
  solveBlockConnections(state.voxels, state.states, state.stateToIdx, state.size);
  const rooms = resolveRoomEnclosure([...state.rooms.values()], state.voxels, state.size);
  const openings = resolveOpeningConnections(state.openings, rooms);
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
  for (const op of root.ops) evalOp(state, rootPath, op, IDENTITY_FRAME, 0);
  const result = finalizeEvalResult(rootPath, root, state);
  if (evaluatedGridCache) evaluatedGridCache.set(rootPath, deepFreeze(result));
  return result;
};
