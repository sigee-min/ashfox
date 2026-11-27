import type { IntVec3, StructureOp } from '../../project/structure/contract';
import type { StructureFloorMeta } from './contract';
import { emitRoomShell } from './facade';
import {
  buildFrameRoofOp,
  emitRoomJetty,
  expandRoomInFloor,
  getRoofGuard,
  registerFloorJetty,
  runWeatherAndSocketOp,
  transformFacing,
  transformJetty,
  transformRoomBounds,
} from './frameOps';
import { runFacadeOp, runRoofOp, runStaircaseOp } from './jigsaw';
import { defineOpHandler, type StructureOpContext, type StructureOpHandler } from './opContext';
import { applyFrame, transformBlockState } from './weathering';

type ArchOpKind = 'floor' | 'room' | 'staircase' | 'roof' | 'facade' | 'interior' | 'weathering';

const handleFloorOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'floor' }>,
): void => {
  const { state, frame } = ctx;
  const y = ctx.evalScalar(op.y) + frame.offset[1];
  const height = ctx.evalScalar(op.height);
  if (height < 3 || y < 0 || y + height >= state.size[1]) {
    ctx.fail('structure.invalid-floor', `Floor "${op.name}" out of height`);
  }
  if (state.floorNames.has(op.name)) {
    ctx.fail('structure.duplicate-floor', `Duplicate floor "${op.name}"`);
  }
  state.floorNames.add(op.name);
  const jetty = transformJetty(op.jetty, frame);
  const meta: StructureFloorMeta = { name: op.name, y, height, ...(jetty ? { jetty } : {}) };
  registerFloorJetty(meta, op.ops, op.jetty, (v) => ctx.evalVec2(v));
  state.floors.push(meta);
  const prev = state.currentFloor;
  state.currentFloor = meta;
  for (const child of op.ops) ctx.evalChild(child);
  state.currentFloor = prev;
};

const handleRoomOp = (ctx: StructureOpContext, op: Extract<StructureOp, { op: 'room' }>): void => {
  const { state, ownerPath, frame } = ctx;
  const floor = state.currentFloor;
  if (!floor) {
    return ctx.fail('structure.room-no-floor', `Room "${op.name}" must be inside a floor`);
  }
  const [rawX, rawZ] = ctx.evalVec2(op.from);
  const [rawW, rawD] = ctx.evalVec2(op.size);
  if (rawW < 3 || rawD < 3) {
    return ctx.fail('structure.invalid-room', `Room "${op.name}" size >= 3x3`);
  }
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
    (p, s, a) => ctx.putVoxel(p, transformBlockState(s, frame), a),
    (p, s, a) => ctx.putUnprotected(p, transformBlockState(s, frame), a),
    (k, o, p) => ctx.resolvePalette(k, p, o),
    (c, m) => ctx.fail(c, m),
  );
  emitRoomJetty(state, ownerPath, op, bounds, exp.edges, frame);
  state.rooms.set(op.name, meta);
  state.stats.roomCount += 1;
  if (op.interior)
    state.interiorSpecs.push({ ownerPath, op: { ...op.interior, room: op.name }, frame });
};

const handleStairOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'staircase' }>,
): void => {
  const { state, ownerPath, frame } = ctx;
  const room = op.inRoom ? (state.rooms.get(op.inRoom) ?? null) : null;
  if (op.inRoom && !room) ctx.fail('structure.unknown-room', `Unknown room "${op.inRoom}"`);
  const yFrom =
    op.yFrom !== undefined
      ? ctx.evalScalar(op.yFrom) + frame.offset[1]
      : (room?.from[1] ?? state.currentFloor?.y ?? 0);
  const yTo =
    op.yTo !== undefined
      ? ctx.evalScalar(op.yTo) + frame.offset[1]
      : (room?.to[1] ??
        (state.currentFloor ? state.currentFloor.y + state.currentFloor.height : yFrom + 4));
  const [lx, lz] = ctx.evalVec2(op.at);
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
    (x, y, z, s, a) => ctx.putVoxel([x, y, z], s, a),
    (x, y, z) => ctx.putVoxel([x, y, z], 'minecraft:air', null, true),
    (k, o, p) => ctx.resolvePalette(k, p, o),
    (c, m) => ctx.fail(c, m),
  );
  state.stats.stairCount += 1;
};

const handleRoofOp = (ctx: StructureOpContext, op: Extract<StructureOp, { op: 'roof' }>): void => {
  const { state, ownerPath, frame } = ctx;
  const worldPlaced = Boolean(op.on);
  const guard = getRoofGuard(state, worldPlaced, frame);
  const toW = (c: IntVec3): IntVec3 => (worldPlaced ? c : applyFrame(c, frame));
  const res = runRoofOp(
    ownerPath,
    state.size,
    buildFrameRoofOp(op, frame),
    op.from ? ctx.evalVec3(op.from) : null,
    op.to ? ctx.evalVec3(op.to) : null,
    state.rooms,
    (x, y, z, b, a) =>
      ctx.putVoxel(toW([x, y, z]), worldPlaced ? b : transformBlockState(b, frame), a),
    (x, y, z) => ctx.putVoxel(toW([x, y, z]), 'minecraft:air', null),
    (k, o, p) => ctx.resolvePalette(k, p ?? [0, 0, 0], o),
    (c, m) => ctx.fail(c, m),
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

const handleFacadeOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'facade' }>,
): void => {
  const { state, ownerPath, frame } = ctx;
  state.stats.facadeCount += 1;
  runFacadeOp(
    ownerPath,
    { ...op, targets: op.targets.map((t) => ({ ...t, wall: transformFacing(t.wall, frame) })) },
    state.rooms,
    state.openings,
    (x, y, z, s, a) => ctx.putVoxel([x, y, z], s, a),
    (x, y, z) => ctx.putVoxel([x, y, z], 'minecraft:air', null),
    (k, o, p) => ctx.resolvePalette(k, p, o),
    (c, m) => ctx.fail(c, m),
  );
};

const handleInteriorOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'interior' }>,
): void => {
  ctx.state.interiorSpecs.push({ ownerPath: ctx.ownerPath, op, frame: ctx.frame });
};

const handleWeatheringOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'weathering' }>,
): void => {
  runWeatherAndSocketOp(ctx.state, ctx.ownerPath, op, ctx.frame, (v) => ctx.evalVec3(v));
};

export const ARCH_OP_HANDLERS: Readonly<Record<ArchOpKind, StructureOpHandler>> = {
  floor: defineOpHandler<'floor'>(handleFloorOp),
  room: defineOpHandler<'room'>(handleRoomOp),
  staircase: defineOpHandler<'staircase'>(handleStairOp),
  roof: defineOpHandler<'roof'>(handleRoofOp),
  facade: defineOpHandler<'facade'>(handleFacadeOp),
  interior: defineOpHandler<'interior'>(handleInteriorOp),
  weathering: defineOpHandler<'weathering'>(handleWeatheringOp),
};
