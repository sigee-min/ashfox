import type { CardinalFacing, IntVec3 } from '../../project/structure/contract';
import { formatBlockState, parseBlockState } from '../../project/structure/state';

export type VoxelPut = (
  x: number,
  y: number,
  z: number,
  state: string,
  assetAlias: string | null,
) => void;

export type StateResolve = (
  keyOrState: string,
  ownerPath: string,
  pos?: IntVec3,
) => { readonly state: string; readonly assetAlias: string | null };

export const octagonChamfer = (w: number, d: number): number =>
  w <= 2 || d <= 2 ? 0 : Math.max(1, Math.floor(Math.min(w, d) / 4));

const cornerDist = (x: number, z: number, x0: number, x1: number, z0: number, z1: number): number =>
  Math.min(x - x0 + (z - z0), x1 - x + (z - z0), x - x0 + (z1 - z), x1 - x + (z1 - z));

export const isOctagonOutside = (x: number, z: number, from: IntVec3, to: IntVec3): boolean => {
  const c = octagonChamfer(to[0] - from[0] + 1, to[2] - from[2] + 1);
  return cornerDist(x, z, from[0], to[0], from[2], to[2]) < c;
};

export const isOctagonPerimeter = (x: number, z: number, from: IntVec3, to: IntVec3): boolean => {
  const [x0, _y0, z0] = from;
  const [x1, _y1, z1] = to;
  const c = octagonChamfer(x1 - x0 + 1, z1 - z0 + 1);
  const dist = cornerDist(x, z, x0, x1, z0, z1);
  if (dist < c) return false;
  return x === x0 || x === x1 || z === z0 || z === z1 || dist === c;
};

export const isOctagonCorner = (x: number, z: number, from: IntVec3, to: IntVec3): boolean => {
  const [x0, _y0, z0] = from;
  const [x1, _y1, z1] = to;
  const c = octagonChamfer(x1 - x0 + 1, z1 - z0 + 1);
  if (cornerDist(x, z, x0, x1, z0, z1) !== c) return false;
  return c <= 2 || x === x0 || x === x1 || z === z0 || z === z1;
};

export const octagonWallRange = (
  from: IntVec3,
  to: IntVec3,
  wall: CardinalFacing,
): readonly [number, number] => {
  const c = octagonChamfer(to[0] - from[0] + 1, to[2] - from[2] + 1);
  return wall === 'north' || wall === 'south' ? [from[0] + c, to[0] - c] : [from[2] + c, to[2] - c];
};

const withStairFacing = (
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

const emitHipRing = (
  y: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  stairKey: string,
  ridgeKey: string,
  resolve: StateResolve,
  owner: string,
  put: VoxelPut,
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
    put(x, y, z0, z0 === z1 ? ridge : withStairFacing(stair, 'south', half), null);
    cells.push([x, y, z0]);
    if (z1 !== z0) {
      put(x, y, z1, withStairFacing(stair, 'north', half), null);
      cells.push([x, y, z1]);
    }
  }
  for (let z = z0 + 1; z < z1; z += 1) {
    put(x0, y, z, withStairFacing(stair, 'east', half), null);
    cells.push([x0, y, z]);
    if (x1 !== x0) {
      put(x1, y, z, withStairFacing(stair, 'west', half), null);
      cells.push([x1, y, z]);
    }
  }
};

const emitHipLevel = (
  pitch: 'shallow' | 'standard' | 'steep',
  stairKey: string,
  ridgeKey: string,
  y: number,
  maxY: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  level: number,
  put: VoxelPut,
  resolve: StateResolve,
  owner: string,
  cells: IntVec3[],
): void => {
  if (level > 0)
    emitHipRing(y - 1, x0, x1, z0, z1, stairKey, ridgeKey, resolve, owner, put, cells, 'top');
  emitHipRing(y, x0, x1, z0, z1, stairKey, ridgeKey, resolve, owner, put, cells);
  if (pitch === 'steep' && y + 1 <= maxY) {
    emitHipRing(y + 1, x0, x1, z0, z1, stairKey, ridgeKey, resolve, owner, put, cells);
  }
};

export const emitHipPyramid = (
  pitch: 'shallow' | 'standard' | 'steep',
  stairKey: string,
  ridgeKey: string,
  min: IntVec3,
  max: IntVec3,
  put: VoxelPut,
  resolve: StateResolve,
  owner: string,
  cells: IntVec3[],
): void => {
  const stepY = (lvl: number) =>
    pitch === 'shallow' ? Math.floor(lvl / 2) : pitch === 'steep' ? lvl * 2 : lvl;
  const half = Math.min(Math.ceil((max[0] - min[0] + 1) / 2), Math.ceil((max[2] - min[2] + 1) / 2));
  for (let level = 0; level < half; level += 1) {
    const y = min[1] + stepY(level);
    const x0 = min[0] + level;
    const x1 = max[0] - level;
    const z0 = min[2] + level;
    const z1 = max[2] - level;
    if (y > max[1] || x0 > x1 || z0 > z1) break;
    emitHipLevel(
      pitch,
      stairKey,
      ridgeKey,
      y,
      max[1],
      x0,
      x1,
      z0,
      z1,
      level,
      put,
      resolve,
      owner,
      cells,
    );
  }
};

const isRectPerimeter = (x: number, z: number, min: IntVec3, max: IntVec3): boolean =>
  x === min[0] || x === max[0] || z === min[2] || z === max[2];

const isRectCorner = (x: number, z: number, min: IntVec3, max: IntVec3): boolean =>
  (x === min[0] || x === max[0]) && (z === min[2] || z === max[2]);

const emitBattlementCell = (
  x: number,
  y: number,
  z: number,
  min: IntVec3,
  max: IntVec3,
  octagonal: boolean,
  blockKey: string,
  resolve: StateResolve,
  owner: string,
  put: VoxelPut,
  cells: IntVec3[],
): void => {
  if (octagonal && isOctagonOutside(x, z, min, max)) return;
  const base = resolve(blockKey, owner, [x, y, z]);
  put(x, y, z, base.state, base.assetAlias);
  cells.push([x, y, z]);
  const onPerim = octagonal ? isOctagonPerimeter(x, z, min, max) : isRectPerimeter(x, z, min, max);
  if (!onPerim || y + 1 > max[1]) return;
  const corner = octagonal ? isOctagonCorner(x, z, min, max) : isRectCorner(x, z, min, max);
  if (corner || (x + z) % 2 === 0) {
    const merlon = resolve(blockKey, owner, [x, y + 1, z]);
    put(x, y + 1, z, merlon.state, merlon.assetAlias);
    cells.push([x, y + 1, z]);
  }
};

export const emitBattlementRing = (
  min: IntVec3,
  max: IntVec3,
  octagonal: boolean,
  blockKey: string,
  resolve: StateResolve,
  owner: string,
  put: VoxelPut,
  cells: IntVec3[],
): void => {
  for (let z = min[2]; z <= max[2]; z += 1) {
    for (let x = min[0]; x <= max[0]; x += 1) {
      emitBattlementCell(x, min[1], z, min, max, octagonal, blockKey, resolve, owner, put, cells);
    }
  }
};

const spireInwardFacing = (
  x: number,
  z: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
): CardinalFacing | null => {
  if (z === z0) return 'south';
  if (z === z1) return 'north';
  if (x === x0) return 'east';
  if (x === x1) return 'west';
  return null;
};

const emitSpireTierCell = (
  x: number,
  y: number,
  z: number,
  boxMin: IntVec3,
  boxMax: IntVec3,
  isTop: boolean,
  stairKey: string,
  solidKey: string,
  resolve: StateResolve,
  owner: string,
  put: VoxelPut,
  cells: IntVec3[],
): void => {
  const facing = isTop ? spireInwardFacing(x, z, boxMin[0], boxMax[0], boxMin[2], boxMax[2]) : null;
  if (facing) {
    const stair = resolve(stairKey, owner, [x, y, z]).state;
    put(x, y, z, withStairFacing(stair, facing), null);
  } else {
    const res = resolve(solidKey, owner, [x, y, z]);
    put(x, y, z, res.state, res.assetAlias);
  }
  cells.push([x, y, z]);
};

const emitSpireTierLayer = (
  y: number,
  boxMin: IntVec3,
  boxMax: IntVec3,
  isTop: boolean,
  stairKey: string,
  solidKey: string,
  resolve: StateResolve,
  owner: string,
  put: VoxelPut,
  cells: IntVec3[],
): void => {
  const innerMin: IntVec3 = [boxMin[0] + 1, y, boxMin[2] + 1];
  const innerMax: IntVec3 = [boxMax[0] - 1, y, boxMax[2] - 1];
  for (let z = boxMin[2]; z <= boxMax[2]; z += 1) {
    for (let x = boxMin[0]; x <= boxMax[0]; x += 1) {
      if (isOctagonOutside(x, z, boxMin, boxMax)) continue;
      const onOuter = isOctagonPerimeter(x, z, boxMin, boxMax);
      const onInnerSupport =
        isTop && innerMin[0] <= innerMax[0] && isOctagonPerimeter(x, z, innerMin, innerMax);
      if (!onOuter && !onInnerSupport) continue;
      emitSpireTierCell(
        x,
        y,
        z,
        boxMin,
        boxMax,
        isTop && onOuter,
        stairKey,
        solidKey,
        resolve,
        owner,
        put,
        cells,
      );
    }
  }
};

const emitSpireFinial = (
  cx: number,
  cz: number,
  startY: number,
  maxY: number,
  ridgeKey: string,
  resolve: StateResolve,
  owner: string,
  put: VoxelPut,
  cells: IntVec3[],
): void => {
  if (startY > maxY) return;
  const cap = resolve(ridgeKey, owner, [cx, startY, cz]);
  put(cx, startY, cz, cap.state, cap.assetAlias);
  cells.push([cx, startY, cz]);
  if (startY + 2 <= maxY) {
    put(cx, startY + 1, cz, 'minecraft:dark_oak_fence', null);
    put(cx, startY + 2, cz, 'minecraft:lantern[hanging=false]', null);
    cells.push([cx, startY + 1, cz], [cx, startY + 2, cz]);
  } else if (startY + 1 <= maxY) {
    put(cx, startY + 1, cz, 'minecraft:lantern[hanging=false]', null);
    cells.push([cx, startY + 1, cz]);
  }
};

export interface SpireSpec {
  readonly pitch: 'shallow' | 'standard' | 'steep';
  readonly stair: string;
  readonly ridge: string;
  readonly trim?: string;
  readonly gable?: string;
  readonly battlement?: boolean;
}

const emitSpireTier = (
  op: SpireSpec,
  curY: number,
  tierH: number,
  maxY: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  solidKey: string,
  put: VoxelPut,
  resolve: StateResolve,
  owner: string,
  cells: IntVec3[],
): void => {
  const boxMin: IntVec3 = [x0, curY, z0];
  const boxMax: IntVec3 = [x1, curY, z1];
  for (let dy = 0; dy < tierH && curY + dy <= maxY; dy += 1) {
    emitSpireTierLayer(
      curY + dy,
      boxMin,
      boxMax,
      dy === tierH - 1,
      op.stair,
      solidKey,
      resolve,
      owner,
      put,
      cells,
    );
  }
};

export const emitSpireRoof = (
  op: SpireSpec,
  min: IntVec3,
  max: IntVec3,
  put: VoxelPut,
  resolve: StateResolve,
  owner: string,
  cells: IntVec3[],
): void => {
  const solidKey = op.gable ?? op.trim ?? op.ridge;
  const inset = op.battlement ? 1 : 0;
  if (op.battlement) emitBattlementRing(min, max, true, solidKey, resolve, owner, put, cells);
  let [x0, curY, z0] = [min[0] + inset, min[1] + inset, min[2] + inset];
  let [x1, z1] = [max[0] - inset, max[2] - inset];
  for (let level = 0; x0 <= x1 && z0 <= z1 && curY <= max[1]; level += 1) {
    if (x0 === x1 && z0 === z1) {
      emitSpireFinial(x0, z0, curY, max[1], op.ridge, resolve, owner, put, cells);
      break;
    }
    const tierH = op.pitch === 'shallow' ? 1 : op.pitch === 'steep' || level < 2 ? 2 : 1;
    emitSpireTier(op, curY, tierH, max[1], x0, x1, z0, z1, solidKey, put, resolve, owner, cells);
    curY += tierH;
    x0 += 1;
    x1 -= 1;
    z0 += 1;
    z1 -= 1;
  }
};
