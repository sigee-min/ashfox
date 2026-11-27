import type {
  BlockRotation,
  CardinalFacing,
  IntVec2,
  IntVec3,
  StructureOp,
} from '../../project/structure/contract';
import { applyCompoundChild } from './compound';
import { transformChildInterior } from './interior/compoundChild';
import type { StructureFloorMeta, StructureGrid } from './contract';
import {
  applyFrame,
  applyWeatheringRules,
  failEval,
  type EvalState,
  type FrameTransform,
} from './weathering';
import { buildSocketMeta, putVoxel, resolvePaletteEntry } from './jigsaw';
import {
  canPlaceRoofCell,
  collectFloorEnvelope,
  emitJettyApronAndCorbels,
  expandRoomForJetty,
  recordRoofMaxY,
  type FloorRoomEnvelope,
} from './massing';

const CW_FACING: readonly CardinalFacing[] = ['north', 'east', 'south', 'west'];

export const transformFacing = (facing: CardinalFacing, frame: FrameTransform): CardinalFacing => {
  let mirrored = facing;
  if (frame.mirrorX) {
    if (facing === 'east') mirrored = 'west';
    else if (facing === 'west') mirrored = 'east';
  }
  return CW_FACING[(CW_FACING.indexOf(mirrored) + frame.rotate / 90) % 4]!;
};

export const transformJetty = (
  jetty: Readonly<Partial<Record<CardinalFacing, number>>> | undefined,
  frame: FrameTransform,
): Readonly<Partial<Record<CardinalFacing, number>>> | undefined => {
  if (!jetty) return undefined;
  const out: Partial<Record<CardinalFacing, number>> = {};
  for (const dir of CW_FACING) {
    const val = jetty[dir];
    if (val !== undefined && val > 0) out[transformFacing(dir, frame)] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

export const transformRoomBounds = (
  rx: number,
  rz: number,
  rw: number,
  rd: number,
  floorY: number,
  floorH: number,
  frame: FrameTransform,
): { readonly from: IntVec3; readonly to: IntVec3 } => {
  const c0 = applyFrame([rx, 0, rz], frame);
  const c1 = applyFrame([rx + rw - 1, 0, rz + rd - 1], frame);
  return {
    from: [Math.min(c0[0], c1[0]), floorY, Math.min(c0[2], c1[2])],
    to: [Math.max(c0[0], c1[0]), floorY + floorH, Math.max(c0[2], c1[2])],
  };
};

export const composeRotation = (rotate: BlockRotation, frame: FrameTransform): BlockRotation =>
  ((((frame.mirrorX ? frame.rotate - rotate : frame.rotate + rotate) % 360) + 360) %
    360) as BlockRotation;

const ROTATE_CORNER: Readonly<Record<'nw' | 'ne' | 'se' | 'sw', readonly [number, number]>> = {
  nw: [-1, -1],
  ne: [1, -1],
  se: [1, 1],
  sw: [-1, 1],
};

const cornerFromSign = (fx: number, fz: number): 'nw' | 'ne' | 'sw' | 'se' => {
  if (fx < 0) return fz < 0 ? 'nw' : 'sw';
  return fz < 0 ? 'ne' : 'se';
};

export const transformAnchor = (
  anchor: CardinalFacing | 'nw' | 'ne' | 'sw' | 'se' | 'center',
  frame: FrameTransform,
): CardinalFacing | 'nw' | 'ne' | 'sw' | 'se' | 'center' => {
  if (anchor === 'center') return 'center';
  if (anchor === 'north' || anchor === 'south' || anchor === 'east' || anchor === 'west') {
    return transformFacing(anchor, frame);
  }
  const [vx, vz] = ROTATE_CORNER[anchor];
  const [fx, _fy, fz] = applyFrame([vx, 0, vz], {
    offset: [0, 0, 0],
    rotate: frame.rotate,
    mirrorX: frame.mirrorX,
  });
  return cornerFromSign(fx, fz);
};

export const buildFrameRoofOp = (
  op: Extract<StructureOp, { op: 'roof' }>,
  frame: FrameTransform,
): Extract<StructureOp, { op: 'roof' }> => {
  if (!op.on) return op;
  const swapAxis = frame.rotate === 90 || frame.rotate === 270;
  return {
    ...op,
    axis: swapAxis ? (op.axis === 'x' ? 'z' : 'x') : op.axis,
    ...(op.dormers
      ? { dormers: op.dormers.map((d) => ({ ...d, wall: transformFacing(d.wall, frame) })) }
      : {}),
    ...(op.chimneys
      ? {
          chimneys: op.chimneys.map((c) => ({
            ...c,
            corner: transformAnchor(c.corner, frame) as typeof c.corner,
          })),
        }
      : {}),
  };
};

const SOCKET_SCHEMAS = new Set(['std.entry', 'std.road', 'std.wall_join', 'std.courtyard']);

export const runWeatherAndSocketOp = (
  state: EvalState,
  ownerPath: string,
  op: StructureOp,
  frame: FrameTransform,
  evalV3: (vec: Extract<StructureOp, { op: 'set' }>['at']) => IntVec3,
): boolean => {
  if (op.op === 'hook_decl') return true;
  if (op.op === 'anchor') {
    if (!SOCKET_SCHEMAS.has(op.schema)) return true;
    if (state.socketIds.has(op.name))
      failEval(ownerPath, 'structure.duplicate-socket', `Duplicate anchor "${op.name}"`);
    state.socketIds.add(op.name);
    state.sockets.push(
      buildSocketMeta(
        op.name,
        op.schema,
        op.at ? applyFrame(evalV3(op.at), frame) : null,
        op.room ? state.rooms.get(op.room) : undefined,
        op.wall ? transformFacing(op.wall, frame) : undefined,
        op.facing ? transformFacing(op.facing, frame) : undefined,
        op.pool,
        op.target,
        (c, m) => failEval(ownerPath, c, m),
      ),
    );
    return true;
  }
  if (op.op === 'weathering') {
    state.stats.weatheringCount += 1;
    applyWeatheringRules(
      {
        seed: state.seed,
        size: state.size,
        voxels: state.voxels,
        states: state.states,
        rooms: [...state.rooms.values()],
        roofCells: state.roofCells,
        chimneyTops: state.chimneyTops,
        openings: state.openings,
        protectedAir: state.protectedAir,
        customTags: state.customTags,
        ownerPath,
        resolve: (k, o, p) => resolvePaletteEntry(state, k, o, p),
        put: (x, y, z, s, a) => putVoxel(state, ownerPath, [x, y, z], s, a),
      },
      op.rules,
    );
    return true;
  }
  return false;
};

interface FloorJettyState {
  readonly envelope: FloorRoomEnvelope | null;
  readonly localJetty: Readonly<Partial<Record<CardinalFacing, number>>> | undefined;
}

const floorJettyMap = new WeakMap<StructureFloorMeta, FloorJettyState>();
const roofHeightMap = new WeakMap<EvalState, Int16Array>();

export const registerFloorJetty = (
  meta: StructureFloorMeta,
  ops: readonly StructureOp[],
  localJetty: Readonly<Partial<Record<CardinalFacing, number>>> | undefined,
  evalV2: (vec: readonly [string | number, string | number]) => IntVec2,
): void => {
  floorJettyMap.set(meta, {
    envelope: localJetty ? collectFloorEnvelope(ops, evalV2) : null,
    localJetty,
  });
};

export const expandRoomInFloor = (
  floor: StructureFloorMeta,
  rx: number,
  rz: number,
  rw: number,
  rd: number,
) => {
  const info = floorJettyMap.get(floor);
  return expandRoomForJetty(rx, rz, rw, rd, info?.envelope ?? null, info?.localJetty);
};

export const emitRoomJetty = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'room' }>,
  bounds: { readonly from: IntVec3; readonly to: IntVec3 },
  edges: Readonly<Partial<Record<CardinalFacing, number>>>,
  frame: FrameTransform,
): void => {
  const worldEdges = transformJetty(edges, frame);
  if (!worldEdges) return;
  const [w, h, d] = state.size;
  emitJettyApronAndCorbels({
    ownerPath,
    shape: op.shape,
    from: bounds.from,
    to: bounds.to,
    edges: worldEdges,
    beamKey: op.frame ?? op.floor ?? op.wall,
    isEmpty: (x, y, z) =>
      x >= 0 &&
      x < w &&
      y >= 0 &&
      y < h &&
      z >= 0 &&
      z < d &&
      state.voxels[(y * d + z) * w + x]! <= 0,
    put: (p, s, a) => putVoxel(state, ownerPath, p, s, a),
    resolve: (k, o, p) => resolvePaletteEntry(state, k, o, p),
  });
};

export const getRoofGuard = (state: EvalState, worldPlaced: boolean, frame: FrameTransform) => {
  let roofMaxY = roofHeightMap.get(state);
  if (!roofMaxY) {
    roofMaxY = new Int16Array(state.size[0] * state.size[2]).fill(-1);
    roofHeightMap.set(state, roofMaxY);
  }
  return {
    canPlace: (x: number, y: number, z: number, kind: 'roof' | 'gable'): boolean =>
      canPlaceRoofCell(
        roofMaxY!,
        state.voxels,
        state.size,
        state.rooms,
        worldPlaced ? [x, y, z] : applyFrame([x, y, z], frame),
        kind,
      ),
    record: (cells: readonly IntVec3[]): void => recordRoofMaxY(roofMaxY!, state.size, cells),
  };
};

export const runCompoundMerge = (
  state: EvalState,
  ownerPath: string,
  alias: string,
  childPath: string,
  childResult: {
    readonly grid: StructureGrid;
    readonly prefabUses: number;
    readonly compoundChildren?: readonly EvalState['compoundChildren'][number][];
  },
  origin: IntVec3,
  rotate: BlockRotation,
): void => {
  state.compoundChildren.push({
    unitPath: childPath,
    alias,
    origin,
    rotate,
    grid: childResult.grid,
    ...(childResult.compoundChildren ? { compoundChildren: childResult.compoundChildren } : {}),
  });
  const target = {
    ...state,
    put: (x: number, y: number, z: number, s: string, a: string | null) =>
      putVoxel(state, ownerPath, [x, y, z], s, a),
    carve: (x: number, y: number, z: number) =>
      putVoxel(state, ownerPath, [x, y, z], 'minecraft:air', null),
  };
  applyCompoundChild(target, alias, childResult, origin, rotate);
  for (const room of childResult.grid.interiors ?? []) {
    state.childInteriors.push(
      transformChildInterior(room, alias, childResult.grid.size, origin, rotate),
    );
  }
  state.roofCount = target.roofCount;
  state.dormerCount = target.dormerCount;
  state.chimneyCount = target.chimneyCount;
  state.hasRoofTrim = target.hasRoofTrim;
  state.prefabUses = target.prefabUses;
};
