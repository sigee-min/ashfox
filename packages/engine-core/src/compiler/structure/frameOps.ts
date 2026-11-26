import type {
  BlockRotation,
  CardinalFacing,
  IntVec3,
  StructureOp,
} from '../../project/structure/contract';
import {
  applyFrame,
  applyWeatheringRules,
  failEval,
  type EvalState,
  type FrameTransform,
} from './weathering';
import { buildSocketMeta, putVoxel, resolvePaletteEntry } from './jigsaw';

const CW_FACING: readonly CardinalFacing[] = ['north', 'east', 'south', 'west'];

export const transformFacing = (facing: CardinalFacing, frame: FrameTransform): CardinalFacing => {
  let mirrored = facing;
  if (frame.mirrorX) {
    if (facing === 'east') mirrored = 'west';
    else if (facing === 'west') mirrored = 'east';
  }
  return CW_FACING[(CW_FACING.indexOf(mirrored) + frame.rotate / 90) % 4]!;
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

export const runWeatherAndSocketOp = (
  state: EvalState,
  ownerPath: string,
  op: StructureOp,
  frame: FrameTransform,
  evalV3: (vec: Extract<StructureOp, { op: 'set' }>['at']) => IntVec3,
): boolean => {
  if (op.op === 'socket') {
    if (state.socketIds.has(op.name))
      failEval(ownerPath, 'structure.duplicate-socket', `Duplicate socket "${op.name}"`);
    state.socketIds.add(op.name);
    state.sockets.push(
      buildSocketMeta(
        op.name,
        op.kind,
        op.at ? applyFrame(evalV3(op.at), frame) : null,
        op.room ? state.rooms.get(op.room) : undefined,
        op.wall ? transformFacing(op.wall, frame) : undefined,
        op.normal ? transformFacing(op.normal, frame) : undefined,
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
