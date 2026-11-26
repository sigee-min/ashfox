import type { CardinalFacing, IntVec3, StructureOp } from '../../project/structure/contract';
import {
  isValidMinecraftState,
  parseBlockState,
  withBlockProperties,
} from '../../project/structure/state';
import type {
  StructureFloorMeta,
  StructureGrid,
  StructureOpeningMeta,
  StructureRoomMeta,
  StructureSocketMeta,
} from './contract';
import { applyFacadeTarget } from './facade';
import { emitRoof } from './roof';
import { emitStaircase } from './staircase';
import { failEval, pickWeightedState, type EvalState } from './weathering';

export interface JigsawBlockEntity {
  readonly pos: IntVec3;
  readonly stateString: string;
  readonly id: 'minecraft:jigsaw';
  readonly name: string;
  readonly target: string;
  readonly pool: string;
  readonly finalState: string;
  readonly joint: 'rollable' | 'aligned';
}

const ORIENTATION_BY_FACING: Readonly<Record<CardinalFacing, string>> = {
  north: 'north_up',
  south: 'south_up',
  east: 'east_up',
  west: 'west_up',
};

export const jigsawOrientationFor = (facing: CardinalFacing): string =>
  ORIENTATION_BY_FACING[facing];

const resourceLocation = (raw: string): string => {
  const clean = raw.toLowerCase().replace(/[^a-z0-9_.:/-]/gu, '_');
  return clean.includes(':') ? clean : `ashfox:${clean}`;
};

const toJigsawEntity = (
  grid: StructureGrid,
  socket: StructureSocketMeta,
): JigsawBlockEntity | null => {
  const [w, h, d] = grid.size;
  const x = Math.floor(socket.position[0]);
  const y = Math.floor(socket.position[1]);
  const z = Math.floor(socket.position[2]);
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return null;
  const idx = (y * d + z) * w + x;
  const stateIdx = grid.voxels[idx]!;
  const finalState = stateIdx > 0 ? (grid.states[stateIdx] ?? 'minecraft:air') : 'minecraft:air';
  return {
    pos: [x, y, z],
    stateString: `minecraft:jigsaw[orientation=${jigsawOrientationFor(socket.normal)}]`,
    id: 'minecraft:jigsaw',
    name: resourceLocation(socket.id),
    target: socket.target ? resourceLocation(socket.target) : 'minecraft:empty',
    pool: socket.pool ? resourceLocation(socket.pool) : 'minecraft:empty',
    finalState,
    joint:
      socket.schema === 'std.road' || socket.schema === 'std.courtyard' ? 'rollable' : 'aligned',
  };
};

export const collectJigsawEntities = (
  grid: StructureGrid,
): ReadonlyMap<string, JigsawBlockEntity> => {
  const byPos = new Map<string, JigsawBlockEntity>();
  for (const socket of grid.sockets) {
    const entity = toJigsawEntity(grid, socket);
    if (entity) byPos.set(`${entity.pos[0]},${entity.pos[1]},${entity.pos[2]}`, entity);
  }
  return byPos;
};

const roomWallCenter = (room: StructureRoomMeta, wall: CardinalFacing): IntVec3 => {
  const cx = Math.floor((room.from[0] + room.to[0]) / 2);
  const cz = Math.floor((room.from[2] + room.to[2]) / 2);
  const y = room.from[1] + 1;
  if (wall === 'north') return [cx, y, room.from[2]];
  if (wall === 'south') return [cx, y, room.to[2]];
  return wall === 'west' ? [room.from[0], y, cz] : [room.to[0], y, cz];
};

export const buildSocketMeta = (
  name: string,
  schema: string,
  atPos: IntVec3 | null,
  room: StructureRoomMeta | undefined,
  wall: CardinalFacing | undefined,
  facing: CardinalFacing | undefined,
  pool: string | undefined,
  target: string | undefined,
  fail: (code: string, msg: string) => never,
): StructureSocketMeta => {
  if (!atPos && !room) fail('structure.unknown-room', `Unknown room in anchor "${name}"`);
  const resolvedPos: IntVec3 = atPos
    ? room
      ? [room.from[0] + atPos[0], room.from[1] + atPos[1], room.from[2] + atPos[2]]
      : atPos
    : roomWallCenter(room!, facing ?? wall!);
  return {
    id: name,
    position: resolvedPos,
    normal: facing ?? wall ?? 'south',
    schema,
    ...(pool ? { pool } : {}),
    ...(target ? { target } : {}),
  };
};

export const runFacadeOp = (
  ownerPath: string,
  op: Extract<StructureOp, { op: 'facade' }>,
  rooms: ReadonlyMap<string, StructureRoomMeta>,
  openings: StructureOpeningMeta[],
  put: (x: number, y: number, z: number, state: string, alias: string | null) => void,
  carve: (x: number, y: number, z: number) => void,
  resolve: (
    key: string,
    owner: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null },
  fail: (code: string, msg: string) => never,
): void => {
  for (const target of op.targets) {
    const room = rooms.get(target.room);
    if (!room) fail('structure.unknown-room', `Unknown room "${target.room}" in facade`);
    openings.push(
      ...applyFacadeTarget(
        {
          ownerPath,
          room: room!,
          wall: target.wall,
          existingOpenings: openings,
          put,
          carve,
          resolve,
          fail,
        },
        op.openings,
      ),
    );
  }
};

export const runStaircaseOp = (
  ownerPath: string,
  size: IntVec3,
  voxels: Int32Array,
  op: Extract<StructureOp, { op: 'staircase' }>,
  at: readonly [number, number],
  yFrom: number,
  yTo: number,
  room: StructureRoomMeta | null,
  openings: readonly StructureOpeningMeta[],
  put: (x: number, y: number, z: number, state: string, alias: string | null) => void,
  carve: (x: number, y: number, z: number) => void,
  resolve: (
    key: string,
    owner: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null },
  fail: (code: string, msg: string) => never,
): void => {
  const [w, _h, d] = size;
  emitStaircase(
    {
      ownerPath,
      size,
      room,
      openings,
      isEmpty: (x, y, z) => voxels[(y * d + z) * w + x]! <= 0,
      put,
      carve,
      resolve,
      fail,
    },
    {
      style: op.style,
      at,
      yFrom,
      yTo,
      facing: op.facing,
      width: op.width ?? 1,
      stair: op.stair,
      landing: op.landing,
      rail: op.rail,
      headroom: op.headroom ?? 3,
    },
  );
};

const resolveRoofBounds = (
  on: string | undefined,
  size: IntVec3,
  explicitFrom: IntVec3 | null,
  explicitTo: IntVec3 | null,
  rooms: ReadonlyMap<string, StructureRoomMeta>,
  fail: (code: string, msg: string) => never,
): { readonly from: IntVec3; readonly to: IntVec3 } => {
  if (!on) return { from: explicitFrom!, to: explicitTo! };
  const targets =
    on === 'all'
      ? [...rooms.values()]
      : [rooms.get(on)].filter((r): r is StructureRoomMeta => Boolean(r));
  if (targets.length === 0) fail('structure.unknown-room', `Unknown roof room "${on}"`);
  return {
    from: [
      Math.min(...targets.map((r) => r.from[0])),
      Math.max(...targets.map((r) => r.to[1])),
      Math.min(...targets.map((r) => r.from[2])),
    ],
    to: [
      Math.max(...targets.map((r) => r.to[0])),
      size[1] - 1,
      Math.max(...targets.map((r) => r.to[2])),
    ],
  };
};

export const runRoofOp = (
  ownerPath: string,
  size: IntVec3,
  op: Extract<StructureOp, { op: 'roof' }>,
  explicitFrom: IntVec3 | null,
  explicitTo: IntVec3 | null,
  rooms: ReadonlyMap<string, StructureRoomMeta>,
  put: (x: number, y: number, z: number, state: string, alias: string | null) => void,
  carve: (x: number, y: number, z: number) => void,
  resolve: (
    key: string,
    owner: string,
    pos?: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null },
  fail: (code: string, msg: string) => never,
  canPlace?: (x: number, y: number, z: number, kind: 'roof' | 'gable') => boolean,
) => {
  const { from, to } = resolveRoofBounds(op.on, size, explicitFrom, explicitTo, rooms, fail);
  return emitRoof(
    {
      style: op.style,
      axis: op.axis,
      from,
      to,
      overhang: op.overhang ?? 0,
      pitch: op.pitch ?? 'standard',
      stair: op.stair,
      trim: op.trim,
      ridge: op.ridge,
      gable: op.gable,
      underEave: op.underEave,
      battlement: op.battlement,
      canPlace,
      dormers: op.dormers,
      chimneys: op.chimneys,
    },
    rooms,
    put,
    carve,
    resolve,
    ownerPath,
  );
};

export const finalizeEvaluatedGrid = (
  root: {
    readonly id: string;
    readonly dataVersion: number;
    readonly density: 1 | 2;
    readonly seed: number;
  },
  size: IntVec3,
  voxels: Int32Array,
  states: readonly string[],
  customTags: readonly (string | null)[],
  floors: readonly StructureFloorMeta[],
  rooms: readonly StructureRoomMeta[],
  openings: readonly StructureOpeningMeta[],
  sockets: readonly StructureSocketMeta[],
  hasRoofTrim: boolean,
  roofCount: number,
  dormerCount: number,
  chimneyCount: number,
  stats: {
    readonly roomCount: number;
    readonly facadeCount: number;
    readonly stairCount: number;
    readonly furnishCount: number;
    readonly weatheringCount: number;
    readonly rawSetCount: number;
  },
  customPlacements: StructureGrid['customPlacements'],
  interiors?: StructureGrid['interiors'],
): StructureGrid => ({
  id: root.id,
  dataVersion: root.dataVersion,
  density: root.density,
  seed: root.seed,
  size,
  states,
  voxels,
  customTags,
  customPlacements,
  floors,
  rooms,
  openings,
  sockets,
  hasRoofTrim,
  roofCount,
  dormerCount,
  chimneyCount,
  semanticStats: Object.freeze({ ...stats }),
  ...(interiors && interiors.length > 0 ? { interiors } : {}),
});

export const runHangItem = (
  ownerPath: string,
  room: StructureRoomMeta,
  block: string,
  at: CardinalFacing | 'ceiling_center',
  drop: number,
  put: (pos: IntVec3, state: string, alias: string | null) => void,
  resolve: (
    key: string,
    owner: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null },
): void => {
  const cx = Math.floor((room.from[0] + room.to[0]) / 2);
  const cz = Math.floor((room.from[2] + room.to[2]) / 2);
  const hx = at === 'west' ? room.from[0] + 1 : at === 'east' ? room.to[0] - 1 : cx;
  const hz = at === 'north' ? room.from[2] + 1 : at === 'south' ? room.to[2] - 1 : cz;
  const ceilY = room.to[1] - 1;
  for (let k = 0; k < drop - 1; k += 1) put([hx, ceilY - k, hz], 'minecraft:chain', null);
  const pos: IntVec3 = [hx, ceilY - (drop - 1), hz];
  const res = resolve(block, ownerPath, pos);
  const finalState = parseBlockState(res.state).name.includes('lantern')
    ? withBlockProperties(res.state, { hanging: 'true' })
    : res.state;
  put(pos, finalState, res.assetAlias);
};

export const stateIndex = (state: EvalState, blockState: string): number => {
  const existing = state.stateToIdx.get(blockState);
  if (existing !== undefined) return existing;
  const idx = state.states.length;
  state.states.push(blockState);
  state.stateToIdx.set(blockState, idx);
  return idx;
};

export const resolvePaletteEntry = (
  state: EvalState,
  keyOrState: string,
  ownerPath: string,
  pos: IntVec3 = [0, 0, 0],
): { readonly state: string; readonly assetAlias: string | null } => {
  if (keyOrState.includes(':')) {
    if (!isValidMinecraftState(keyOrState)) {
      return failEval(ownerPath, 'structure.invalid-block', `Invalid "${keyOrState}"`);
    }
    return { state: keyOrState, assetAlias: null };
  }
  const ownerUnit = state.units.get(ownerPath)!;
  const rootUnit = state.units.get(state.rootPath)!;
  const targetOwner = keyOrState in ownerUnit.palette ? ownerPath : state.rootPath;
  const entry = ownerUnit.palette[keyOrState] ?? rootUnit.palette[keyOrState];
  if (!entry) {
    return failEval(ownerPath, 'structure.unknown-block', `Unknown palette key "${keyOrState}"`);
  }
  state.usedPaletteKeys.get(targetOwner)?.add(keyOrState);
  if (entry.kind === 'block') return { state: entry.state, assetAlias: null };
  if (entry.kind === 'mix') {
    return { state: pickWeightedState(entry.entries, state.seed, pos), assetAlias: null };
  }
  state.usedImports.get(targetOwner)?.add(entry.alias);
  return { state: entry.fallback, assetAlias: `${targetOwner}#${entry.alias}` };
};

export const putVoxel = (
  state: EvalState,
  ownerPath: string,
  pos: IntVec3,
  blockState: string,
  assetAlias: string | null,
  protectAir = false,
): void => {
  const [w, h, d] = state.size;
  const [x, y, z] = pos;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) {
    failEval(ownerPath, 'structure.out-of-bounds', `(${x}, ${y}, ${z}) outside (${w}, ${h}, ${d})`);
  }
  const index = (y * d + z) * w + x;
  if (blockState === 'minecraft:air') {
    state.voxels[index] = 0;
    state.customTags[index] = null;
    if (protectAir) state.protectedAir[index] = 1;
    return;
  }
  state.voxels[index] = stateIndex(state, blockState);
  state.customTags[index] = assetAlias;
};

export const putUnprotected = (
  state: EvalState,
  ownerPath: string,
  pos: IntVec3,
  blockState: string,
  assetAlias: string | null,
): void => {
  const [w, _h, d] = state.size;
  if (!state.protectedAir[(pos[1] * d + pos[2]) * w + pos[0]]) {
    putVoxel(state, ownerPath, pos, blockState, assetAlias);
  }
};
