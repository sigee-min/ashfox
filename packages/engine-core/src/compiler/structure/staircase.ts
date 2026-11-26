import type {
  BlockRotation,
  CardinalFacing,
  IntVec2,
  IntVec3,
  StairStyle,
  StructureOp,
} from '../../project/structure/contract';
import { withBlockProperties } from '../../project/structure/state';
import type { StructureOpeningMeta, StructureRoomMeta } from './contract';
import { isOctagonOutside, isOctagonPerimeter } from './octagon';

export interface StaircaseInput {
  readonly style: StairStyle;
  readonly at: IntVec2;
  readonly yFrom: number;
  readonly yTo: number;
  readonly facing: CardinalFacing;
  readonly width: number;
  readonly stair: string;
  readonly landing?: string;
  readonly rail?: string;
  readonly headroom: number;
}

export interface StairEvalContext {
  readonly ownerPath: string;
  readonly size: IntVec3;
  readonly room: StructureRoomMeta | null;
  readonly openings: readonly StructureOpeningMeta[];
  readonly isEmpty: (x: number, y: number, z: number) => boolean;
  readonly put: (x: number, y: number, z: number, state: string, assetAlias: string | null) => void;
  readonly carve: (x: number, y: number, z: number) => void;
  readonly resolve: (
    keyOrState: string,
    ownerPath: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null };
  readonly fail: (code: string, message: string) => never;
}

const DIR: Readonly<Record<CardinalFacing, readonly [number, number]>> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

const RIGHT_DIR: Readonly<Record<CardinalFacing, CardinalFacing>> = {
  north: 'east',
  east: 'south',
  south: 'west',
  west: 'north',
};

const OPPOSITE: Readonly<Record<CardinalFacing, CardinalFacing>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const assertCellValid = (ctx: StairEvalContext, x: number, y: number, z: number): void => {
  const [w, h, d] = ctx.size;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) {
    ctx.fail('structure.stair-blocked', `Stair cell (${x}, ${y}, ${z}) out of grid bounds`);
  }
  if (ctx.room) {
    const r = ctx.room;
    if (
      x <= r.from[0] ||
      x >= r.to[0] ||
      z <= r.from[2] ||
      z >= r.to[2] ||
      (r.shape === 'octagon' &&
        (isOctagonOutside(x, z, r.from, r.to) || isOctagonPerimeter(x, z, r.from, r.to)))
    ) {
      ctx.fail('structure.stair-blocked', `Stair cell (${x}, ${y}, ${z}) outside room ${r.name}`);
    }
  }
  for (const op of ctx.openings) {
    if (
      x >= op.from[0] &&
      x <= op.to[0] &&
      y >= op.from[1] &&
      y <= op.to[1] &&
      z >= op.from[2] &&
      z <= op.to[2]
    ) {
      ctx.fail(
        'structure.stair-blocked',
        `Staircell (${x}, ${y}, ${z}) blocks opening in ${op.room}`,
      );
    }
  }
};

const carveHeadroom = (
  ctx: StairEvalContext,
  x: number,
  y: number,
  z: number,
  headroom: number,
): void => {
  const h = ctx.size[1];
  for (let hy = y + 1; hy <= Math.min(h - 1, y + headroom); hy += 1) {
    ctx.carve(x, hy, z);
  }
};

const placeStep = (
  ctx: StairEvalContext,
  input: StaircaseInput,
  x: number,
  y: number,
  z: number,
  facing: CardinalFacing,
): void => {
  assertCellValid(ctx, x, y, z);
  const res = ctx.resolve(input.stair, ctx.ownerPath, [x, y, z]);
  ctx.put(x, y, z, withBlockProperties(res.state, { facing, half: 'bottom' }), res.assetAlias);
  carveHeadroom(ctx, x, y, z, input.headroom);
};

const placeLanding = (
  ctx: StairEvalContext,
  input: StaircaseInput,
  x: number,
  y: number,
  z: number,
): void => {
  assertCellValid(ctx, x, y, z);
  const key = input.landing ?? input.stair;
  const res = ctx.resolve(key, ctx.ownerPath, [x, y, z]);
  ctx.put(x, y, z, res.state, res.assetAlias);
  carveHeadroom(ctx, x, y, z, input.headroom);
};

const tryPlaceRail = (
  ctx: StairEvalContext,
  input: StaircaseInput,
  x: number,
  y: number,
  z: number,
): void => {
  if (!input.rail) return;
  const [w, h, d] = ctx.size;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return;
  if (
    ctx.room &&
    (x <= ctx.room.from[0] || x >= ctx.room.to[0] || z <= ctx.room.from[2] || z >= ctx.room.to[2])
  ) {
    return;
  }
  if (!ctx.isEmpty(x, y, z)) return;
  const res = ctx.resolve(input.rail, ctx.ownerPath, [x, y, z]);
  ctx.put(x, y, z, res.state, res.assetAlias);
};

const placeStringerSupport = (
  ctx: StairEvalContext,
  input: StaircaseInput,
  x: number,
  y: number,
  z: number,
  facing: CardinalFacing,
): void => {
  if (y <= input.yFrom + 1 || !ctx.isEmpty(x, y - 1, z)) return;
  const res = ctx.resolve(input.stair, ctx.ownerPath, [x, y - 1, z]);
  ctx.put(
    x,
    y - 1,
    z,
    withBlockProperties(res.state, { facing: OPPOSITE[facing], half: 'top' }),
    res.assetAlias,
  );
};

const emitRun = (
  ctx: StairEvalContext,
  input: StaircaseInput,
  sx: number,
  sz: number,
  yStart: number,
  steps: number,
  facing: CardinalFacing,
): readonly [number, number] => {
  const [fx, fz] = DIR[facing];
  const [rx, rz] = DIR[RIGHT_DIR[facing]];
  for (let i = 0; i < steps; i += 1) {
    const y = yStart + i;
    for (let w = 0; w < input.width; w += 1) {
      const px = sx + fx * i + rx * w;
      const pz = sz + fz * i + rz * w;
      placeStep(ctx, input, px, y, pz, facing);
      placeStringerSupport(ctx, input, px, y, pz, facing);
    }
    tryPlaceRail(ctx, input, sx + fx * i - rx, y, sz + fz * i - rz);
    tryPlaceRail(ctx, input, sx + fx * i - rx, y + 1, sz + fz * i - rz);
    tryPlaceRail(ctx, input, sx + fx * i + rx * input.width, y, sz + fz * i + rz * input.width);
    tryPlaceRail(ctx, input, sx + fx * i + rx * input.width, y + 1, sz + fz * i + rz * input.width);
  }
  return [sx + fx * steps, sz + fz * steps];
};

const emitSpiral = (ctx: StairEvalContext, input: StaircaseInput, rise: number): void => {
  const [cx, cz] = input.at;
  const ring: readonly [number, number, CardinalFacing | null][] = [
    [0, -1, 'east'],
    [1, -1, null],
    [1, 0, 'south'],
    [1, 1, null],
    [0, 1, 'west'],
    [-1, 1, null],
    [-1, 0, 'north'],
    [-1, -1, null],
  ];
  const startOffset =
    input.facing === 'east' ? 0 : input.facing === 'south' ? 2 : input.facing === 'west' ? 4 : 6;
  for (let y = input.yFrom + 1; y <= input.yTo; y += 1) {
    const postKey = input.rail ?? input.landing ?? input.stair;
    const post = ctx.resolve(postKey, ctx.ownerPath, [cx, y, cz]);
    assertCellValid(ctx, cx, y, cz);
    ctx.put(cx, y, cz, post.state, post.assetAlias);
  }
  for (let i = 0; i < rise; i += 1) {
    const y = input.yFrom + 1 + i;
    const [dx, dz, dir] = ring[(startOffset + i) % ring.length]!;
    if (dir) placeStep(ctx, input, cx + dx, y, cz + dz, dir);
    else {
      placeLanding(ctx, input, cx + dx, y, cz + dz);
      placeStringerSupport(ctx, input, cx + dx, y, cz + dz, input.facing);
    }
  }
};

export const emitStaircase = (ctx: StairEvalContext, input: StaircaseInput): void => {
  if (input.headroom < 2 || input.yTo <= input.yFrom) {
    ctx.fail('structure.invalid-stair', 'Staircase requires headroom >= 2 and yTo > yFrom');
  }
  const rise = input.yTo - input.yFrom;
  if (input.style === 'spiral') {
    emitSpiral(ctx, input, rise);
    return;
  }
  if (input.style === 'straight') {
    emitRun(ctx, input, input.at[0], input.at[1], input.yFrom + 1, rise, input.facing);
    return;
  }
  const firstSteps = Math.max(1, Math.floor(rise / 2));
  const secondSteps = rise - firstSteps;
  const [lx, lz] = emitRun(
    ctx,
    input,
    input.at[0],
    input.at[1],
    input.yFrom + 1,
    firstSteps,
    input.facing,
  );
  const landY = input.yFrom + firstSteps;
  const turn = RIGHT_DIR[input.facing];
  const [tx, tz] = DIR[turn];
  const [fx, fz] = DIR[input.facing];
  for (let u = 0; u < input.width; u += 1) {
    for (let v = 0; v < input.width; v += 1) {
      placeLanding(ctx, input, lx + fx * u + tx * v, landY, lz + fz * u + tz * v);
    }
  }
  if (input.style === 'l_turn') {
    emitRun(ctx, input, lx + tx * input.width, lz + tz * input.width, landY + 1, secondSteps, turn);
    return;
  }
  for (let u = 0; u < input.width; u += 1) {
    for (let v = input.width; v < input.width * 2; v += 1) {
      placeLanding(ctx, input, lx + fx * u + tx * v, landY, lz + fz * u + tz * v);
    }
  }
  const back = OPPOSITE[input.facing];
  const [bx, bz] = DIR[back];
  emitRun(
    ctx,
    input,
    lx + tx * input.width + bx,
    lz + tz * input.width + bz,
    landY + 1,
    secondSteps,
    back,
  );
};

const computePtsBounds = (
  pts: readonly IntVec3[],
): { minX: number; maxX: number; minY: number; minZ: number; maxZ: number } => {
  if (pts.length === 0) return { minX: 0, maxX: 0, minY: 0, minZ: 0, maxZ: 0 };
  let minX = pts[0]![0];
  let maxX = minX;
  let minY = pts[0]![1];
  let minZ = pts[0]![2];
  let maxZ = minZ;
  for (let i = 1; i < pts.length; i += 1) {
    const [x, y, z] = pts[i]!;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minY, minZ, maxZ };
};

export const computeAnchoredOffset = (
  room: StructureRoomMeta,
  pts: readonly IntVec3[],
  anchor: CardinalFacing | 'nw' | 'ne' | 'sw' | 'se' | 'center',
  offset: IntVec2,
): IntVec3 => {
  const ix0 = room.from[0] + 1;
  const ix1 = room.to[0] - 1;
  const iz0 = room.from[2] + 1;
  const iz1 = room.to[2] - 1;
  const floorY = room.from[1] + 1;
  const { minX, maxX, minY, minZ, maxZ } = computePtsBounds(pts);
  const rw = maxX - minX + 1;
  const rd = maxZ - minZ + 1;
  const ax =
    (anchor === 'nw' || anchor === 'sw' || anchor === 'west'
      ? ix0
      : anchor === 'ne' || anchor === 'se' || anchor === 'east'
        ? ix1 - rw + 1
        : Math.floor((ix0 + ix1 - rw + 1) / 2)) + offset[0];
  const az =
    (anchor === 'nw' || anchor === 'ne' || anchor === 'north'
      ? iz0
      : anchor === 'sw' || anchor === 'se' || anchor === 'south'
        ? iz1 - rd + 1
        : Math.floor((iz0 + iz1 - rd + 1) / 2)) + offset[1];
  return [ax - minX, floorY - minY, az - minZ];
};

const collectLayerPoints = (
  op: Extract<StructureOp, { op: 'layer' }>,
  evalV2: (v: readonly [string | number, string | number]) => IntVec2,
  evalS: (s: string | number) => number,
  toWorld: (pt: IntVec3) => IntVec3,
  out: IntVec3[],
): void => {
  const [ox, oz] = evalV2(op.origin);
  const ly = evalS(op.y);
  for (let r = 0; r < op.rows.length; r += 1) {
    const row = op.rows[r]!;
    for (let c = 0; c < row.length; c += 1) {
      if (row[c] !== '.' && row[c] !== ' ') out.push(toWorld([ox + c, ly, oz + r]));
    }
  }
};

const collectChildCoord = (
  child: StructureOp,
  evalV2: (v: readonly [string | number, string | number]) => IntVec2,
  evalV3: (v: readonly [string | number, string | number, string | number]) => IntVec3,
  evalS: (s: string | number) => number,
  rotPt: (pt: IntVec3) => IntVec3,
  coords: IntVec3[],
  walk: (list: readonly StructureOp[]) => void,
): void => {
  if (child.op === 'set') coords.push(rotPt(evalV3(child.at)));
  else if (child.op === 'layer') collectLayerPoints(child, evalV2, evalS, rotPt, coords);
  else if ('from' in child && 'to' in child && child.from && child.to) {
    coords.push(rotPt(evalV3(child.from)), rotPt(evalV3(child.to)));
  } else if ('ops' in child) walk(child.ops);
};

export const collectPrefabLocalBounds = (
  ops: readonly StructureOp[],
  rotate: BlockRotation,
  evalV2: (v: readonly [string | number, string | number]) => IntVec2,
  evalV3: (v: readonly [string | number, string | number, string | number]) => IntVec3,
  evalS: (s: string | number) => number,
): readonly IntVec3[] => {
  const coords: IntVec3[] = [];
  const rotPt = ([x, y, z]: IntVec3): IntVec3 =>
    rotate === 90
      ? [-z, y, x]
      : rotate === 180
        ? [-x, y, -z]
        : rotate === 270
          ? [z, y, -x]
          : [x, y, z];
  const walk = (list: readonly StructureOp[]): void => {
    for (const child of list) collectChildCoord(child, evalV2, evalV3, evalS, rotPt, coords, walk);
  };
  walk(ops);
  return coords;
};
