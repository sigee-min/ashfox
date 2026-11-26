import type {
  AcousticSpace,
  CardinalFacing,
  FacadeOpeningSpec,
  IntVec3,
  RoomKind,
} from '../../project/structure/contract';
import { withBlockFacing, withBlockProperties } from '../../project/structure/state';
import type { StructureOpeningMeta, StructureRoomMeta } from './contract';
import {
  emitArcadeOpening,
  emitBayWindow,
  emitPorchStructure,
  type MassingOpeningCtx,
} from './massing';
import { isOctagonCorner, isOctagonOutside, isOctagonPerimeter, octagonWallRange } from './octagon';

export interface FacadeEvalContext {
  readonly ownerPath: string;
  readonly room: StructureRoomMeta;
  readonly wall: CardinalFacing;
  readonly existingOpenings: readonly StructureOpeningMeta[];
  readonly put: (x: number, y: number, z: number, state: string, assetAlias: string | null) => void;
  readonly carve: (x: number, y: number, z: number) => void;
  readonly resolve: (
    keyOrState: string,
    ownerPath: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null };
  readonly fail: (code: string, message: string) => never;
}

const OPPOSITE: Readonly<Record<CardinalFacing, CardinalFacing>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const OUTWARD: Readonly<Record<CardinalFacing, readonly [number, number]>> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

interface WallFrame {
  readonly spanLen: number;
  readonly minY: number;
  readonly maxY: number;
  readonly cellAt: (u: number, depthOffset?: number) => readonly [number, number];
}

const buildWallFrame = (room: StructureRoomMeta, wall: CardinalFacing): WallFrame => {
  const [x0, y0, z0] = room.from;
  const [x1, y1, z1] = room.to;
  const [ox, oz] = OUTWARD[wall];
  const [u0, u1] =
    room.shape === 'octagon'
      ? octagonWallRange(room.from, room.to, wall)
      : wall === 'north' || wall === 'south'
        ? [x0 + 1, x1 - 1]
        : [z0 + 1, z1 - 1];
  const spanLen = u1 - u0 + 1;
  if (wall === 'north' || wall === 'south') {
    const zBase = wall === 'north' ? z0 : z1;
    return {
      spanLen,
      minY: y0 + 1,
      maxY: y1 - 1,
      cellAt: (u, d = 0) => [u0 + u + ox * d, zBase + oz * d],
    };
  }
  const xBase = wall === 'west' ? x0 : x1;
  return {
    spanLen,
    minY: y0 + 1,
    maxY: y1 - 1,
    cellAt: (u, d = 0) => [xBase + ox * d, u0 + u + oz * d],
  };
};

const resolveUOffsets = (
  ctx: FacadeEvalContext,
  frame: WallFrame,
  spec: FacadeOpeningSpec,
): readonly number[] => {
  const p = spec.placement;
  if (p.mode === 'at') {
    const base = p.at === 'center' ? Math.floor((frame.spanLen - spec.width) / 2) : p.at;
    return [base + (p.offset ?? 0)];
  }
  if (p.mode === 'symmetric') {
    const left = p.offset;
    const right = frame.spanLen - spec.width - p.offset;
    if (left === right) return [left];
    if (left + spec.width > right)
      ctx.fail('structure.opening-overlap', `Symmetric overlap on ${ctx.room.name}.${ctx.wall}`);
    return [left, right];
  }
  if (p.count === 1) return [Math.floor((frame.spanLen - spec.width) / 2)];
  const step = Math.floor((frame.spanLen - 2 * p.margin - spec.width) / (p.count - 1));
  if (step < spec.width)
    ctx.fail(
      'structure.facade-out-of-bounds',
      `Repeat out of bounds on ${ctx.room.name}.${ctx.wall}`,
    );
  return Array.from({ length: p.count }, (_, i) => p.margin + i * step);
};

const checkOpeningBounds = (
  ctx: FacadeEvalContext,
  frame: WallFrame,
  u0: number,
  y0: number,
  spec: FacadeOpeningSpec,
): StructureOpeningMeta => {
  const u1 = u0 + spec.width - 1;
  const y1 = y0 + spec.height - 1;
  if (u0 < 0 || u1 >= frame.spanLen || y0 < frame.minY || y1 > frame.maxY) {
    ctx.fail(
      'structure.facade-out-of-bounds',
      `Opening out of bounds on ${ctx.room.name}.${ctx.wall}`,
    );
  }
  const [sx0, sz0] = frame.cellAt(u0);
  const [sx1, sz1] = frame.cellAt(u1);
  const meta: StructureOpeningMeta = {
    kind: spec.kind,
    room: ctx.room.name,
    wall: ctx.wall,
    from: [Math.min(sx0, sx1), y0, Math.min(sz0, sz1)],
    to: [Math.max(sx0, sx1), y1, Math.max(sz0, sz1)],
    ...(spec.hinge ? { hinge: spec.hinge } : {}),
  };
  for (const prev of ctx.existingOpenings) {
    if (prev.room !== meta.room || prev.wall !== meta.wall) continue;
    const hit =
      meta.from[0] <= prev.to[0] &&
      meta.to[0] >= prev.from[0] &&
      meta.from[1] <= prev.to[1] &&
      meta.to[1] >= prev.from[1] &&
      meta.from[2] <= prev.to[2] &&
      meta.to[2] >= prev.from[2];
    if (hit)
      ctx.fail('structure.opening-overlap', `Overlapping openings on ${ctx.room.name}.${ctx.wall}`);
  }
  return meta;
};

const emitSillAndLintel = (
  ctx: FacadeEvalContext,
  frame: WallFrame,
  u0: number,
  y0: number,
  y1: number,
  spec: FacadeOpeningSpec,
): void => {
  if (spec.sill && y0 - 1 >= ctx.room.from[1]) {
    for (let u = u0; u < u0 + spec.width; u += 1) {
      const [sx, sz] = frame.cellAt(u, 1);
      const res = ctx.resolve(spec.sill, ctx.ownerPath, [sx, y0 - 1, sz]);
      ctx.put(sx, y0 - 1, sz, res.state, res.assetAlias);
    }
  }
  if (spec.lintel && y1 + 1 <= ctx.room.to[1]) {
    for (let u = u0 - 1; u <= u0 + spec.width; u += 1) {
      if (u < -1 || u > frame.spanLen) continue;
      const [lx, lz] = frame.cellAt(u, spec.recess ? 0 : 1);
      const res = ctx.resolve(spec.lintel, ctx.ownerPath, [lx, y1 + 1, lz]);
      ctx.put(lx, y1 + 1, lz, res.state, res.assetAlias);
    }
  }
};

const emitShutterPair = (
  ctx: FacadeEvalContext,
  frame: WallFrame,
  su: number,
  y0: number,
  y1: number,
  shutter: string,
): void => {
  if (su < 0 || su >= frame.spanLen) return;
  for (let y = y0; y <= y1; y += 1) {
    const [bx, bz] = frame.cellAt(su, 1);
    const res = ctx.resolve(shutter, ctx.ownerPath, [bx, y, bz]);
    ctx.put(bx, y, bz, withBlockProperties(res.state, { facing: ctx.wall, open: 'true' }), null);
  }
};

const emitFramePair = (
  ctx: FacadeEvalContext,
  frame: WallFrame,
  fu: number,
  y0: number,
  y1: number,
  frameKey: string,
): void => {
  const minU = ctx.room.shape === 'octagon' ? 0 : -1;
  const maxU = ctx.room.shape === 'octagon' ? frame.spanLen - 1 : frame.spanLen;
  if (fu < minU || fu > maxU) return;
  for (let y = y0; y <= y1; y += 1) {
    const [fx, fz] = frame.cellAt(fu, 0);
    const res = ctx.resolve(frameKey, ctx.ownerPath, [fx, y, fz]);
    ctx.put(fx, y, fz, res.state, res.assetAlias);
  }
};

const emitShuttersAndFrame = (
  ctx: FacadeEvalContext,
  frame: WallFrame,
  u0: number,
  y0: number,
  y1: number,
  spec: FacadeOpeningSpec,
): void => {
  if (spec.shutter) {
    emitShutterPair(ctx, frame, u0 - 1, y0, y1, spec.shutter);
    emitShutterPair(ctx, frame, u0 + spec.width, y0, y1, spec.shutter);
  }
  if (spec.frame) {
    emitFramePair(ctx, frame, u0 - 1, y0, y1, spec.frame);
    emitFramePair(ctx, frame, u0 + spec.width, y0, y1, spec.frame);
  }
};

const placeDoorCell = (
  ctx: FacadeEvalContext,
  wx: number,
  y: number,
  wz: number,
  y0: number,
  col: number,
  spec: FacadeOpeningSpec,
): void => {
  const res = ctx.resolve(spec.block ?? 'minecraft:oak_door', ctx.ownerPath, [wx, y, wz]);
  const half = y === y0 ? 'lower' : 'upper';
  const hinge = spec.width >= 2 && col >= spec.width / 2 ? 'right' : (spec.hinge ?? 'left');
  const state = withBlockProperties(withBlockFacing(res.state, OPPOSITE[ctx.wall]), {
    half,
    hinge,
    open: 'false',
  });
  ctx.put(wx, y, wz, state, res.assetAlias);
};

const emitSingleOpening = (
  ctx: FacadeEvalContext,
  frame: WallFrame,
  u0: number,
  y0: number,
  spec: FacadeOpeningSpec,
): void => {
  const y1 = y0 + spec.height - 1;
  if (spec.kind === 'bay_window' || spec.kind === 'arcade') {
    const mCtx: MassingOpeningCtx = {
      ownerPath: ctx.ownerPath,
      wall: ctx.wall,
      roomFromY: ctx.room.from[1],
      roomToY: ctx.room.to[1],
      spanLen: frame.spanLen,
      cellAt: frame.cellAt,
      put: ctx.put,
      carve: ctx.carve,
      resolve: ctx.resolve,
    };
    if (spec.kind === 'bay_window') emitBayWindow(mCtx, u0, y0, y1, spec);
    else emitArcadeOpening(mCtx, u0, y0, y1, spec, undefined);
    emitShuttersAndFrame(ctx, frame, u0, y0, y1, spec);
    return;
  }
  for (let col = 0; col < spec.width; col += 1) {
    const [wx, wz] = frame.cellAt(u0 + col, 0);
    for (let y = y0; y <= y1; y += 1) {
      ctx.carve(wx, y, wz);
      if (spec.kind === 'door') placeDoorCell(ctx, wx, y, wz, y0, col, spec);
      else if (spec.kind === 'window') {
        const res = ctx.resolve(spec.glass ?? 'minecraft:glass_pane', ctx.ownerPath, [wx, y, wz]);
        ctx.put(wx, y, wz, res.state, res.assetAlias);
      }
    }
  }
  emitSillAndLintel(ctx, frame, u0, y0, y1, spec);
  emitShuttersAndFrame(ctx, frame, u0, y0, y1, spec);
  if (spec.kind === 'door' && spec.porch) {
    emitPorchStructure(
      {
        ownerPath: ctx.ownerPath,
        wall: ctx.wall,
        roomFromY: ctx.room.from[1],
        shape: ctx.room.shape,
        spanLen: frame.spanLen,
        cellAt: frame.cellAt,
        put: ctx.put,
        resolve: ctx.resolve,
      },
      u0,
      y0,
      y1,
      spec.width,
      spec.porch,
    );
  }
};

export const applyFacadeTarget = (
  ctx: FacadeEvalContext,
  openings: readonly FacadeOpeningSpec[],
): readonly StructureOpeningMeta[] => {
  const frame = buildWallFrame(ctx.room, ctx.wall);
  const created: StructureOpeningMeta[] = [];
  for (const spec of openings) {
    const y0 = frame.minY + (spec.yOffset ?? (spec.kind === 'window' ? 1 : 0));
    for (const u0 of resolveUOffsets(ctx, frame, spec)) {
      const meta = checkOpeningBounds(
        { ...ctx, existingOpenings: [...ctx.existingOpenings, ...created] },
        frame,
        u0,
        y0,
        spec,
      );
      emitSingleOpening(ctx, frame, u0, y0, spec);
      created.push(meta);
    }
  }
  return created;
};

export interface RoomShellSpec {
  readonly name: string;
  readonly kind: RoomKind;
  readonly shape?: 'rect' | 'octagon';
  readonly from: IntVec3;
  readonly to: IntVec3;
  readonly plinth?: string;
  readonly floor?: string;
  readonly wall?: string;
  readonly frame?: string;
  readonly ceiling?: string;
}

export const inferRoomAcousticSpace = (
  kind: RoomKind,
  w: number,
  d: number,
  wallKey: string | undefined,
): AcousticSpace => {
  if (kind === 'courtyard') return 'outdoor';
  if ((w - 2) * (d - 2) <= 12) return 'small_chamber';
  if (kind === 'tower' || (wallKey && /stone|brick|cobble|deepslate/u.test(wallKey)))
    return 'stone_hall';
  return 'timber_room';
};

const assertNoRoomOverlap = (
  name: string,
  from: IntVec3,
  to: IntVec3,
  existingRooms: ReadonlyMap<string, StructureRoomMeta>,
  fail: (code: string, message: string) => never,
): void => {
  if (existingRooms.has(name)) fail('structure.duplicate-room', `Duplicate room "${name}"`);
  for (const prev of existingRooms.values()) {
    if (from[1] >= prev.to[1] || to[1] <= prev.from[1]) continue;
    const ox = from[0] + 1 <= prev.to[0] - 1 && to[0] - 1 >= prev.from[0] + 1;
    const oz = from[2] + 1 <= prev.to[2] - 1 && to[2] - 1 >= prev.from[2] + 1;
    if (ox && oz) fail('structure.room-overlap', `Room "${name}" overlaps room "${prev.name}"`);
  }
};

const fillRoomVertical = (
  spec: RoomShellSpec,
  ownerPath: string,
  x: number,
  z: number,
  onPerim: boolean,
  wallKey: string | undefined,
  put: (pos: IntVec3, state: string, assetAlias: string | null) => void,
  putUnprotected: (pos: IntVec3, state: string, assetAlias: string | null) => void,
  resolve: (
    keyOrState: string,
    ownerPath: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null },
): void => {
  for (let y = spec.from[1] + 1; y <= spec.to[1] - 1; y += 1) {
    if (!onPerim) putUnprotected([x, y, z], 'minecraft:air', null);
    else if (wallKey) {
      const res = resolve(wallKey, ownerPath, [x, y, z]);
      put([x, y, z], res.state, res.assetAlias);
    }
  }
};

const roomCellRoles = (
  spec: RoomShellSpec,
  x: number,
  z: number,
): { readonly onPerim: boolean; readonly isCorner: boolean } | null => {
  if (spec.shape === 'octagon') {
    if (isOctagonOutside(x, z, spec.from, spec.to)) return null;
    return {
      onPerim: isOctagonPerimeter(x, z, spec.from, spec.to),
      isCorner: isOctagonCorner(x, z, spec.from, spec.to),
    };
  }
  const [x0, _y0, z0] = spec.from;
  const [x1, _y1, z1] = spec.to;
  return {
    onPerim: x === x0 || x === x1 || z === z0 || z === z1,
    isCorner: (x === x0 || x === x1) && (z === z0 || z === z1),
  };
};

const fillRoomColumn = (
  spec: RoomShellSpec,
  ownerPath: string,
  x: number,
  z: number,
  put: (pos: IntVec3, state: string, assetAlias: string | null) => void,
  putUnprotected: (pos: IntVec3, state: string, assetAlias: string | null) => void,
  resolve: (
    keyOrState: string,
    ownerPath: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null },
): void => {
  const roles = roomCellRoles(spec, x, z);
  if (!roles) return;
  const { onPerim, isCorner } = roles;
  const y0 = spec.from[1];
  const y1 = spec.to[1];
  const baseKey = onPerim ? (spec.plinth ?? spec.wall ?? spec.floor) : spec.floor;
  if (baseKey) {
    const res = resolve(baseKey, ownerPath, [x, y0, z]);
    putUnprotected([x, y0, z], res.state, res.assetAlias);
  }
  const wallKey = isCorner && spec.frame ? spec.frame : spec.wall;
  fillRoomVertical(spec, ownerPath, x, z, onPerim, wallKey, put, putUnprotected, resolve);
  const topKey = onPerim ? (spec.frame ?? spec.wall ?? spec.ceiling) : spec.ceiling;
  if (spec.kind !== 'courtyard' && topKey) {
    const res = resolve(topKey, ownerPath, [x, y1, z]);
    putUnprotected([x, y1, z], res.state, res.assetAlias);
  }
};

export const emitRoomShell = (
  spec: RoomShellSpec,
  ownerPath: string,
  existingRooms: ReadonlyMap<string, StructureRoomMeta>,
  put: (pos: IntVec3, state: string, assetAlias: string | null) => void,
  putUnprotected: (pos: IntVec3, state: string, assetAlias: string | null) => void,
  resolve: (
    keyOrState: string,
    ownerPath: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null },
  fail: (code: string, message: string) => never,
): StructureRoomMeta => {
  assertNoRoomOverlap(spec.name, spec.from, spec.to, existingRooms, fail);
  for (let z = spec.from[2]; z <= spec.to[2]; z += 1) {
    for (let x = spec.from[0]; x <= spec.to[0]; x += 1) {
      fillRoomColumn(spec, ownerPath, x, z, put, putUnprotected, resolve);
    }
  }
  return {
    name: spec.name,
    kind: spec.kind,
    acousticSpace: inferRoomAcousticSpace(
      spec.kind,
      spec.to[0] - spec.from[0] + 1,
      spec.to[2] - spec.from[2] + 1,
      spec.wall,
    ),
    from: spec.from,
    to: spec.to,
    enclosed: spec.kind !== 'courtyard',
    ...(spec.shape ? { shape: spec.shape } : {}),
  };
};
