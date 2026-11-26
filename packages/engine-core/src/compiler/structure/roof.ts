import type {
  CardinalFacing,
  IntVec3,
  MirrorAxis,
  RoofChimneySpec,
  RoofDormerSpec,
  RoofPitch,
  RoofStyle,
} from '../../project/structure/contract';
import { formatBlockState, parseBlockState } from '../../project/structure/state';
import type { StructureRoomMeta } from './contract';

export type VoxelSetter = (
  x: number,
  y: number,
  z: number,
  state: string,
  assetAlias: string | null,
) => void;
export type VoxelCarver = (x: number, y: number, z: number) => void;
export type StateResolver = (
  keyOrState: string,
  ownerPath: string,
  pos?: IntVec3,
) => { readonly state: string; readonly assetAlias: string | null };

export interface RoofOpInput {
  readonly style: RoofStyle;
  readonly axis: MirrorAxis;
  readonly from: IntVec3;
  readonly to: IntVec3;
  readonly overhang: number;
  readonly pitch: RoofPitch;
  readonly stair: string;
  readonly trim?: string;
  readonly ridge: string;
  readonly gable?: string;
  readonly underEave?: boolean;
  readonly dormers?: readonly RoofDormerSpec[];
  readonly chimneys?: readonly RoofChimneySpec[];
}

export interface RoofEmitResult {
  readonly min: IntVec3;
  readonly max: IntVec3;
  readonly hasTrim: boolean;
  readonly dormerCount: number;
  readonly chimneyCount: number;
  readonly chimneyTops: readonly IntVec3[];
  readonly roofCells: readonly IntVec3[];
}

const withStair = (
  baseState: string,
  facing: CardinalFacing,
  half: 'bottom' | 'top' = 'bottom',
): string => {
  const parsed = parseBlockState(baseState);
  return formatBlockState({
    name: parsed.name,
    properties: { ...parsed.properties, half, facing },
  });
};

const fillSpanX = (
  y: number,
  z: number,
  lx: number,
  rx: number,
  key: string | undefined,
  resolve: StateResolver,
  owner: string,
  put: VoxelSetter,
): void => {
  if (!key) return;
  for (let fx = lx + 1; fx <= rx - 1; fx += 1) {
    const r = resolve(key, owner, [fx, y, z]);
    put(fx, y, z, r.state, r.assetAlias);
  }
};

const fillSpanZ = (
  x: number,
  y: number,
  nz: number,
  sz: number,
  key: string | undefined,
  resolve: StateResolver,
  owner: string,
  put: VoxelSetter,
): void => {
  if (!key) return;
  for (let fz = nz + 1; fz <= sz - 1; fz += 1) {
    const r = resolve(key, owner, [x, y, fz]);
    put(x, y, fz, r.state, r.assetAlias);
  }
};

const pitchStepY = (pitch: RoofPitch, level: number): number =>
  pitch === 'shallow' ? Math.floor(level / 2) : pitch === 'steep' ? level * 2 : level;

const emitGableZCell = (
  op: RoofOpInput,
  lx: number,
  rx: number,
  y: number,
  z: number,
  level: number,
  maxY: number,
  put: VoxelSetter,
  resolve: StateResolver,
  owner: string,
  cells: IntVec3[],
): void => {
  const k =
    op.trim && (z === op.from[2] - op.overhang || z === op.to[2] + op.overhang)
      ? op.trim
      : op.stair;
  if (lx === rx) {
    const r = resolve(op.ridge, owner, [lx, y, z]);
    put(lx, y, z, r.state, r.assetAlias);
    cells.push([lx, y, z]);
    return;
  }
  const useSlab = op.pitch === 'shallow' && level % 2 === 1;
  const lRes = resolve(useSlab ? op.ridge : k, owner, [lx, y, z]);
  const rRes = resolve(useSlab ? op.ridge : k, owner, [rx, y, z]);
  put(lx, y, z, useSlab ? lRes.state : withStair(lRes.state, 'east'), null);
  put(rx, y, z, useSlab ? rRes.state : withStair(rRes.state, 'west'), null);
  cells.push([lx, y, z], [rx, y, z]);
  if (op.pitch === 'steep' && y + 1 <= maxY) {
    put(lx, y + 1, z, withStair(resolve(k, owner, [lx, y + 1, z]).state, 'east'), null);
    put(rx, y + 1, z, withStair(resolve(k, owner, [rx, y + 1, z]).state, 'west'), null);
  }
};

const emitGableZ = (
  op: RoofOpInput,
  min: IntVec3,
  max: IntVec3,
  put: VoxelSetter,
  resolve: StateResolver,
  owner: string,
  cells: IntVec3[],
): void => {
  const half = Math.ceil((max[0] - min[0] + 1) / 2);
  for (let level = 0; level < half; level += 1) {
    const lx = min[0] + level;
    const rx = max[0] - level;
    const y = min[1] + pitchStepY(op.pitch, level);
    if (y > max[1]) break;
    for (let z = min[2]; z <= max[2]; z += 1) {
      emitGableZCell(op, lx, rx, y, z, level, max[1], put, resolve, owner, cells);
      if (z === min[2] || z === max[2]) fillSpanX(y, z, lx, rx, op.gable, resolve, owner, put);
    }
  }
};

const emitGableXCell = (
  op: RoofOpInput,
  x: number,
  y: number,
  nz: number,
  sz: number,
  level: number,
  minX: number,
  maxX: number,
  put: VoxelSetter,
  resolve: StateResolver,
  owner: string,
  cells: IntVec3[],
): void => {
  const k = op.trim && (x === minX || x === maxX) ? op.trim : op.stair;
  if (nz === sz) {
    const r = resolve(op.ridge, owner, [x, y, nz]);
    put(x, y, nz, r.state, r.assetAlias);
    cells.push([x, y, nz]);
    return;
  }
  const useSlab = op.pitch === 'shallow' && level % 2 === 1;
  const nRes = resolve(useSlab ? op.ridge : k, owner, [x, y, nz]);
  const sRes = resolve(useSlab ? op.ridge : k, owner, [x, y, sz]);
  put(x, y, nz, useSlab ? nRes.state : withStair(nRes.state, 'south'), null);
  put(x, y, sz, useSlab ? sRes.state : withStair(sRes.state, 'north'), null);
  cells.push([x, y, nz], [x, y, sz]);
};

const emitGableX = (
  op: RoofOpInput,
  min: IntVec3,
  max: IntVec3,
  put: VoxelSetter,
  resolve: StateResolver,
  owner: string,
  cells: IntVec3[],
): void => {
  const half = Math.ceil((max[2] - min[2] + 1) / 2);
  for (let level = 0; level < half; level += 1) {
    const nz = min[2] + level;
    const sz = max[2] - level;
    const y = min[1] + pitchStepY(op.pitch, level);
    if (y > max[1]) break;
    for (let x = min[0]; x <= max[0]; x += 1) {
      emitGableXCell(op, x, y, nz, sz, level, min[0], max[0], put, resolve, owner, cells);
      if (x === min[0] || x === max[0]) fillSpanZ(x, y, nz, sz, op.gable, resolve, owner, put);
    }
  }
};

const emitHipRing = (
  y: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  stairKey: string,
  ridgeKey: string,
  resolve: StateResolver,
  owner: string,
  put: VoxelSetter,
  cells: IntVec3[],
  half: 'bottom' | 'top' = 'bottom',
): void => {
  if (x0 === x1 && z0 === z1) {
    const r = resolve(ridgeKey, owner, [x0, y, z0]);
    put(x0, y, z0, r.state, r.assetAlias);
    cells.push([x0, y, z0]);
    return;
  }
  const stair = resolve(stairKey, owner, [x0, y, z0]).state;
  const ridge = resolve(ridgeKey, owner, [x0, y, z0]).state;
  for (let x = x0; x <= x1; x += 1) {
    put(x, y, z0, z0 === z1 ? ridge : withStair(stair, 'south', half), null);
    cells.push([x, y, z0]);
    if (z1 !== z0) {
      put(x, y, z1, withStair(stair, 'north', half), null);
      cells.push([x, y, z1]);
    }
  }
  for (let z = z0 + 1; z < z1; z += 1) {
    put(x0, y, z, withStair(stair, 'east', half), null);
    cells.push([x0, y, z]);
    if (x1 !== x0) {
      put(x1, y, z, withStair(stair, 'west', half), null);
      cells.push([x1, y, z]);
    }
  }
};

const emitHipPyramid = (
  op: RoofOpInput,
  min: IntVec3,
  max: IntVec3,
  put: VoxelSetter,
  resolve: StateResolver,
  owner: string,
  cells: IntVec3[],
): void => {
  const half = Math.min(Math.ceil((max[0] - min[0] + 1) / 2), Math.ceil((max[2] - min[2] + 1) / 2));
  for (let level = 0; level < half; level += 1) {
    const y = min[1] + pitchStepY(op.pitch, level);
    if (y > max[1]) break;
    const x0 = min[0] + level;
    const x1 = max[0] - level;
    const z0 = min[2] + level;
    const z1 = max[2] - level;
    if (x0 > x1 || z0 > z1) break;
    if (level > 0)
      emitHipRing(y - 1, x0, x1, z0, z1, op.stair, op.ridge, resolve, owner, put, cells, 'top');
    emitHipRing(y, x0, x1, z0, z1, op.stair, op.ridge, resolve, owner, put, cells);
    if (op.pitch === 'steep' && y + 1 <= max[1]) {
      emitHipRing(y + 1, x0, x1, z0, z1, op.stair, op.ridge, resolve, owner, put, cells);
    }
  }
};

const emitUnderEaves = (
  op: RoofOpInput,
  min: IntVec3,
  max: IntVec3,
  put: VoxelSetter,
  resolve: StateResolver,
  owner: string,
): void => {
  if (!op.underEave || min[1] < 1) return;
  const ey = min[1] - 1;
  const key = op.trim ?? op.stair;
  if (op.style !== 'gable' || op.axis === 'z') {
    for (let z = min[2]; z <= max[2]; z += 1) {
      const s0 = resolve(key, owner, [min[0], ey, z]).state;
      put(min[0], ey, z, withStair(s0, 'east', 'top'), null);
      const s1 = resolve(key, owner, [max[0], ey, z]).state;
      put(max[0], ey, z, withStair(s1, 'west', 'top'), null);
    }
  }
  if (op.style !== 'gable' || op.axis === 'x') {
    for (let x = min[0]; x <= max[0]; x += 1) {
      const s0 = resolve(key, owner, [x, ey, min[2]]).state;
      put(x, ey, min[2], withStair(s0, 'south', 'top'), null);
      const s1 = resolve(key, owner, [x, ey, max[2]]).state;
      put(x, ey, max[2], withStair(s1, 'north', 'top'), null);
    }
  }
};

const emitDormerCell = (
  d: RoofDormerSpec,
  op: RoofOpInput,
  x: number,
  y: number,
  z: number,
  dy: number,
  isEdge: boolean,
  alongX: boolean,
  sign: number,
  put: VoxelSetter,
  carve: VoxelCarver,
  resolve: StateResolver,
  owner: string,
): void => {
  const cheek = op.gable ?? op.ridge;
  if (dy === d.height) {
    const cap = resolve(op.ridge, owner, [x, y, z]);
    put(x, y, z, cap.state, cap.assetAlias);
  } else if (isEdge && d.width >= 3) {
    const wall = resolve(cheek, owner, [x, y, z]);
    put(x, y, z, wall.state, wall.assetAlias);
  } else if (d.windowBlock) {
    const win = resolve(d.windowBlock, owner, [x, y, z]);
    put(x, y, z, win.state, win.assetAlias);
    carve(alongX ? x : x + sign, y, alongX ? z + sign : z);
  } else carve(x, y, z);
};

const dormerDepth = (
  wall: CardinalFacing,
  min: IntVec3,
  max: IntVec3,
  overhang: number,
): number => {
  const base =
    wall === 'north' ? min[2] : wall === 'south' ? max[2] : wall === 'west' ? min[0] : max[0];
  const sign = wall === 'north' || wall === 'west' ? 1 : -1;
  return base + sign * (overhang + 1);
};

const emitDormer = (
  d: RoofDormerSpec,
  op: RoofOpInput,
  min: IntVec3,
  max: IntVec3,
  put: VoxelSetter,
  carve: VoxelCarver,
  resolve: StateResolver,
  owner: string,
): void => {
  const alongX = d.wall === 'north' || d.wall === 'south';
  const centerU = Math.floor((alongX ? min[0] + max[0] : min[2] + max[2]) / 2) + d.offset;
  const halfW = Math.floor(d.width / 2);
  const sign = d.wall === 'north' || d.wall === 'west' ? 1 : -1;
  const depth = dormerDepth(d.wall, min, max, op.overhang);
  for (let u = centerU - halfW; u <= centerU + halfW; u += 1) {
    const isEdge = u === centerU - halfW || u === centerU + halfW;
    for (let dy = 1; dy <= d.height; dy += 1) {
      const x = alongX ? u : depth;
      const z = alongX ? depth : u;
      emitDormerCell(
        d,
        op,
        x,
        min[1] + dy,
        z,
        dy,
        isEdge,
        alongX,
        sign,
        put,
        carve,
        resolve,
        owner,
      );
    }
  }
};

const chimneyBounds = (
  c: RoofChimneySpec,
  min: IntVec3,
  max: IntVec3,
  rooms: ReadonlyMap<string, StructureRoomMeta>,
): readonly [number, number, number] => {
  const room = c.room ? rooms.get(c.room) : undefined;
  const bx0 = room ? room.from[0] + 1 : min[0] + 1;
  const bx1 = room ? room.to[0] - 1 : max[0] - 1;
  const bz0 = room ? room.from[2] + 1 : min[2] + 1;
  const bz1 = room ? room.to[2] - 1 : max[2] - 1;
  const cx =
    (c.corner === 'nw' || c.corner === 'sw'
      ? bx0
      : c.corner === 'center'
        ? Math.floor((bx0 + bx1) / 2)
        : bx1 - c.width + 1) + c.offset[0];
  const cz =
    (c.corner === 'nw' || c.corner === 'ne'
      ? bz0
      : c.corner === 'center'
        ? Math.floor((bz0 + bz1) / 2)
        : bz1 - c.width + 1) + c.offset[1];
  return [cx, cz, room ? room.from[1] + 1 : min[1]];
};

const emitChimney = (
  c: RoofChimneySpec,
  min: IntVec3,
  max: IntVec3,
  peakY: number,
  rooms: ReadonlyMap<string, StructureRoomMeta>,
  put: VoxelSetter,
  resolve: StateResolver,
  owner: string,
): IntVec3 => {
  const [cx, cz, baseY] = chimneyBounds(c, min, max, rooms);
  const topY = peakY + c.rise;
  for (let y = baseY; y <= topY; y += 1) {
    for (let dx = 0; dx < c.width; dx += 1) {
      for (let dz = 0; dz < c.width; dz += 1) {
        const r = resolve(c.block, owner, [cx + dx, y, cz + dz]);
        put(cx + dx, y, cz + dz, r.state, r.assetAlias);
      }
    }
  }
  if (c.cap) put(cx, topY + 1, cz, 'minecraft:stone_brick_slab[type=bottom]', null);
  return [cx, topY, cz];
};

const maxCellY = (cells: readonly IntVec3[], fallback: number): number => {
  if (cells.length === 0) return fallback;
  let peak = cells[0]![1];
  for (let i = 1; i < cells.length; i += 1) {
    if (cells[i]![1] > peak) peak = cells[i]![1];
  }
  return peak;
};

export const emitRoof = (
  op: RoofOpInput,
  rooms: ReadonlyMap<string, StructureRoomMeta>,
  put: VoxelSetter,
  carve: VoxelCarver,
  resolve: StateResolver,
  ownerPath: string,
): RoofEmitResult => {
  resolve(op.stair, ownerPath, op.from);
  resolve(op.ridge, ownerPath, op.from);
  if (op.trim) resolve(op.trim, ownerPath, op.from);
  if (op.gable) resolve(op.gable, ownerPath, op.from);
  const min: IntVec3 = [
    Math.min(op.from[0], op.to[0]) - op.overhang,
    Math.min(op.from[1], op.to[1]),
    Math.min(op.from[2], op.to[2]) - op.overhang,
  ];
  const max: IntVec3 = [
    Math.max(op.from[0], op.to[0]) + op.overhang,
    Math.max(op.from[1], op.to[1]),
    Math.max(op.from[2], op.to[2]) + op.overhang,
  ];
  const roofCells: IntVec3[] = [];
  if (op.style === 'gable') {
    if (op.axis === 'z') emitGableZ(op, min, max, put, resolve, ownerPath, roofCells);
    else emitGableX(op, min, max, put, resolve, ownerPath, roofCells);
  } else emitHipPyramid(op, min, max, put, resolve, ownerPath, roofCells);
  emitUnderEaves(op, min, max, put, resolve, ownerPath);
  for (const d of op.dormers ?? []) emitDormer(d, op, min, max, put, carve, resolve, ownerPath);
  const peakY = maxCellY(roofCells, min[1]);
  const chimneyTops = (op.chimneys ?? []).map((c) =>
    emitChimney(c, min, max, peakY, rooms, put, resolve, ownerPath),
  );
  return {
    min,
    max,
    hasTrim: Boolean(op.trim),
    dormerCount: op.dormers?.length ?? 0,
    chimneyCount: op.chimneys?.length ?? 0,
    chimneyTops,
    roofCells,
  };
};
