import type { CardinalFacing, IntVec3 } from '../../project/structure/contract';
import {
  formatBlockState,
  parseBlockState,
  withBlockProperties,
} from '../../project/structure/state';
import type { StructureOpeningMeta, StructureRoomMeta } from './contract';

const DIRS: Readonly<Record<CardinalFacing, readonly [number, number]>> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};
const TURN_LEFT: Readonly<Record<CardinalFacing, CardinalFacing>> = {
  north: 'west',
  west: 'south',
  south: 'east',
  east: 'north',
};
const TURN_RIGHT: Readonly<Record<CardinalFacing, CardinalFacing>> = {
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

const NON_SOLID_TOKENS = [
  '_stairs',
  '_slab',
  '_fence',
  '_wall',
  '_pane',
  '_bars',
  '_door',
  '_trapdoor',
  'torch',
  'lantern',
  'bed',
  'chest',
  'ladder',
  'carpet',
  'chain',
  'flower_pot',
  'campfire',
  'leaves',
  'glass',
  'anvil',
  'cauldron',
  'air',
];

const isFullSolidName = (name: string): boolean => !NON_SOLID_TOKENS.some((t) => name.includes(t));
const isStairName = (name: string): boolean => name.endsWith('_stairs');
const isFenceName = (name: string): boolean => name.endsWith('_fence');
const isWallName = (name: string): boolean => name.endsWith('_wall');
const isPaneName = (name: string): boolean =>
  name.endsWith('_pane') || name === 'minecraft:iron_bars';

const readFacing = (props: Readonly<Record<string, string>>): CardinalFacing => {
  const f = props.facing;
  return f === 'south' || f === 'east' || f === 'west' ? f : 'north';
};

const stateAt = (
  voxels: Int32Array,
  states: readonly string[],
  [w, h, d]: IntVec3,
  x: number,
  y: number,
  z: number,
): string | null => {
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return null;
  const idx = voxels[(y * d + z) * w + x]!;
  return idx > 0 ? states[idx]! : null;
};

const isDifferentStair = (
  neighbor: string | null,
  facing: CardinalFacing,
  half: string,
): boolean => {
  if (!neighbor) return true;
  const p = parseBlockState(neighbor);
  return (
    !isStairName(p.name) ||
    (p.properties.half ?? 'bottom') !== half ||
    readFacing(p.properties) !== facing
  );
};

const checkStairNeighbor = (
  voxels: Int32Array,
  states: readonly string[],
  size: IntVec3,
  x: number,
  y: number,
  z: number,
  dir: CardinalFacing,
  half: string,
): CardinalFacing | null => {
  const [dx, dz] = DIRS[dir];
  const neighbor = stateAt(voxels, states, size, x + dx, y, z + dz);
  if (!neighbor) return null;
  const p = parseBlockState(neighbor);
  if (!isStairName(p.name) || (p.properties.half ?? 'bottom') !== half) return null;
  return readFacing(p.properties);
};

const resolveStairShape = (
  voxels: Int32Array,
  states: readonly string[],
  size: IntVec3,
  x: number,
  y: number,
  z: number,
  facing: CardinalFacing,
  half: string,
): string => {
  const left = TURN_LEFT[facing];
  const right = TURN_RIGHT[facing];
  const backFacing = checkStairNeighbor(voxels, states, size, x, y, z, facing, half);
  if (backFacing === left) {
    const [rx, rz] = DIRS[right];
    if (isDifferentStair(stateAt(voxels, states, size, x + rx, y, z + rz), facing, half))
      return 'outer_left';
  }
  if (backFacing === right) {
    const [lx, lz] = DIRS[left];
    if (isDifferentStair(stateAt(voxels, states, size, x + lx, y, z + lz), facing, half))
      return 'outer_right';
  }
  const frontFacing = checkStairNeighbor(voxels, states, size, x, y, z, OPPOSITE[facing], half);
  if (frontFacing === left) {
    const [lx, lz] = DIRS[left];
    if (isDifferentStair(stateAt(voxels, states, size, x + lx, y, z + lz), facing, half))
      return 'inner_left';
  }
  if (frontFacing === right) {
    const [rx, rz] = DIRS[right];
    if (isDifferentStair(stateAt(voxels, states, size, x + rx, y, z + rz), facing, half))
      return 'inner_right';
  }
  return 'straight';
};

const connectsFence = (neighbor: string | null, selfName: string): boolean => {
  if (!neighbor) return false;
  const p = parseBlockState(neighbor);
  if (isFullSolidName(p.name) || p.name.endsWith('_fence_gate')) return true;
  if (!isFenceName(p.name)) return false;
  return selfName.includes('nether_brick') === p.name.includes('nether_brick');
};

const connectsPane = (neighbor: string | null): boolean => {
  if (!neighbor) return false;
  const p = parseBlockState(neighbor);
  return isFullSolidName(p.name) || isPaneName(p.name) || p.name === 'minecraft:glass';
};

const connectsWall = (neighbor: string | null): boolean => {
  if (!neighbor) return false;
  const p = parseBlockState(neighbor);
  return (
    isFullSolidName(p.name) ||
    isWallName(p.name) ||
    isPaneName(p.name) ||
    p.name.endsWith('_fence_gate')
  );
};

const resolveWallState = (
  voxels: Int32Array,
  states: readonly string[],
  size: IntVec3,
  x: number,
  y: number,
  z: number,
  name: string,
): string => {
  const aboveSolid = stateAt(voxels, states, size, x, y + 1, z) !== null;
  const armVal = (dir: CardinalFacing): string => {
    const [dx, dz] = DIRS[dir];
    return connectsWall(stateAt(voxels, states, size, x + dx, y, z + dz))
      ? aboveSolid
        ? 'tall'
        : 'low'
      : 'none';
  };
  const north = armVal('north');
  const east = armVal('east');
  const south = armVal('south');
  const west = armVal('west');
  const straightNS = north !== 'none' && south !== 'none' && east === 'none' && west === 'none';
  const straightEW = east !== 'none' && west !== 'none' && north === 'none' && south === 'none';
  const up = aboveSolid || !(straightNS || straightEW) ? 'true' : 'false';
  return formatBlockState({ name, properties: { east, north, south, up, west } });
};

const resolvePostVoxelState = (
  voxels: Int32Array,
  states: readonly string[],
  size: IntVec3,
  x: number,
  y: number,
  z: number,
  rawState: string,
): string | null => {
  const parsed = parseBlockState(rawState);
  if (isStairName(parsed.name)) {
    const curShape = parsed.properties.shape;
    if (curShape && curShape !== 'straight') return null;
    const facing = readFacing(parsed.properties);
    const half = parsed.properties.half ?? 'bottom';
    return withBlockProperties(rawState, {
      facing,
      half,
      shape: resolveStairShape(voxels, states, size, x, y, z, facing, half),
    });
  }
  if (isFenceName(parsed.name)) {
    return formatBlockState({
      name: parsed.name,
      properties: {
        ...parsed.properties,
        north: String(connectsFence(stateAt(voxels, states, size, x, y, z - 1), parsed.name)),
        east: String(connectsFence(stateAt(voxels, states, size, x + 1, y, z), parsed.name)),
        south: String(connectsFence(stateAt(voxels, states, size, x, y, z + 1), parsed.name)),
        west: String(connectsFence(stateAt(voxels, states, size, x - 1, y, z), parsed.name)),
      },
    });
  }
  if (isPaneName(parsed.name)) {
    return formatBlockState({
      name: parsed.name,
      properties: {
        ...parsed.properties,
        north: String(connectsPane(stateAt(voxels, states, size, x, y, z - 1))),
        east: String(connectsPane(stateAt(voxels, states, size, x + 1, y, z))),
        south: String(connectsPane(stateAt(voxels, states, size, x, y, z + 1))),
        west: String(connectsPane(stateAt(voxels, states, size, x - 1, y, z))),
      },
    });
  }
  return isWallName(parsed.name)
    ? resolveWallState(voxels, states, size, x, y, z, parsed.name)
    : null;
};

export const solveBlockConnections = (
  voxels: Int32Array,
  states: string[],
  stateToIdx: Map<string, number>,
  size: IntVec3,
): void => {
  const [w, _h, d] = size;
  const origVoxels = voxels.slice();
  const origStates = [...states];
  const ensureIdx = (s: string): number => {
    const existing = stateToIdx.get(s);
    if (existing !== undefined) return existing;
    const idx = states.length;
    states.push(s);
    stateToIdx.set(s, idx);
    return idx;
  };
  for (let idx = 0; idx < origVoxels.length; idx += 1) {
    const v = origVoxels[idx]!;
    if (v <= 0) continue;
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    const next = resolvePostVoxelState(origVoxels, origStates, size, x, y, z, origStates[v]!);
    if (next) voxels[idx] = ensureIdx(next);
  }
};

export const resolveOpeningConnections = (
  openings: readonly StructureOpeningMeta[],
  rooms: readonly StructureRoomMeta[],
): readonly StructureOpeningMeta[] =>
  openings.map((opening) => {
    if (opening.kind === 'window' || opening.connectsRooms) return opening;
    const [dx, dz] = DIRS[opening.wall];
    const px = Math.floor((opening.from[0] + opening.to[0]) / 2) + dx;
    const py = opening.from[1];
    const pz = Math.floor((opening.from[2] + opening.to[2]) / 2) + dz;
    const other = rooms.find(
      (r) =>
        r.name !== opening.room &&
        px >= r.from[0] &&
        px <= r.to[0] &&
        py >= r.from[1] &&
        py <= r.to[1] &&
        pz >= r.from[2] &&
        pz <= r.to[2],
    );
    return other ? { ...opening, connectsRooms: [opening.room, other.name] } : opening;
  });

const isColumnCovered = (
  voxels: Int32Array,
  size: IntVec3,
  x: number,
  yStart: number,
  z: number,
): boolean => {
  const [w, h, d] = size;
  for (let y = yStart; y < h; y += 1) {
    if (voxels[(y * d + z) * w + x]! > 0) return true;
  }
  return false;
};

export const resolveRoomEnclosure = (
  rooms: readonly StructureRoomMeta[],
  voxels: Int32Array,
  size: IntVec3,
): readonly StructureRoomMeta[] =>
  rooms.map((room) => {
    if (room.kind === 'courtyard') return { ...room, enclosed: false };
    let covered = 0;
    let total = 0;
    for (let z = room.from[2] + 1; z <= room.to[2] - 1; z += 1) {
      for (let x = room.from[0] + 1; x <= room.to[0] - 1; x += 1) {
        total += 1;
        if (isColumnCovered(voxels, size, x, room.to[1], z)) covered += 1;
      }
    }
    return { ...room, enclosed: total > 0 && covered / total >= 0.85 };
  });
