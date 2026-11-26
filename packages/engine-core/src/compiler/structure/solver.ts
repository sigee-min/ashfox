import type { CardinalFacing, IntVec3 } from '../../project/structure/contract';
import { formatBlockState, parseBlockState } from '../../project/structure/state';
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

interface SolverPaletteEntry {
  readonly name: string;
  readonly properties: Readonly<Record<string, string>>;
  readonly facing: CardinalFacing;
  readonly half: string;
  readonly isFullSolid: boolean;
  readonly isStair: boolean;
  readonly isFence: boolean;
  readonly isWall: boolean;
  readonly isPane: boolean;
  readonly isFenceGate: boolean;
  readonly isGlass: boolean;
  readonly isNetherBrick: boolean;
}

const buildPaletteTable = (states: readonly string[]): readonly (SolverPaletteEntry | null)[] =>
  states.map((raw, idx) => {
    if (idx === 0) return null;
    const { name, properties } = parseBlockState(raw);
    return {
      name,
      properties,
      facing: readFacing(properties),
      half: properties.half ?? 'bottom',
      isFullSolid: isFullSolidName(name),
      isStair: isStairName(name),
      isFence: isFenceName(name),
      isWall: isWallName(name),
      isPane: isPaneName(name),
      isFenceGate: name.endsWith('_fence_gate'),
      isGlass: name === 'minecraft:glass',
      isNetherBrick: name.includes('nether_brick'),
    };
  });

const paletteAt = (
  voxels: Int32Array,
  palette: readonly (SolverPaletteEntry | null)[],
  [w, h, d]: IntVec3,
  x: number,
  y: number,
  z: number,
): SolverPaletteEntry | null => {
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return null;
  const idx = voxels[(y * d + z) * w + x]!;
  return idx > 0 ? palette[idx]! : null;
};

const isDifferentStair = (
  neighbor: SolverPaletteEntry | null,
  facing: CardinalFacing,
  half: string,
): boolean =>
  !neighbor || !neighbor.isStair || neighbor.half !== half || neighbor.facing !== facing;

const checkStairNeighbor = (
  voxels: Int32Array,
  palette: readonly (SolverPaletteEntry | null)[],
  size: IntVec3,
  x: number,
  y: number,
  z: number,
  dir: CardinalFacing,
  half: string,
): CardinalFacing | null => {
  const [dx, dz] = DIRS[dir];
  const neighbor = paletteAt(voxels, palette, size, x + dx, y, z + dz);
  if (!neighbor || !neighbor.isStair || neighbor.half !== half) return null;
  return neighbor.facing;
};

const resolveStairShape = (
  voxels: Int32Array,
  palette: readonly (SolverPaletteEntry | null)[],
  size: IntVec3,
  x: number,
  y: number,
  z: number,
  facing: CardinalFacing,
  half: string,
): string => {
  const left = TURN_LEFT[facing];
  const right = TURN_RIGHT[facing];
  const backFacing = checkStairNeighbor(voxels, palette, size, x, y, z, facing, half);
  if (backFacing === left) {
    const [rx, rz] = DIRS[right];
    if (isDifferentStair(paletteAt(voxels, palette, size, x + rx, y, z + rz), facing, half))
      return 'outer_left';
  }
  if (backFacing === right) {
    const [lx, lz] = DIRS[left];
    if (isDifferentStair(paletteAt(voxels, palette, size, x + lx, y, z + lz), facing, half))
      return 'outer_right';
  }
  const frontFacing = checkStairNeighbor(voxels, palette, size, x, y, z, OPPOSITE[facing], half);
  if (frontFacing === left) {
    const [lx, lz] = DIRS[left];
    if (isDifferentStair(paletteAt(voxels, palette, size, x + lx, y, z + lz), facing, half))
      return 'inner_left';
  }
  if (frontFacing === right) {
    const [rx, rz] = DIRS[right];
    if (isDifferentStair(paletteAt(voxels, palette, size, x + rx, y, z + rz), facing, half))
      return 'inner_right';
  }
  return 'straight';
};

const connectsFence = (neighbor: SolverPaletteEntry | null, selfNetherBrick: boolean): boolean => {
  if (!neighbor) return false;
  if (neighbor.isFullSolid || neighbor.isFenceGate) return true;
  return neighbor.isFence && selfNetherBrick === neighbor.isNetherBrick;
};

const connectsPane = (neighbor: SolverPaletteEntry | null): boolean =>
  Boolean(neighbor && (neighbor.isFullSolid || neighbor.isPane || neighbor.isGlass));

const connectsWall = (neighbor: SolverPaletteEntry | null): boolean =>
  Boolean(
    neighbor &&
    (neighbor.isFullSolid || neighbor.isWall || neighbor.isPane || neighbor.isFenceGate),
  );

const resolveWallState = (
  voxels: Int32Array,
  palette: readonly (SolverPaletteEntry | null)[],
  size: IntVec3,
  x: number,
  y: number,
  z: number,
  name: string,
): string => {
  const aboveSolid = paletteAt(voxels, palette, size, x, y + 1, z) !== null;
  const armVal = (dir: CardinalFacing): string => {
    const [dx, dz] = DIRS[dir];
    return connectsWall(paletteAt(voxels, palette, size, x + dx, y, z + dz))
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
  palette: readonly (SolverPaletteEntry | null)[],
  size: IntVec3,
  x: number,
  y: number,
  z: number,
  entry: SolverPaletteEntry,
): string | null => {
  if (entry.isStair) {
    const curShape = entry.properties.shape;
    if (curShape && curShape !== 'straight') return null;
    const shape = resolveStairShape(voxels, palette, size, x, y, z, entry.facing, entry.half);
    return formatBlockState({
      name: entry.name,
      properties: { ...entry.properties, facing: entry.facing, half: entry.half, shape },
    });
  }
  if (entry.isFence) {
    return formatBlockState({
      name: entry.name,
      properties: {
        ...entry.properties,
        north: String(
          connectsFence(paletteAt(voxels, palette, size, x, y, z - 1), entry.isNetherBrick),
        ),
        east: String(
          connectsFence(paletteAt(voxels, palette, size, x + 1, y, z), entry.isNetherBrick),
        ),
        south: String(
          connectsFence(paletteAt(voxels, palette, size, x, y, z + 1), entry.isNetherBrick),
        ),
        west: String(
          connectsFence(paletteAt(voxels, palette, size, x - 1, y, z), entry.isNetherBrick),
        ),
      },
    });
  }
  if (entry.isPane) {
    return formatBlockState({
      name: entry.name,
      properties: {
        ...entry.properties,
        north: String(connectsPane(paletteAt(voxels, palette, size, x, y, z - 1))),
        east: String(connectsPane(paletteAt(voxels, palette, size, x + 1, y, z))),
        south: String(connectsPane(paletteAt(voxels, palette, size, x, y, z + 1))),
        west: String(connectsPane(paletteAt(voxels, palette, size, x - 1, y, z))),
      },
    });
  }
  return entry.isWall ? resolveWallState(voxels, palette, size, x, y, z, entry.name) : null;
};

export const solveBlockConnections = (
  voxels: Int32Array,
  states: string[],
  stateToIdx: Map<string, number>,
  size: IntVec3,
): void => {
  const [w, _h, d] = size;
  const origVoxels = voxels.slice();
  const palette = buildPaletteTable(states);
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
    const entry = v > 0 ? palette[v]! : null;
    if (!entry) continue;
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    const next = resolvePostVoxelState(origVoxels, palette, size, x, y, z, entry);
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
