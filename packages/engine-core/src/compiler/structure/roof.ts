import type { IntVec3, MirrorAxis, RoofStyle } from '../../project/structure/contract';
import { formatBlockState, parseBlockState } from '../../project/structure/state';

export type VoxelSetter = (
  x: number,
  y: number,
  z: number,
  state: string,
  assetAlias: string | null,
) => void;
export type StateResolver = (
  keyOrState: string,
  ownerPath: string,
) => { readonly state: string; readonly assetAlias: string | null };

interface RoofOpInput {
  readonly style: RoofStyle;
  readonly axis: MirrorAxis;
  readonly from: IntVec3;
  readonly to: IntVec3;
  readonly stair: string;
  readonly ridge: string;
  readonly gable?: string;
}

const withStairFacing = (
  baseState: string,
  facing: 'north' | 'south' | 'east' | 'west',
): string => {
  const parsed = parseBlockState(baseState);
  return formatBlockState({
    name: parsed.name,
    properties: { half: 'bottom', ...parsed.properties, facing },
  });
};

const fillGableRowX = (
  y: number,
  z: number,
  lx: number,
  rx: number,
  fill: { readonly state: string; readonly assetAlias: string | null } | null,
  put: VoxelSetter,
): void => {
  if (!fill) return;
  for (let fx = lx + 1; fx <= rx - 1; fx += 1) put(fx, y, z, fill.state, fill.assetAlias);
};

const fillGableRowZ = (
  x: number,
  y: number,
  nz: number,
  sz: number,
  fill: { readonly state: string; readonly assetAlias: string | null } | null,
  put: VoxelSetter,
): void => {
  if (!fill) return;
  for (let fz = nz + 1; fz <= sz - 1; fz += 1) put(x, y, fz, fill.state, fill.assetAlias);
};

const emitGableAlongZ = (
  op: RoofOpInput,
  min: IntVec3,
  max: IntVec3,
  put: VoxelSetter,
  resolve: StateResolver,
  ownerPath: string,
): void => {
  const maxLevels = Math.min(max[1] - min[1] + 1, Math.ceil((max[0] - min[0] + 1) / 2));
  const east = withStairFacing(resolve(op.stair, ownerPath).state, 'east');
  const west = withStairFacing(resolve(op.stair, ownerPath).state, 'west');
  const ridge = resolve(op.ridge, ownerPath);
  const gable = op.gable ? resolve(op.gable, ownerPath) : null;
  for (let level = 0; level < maxLevels; level += 1) {
    const lx = min[0] + level;
    const rx = max[0] - level;
    const y = min[1] + level;
    for (let z = min[2]; z <= max[2]; z += 1) {
      if (lx === rx) put(lx, y, z, ridge.state, ridge.assetAlias);
      else {
        put(lx, y, z, east, null);
        put(rx, y, z, west, null);
      }
      if (z === min[2] || z === max[2]) fillGableRowX(y, z, lx, rx, gable, put);
    }
  }
};

const emitGableAlongX = (
  op: RoofOpInput,
  min: IntVec3,
  max: IntVec3,
  put: VoxelSetter,
  resolve: StateResolver,
  ownerPath: string,
): void => {
  const maxLevels = Math.min(max[1] - min[1] + 1, Math.ceil((max[2] - min[2] + 1) / 2));
  const south = withStairFacing(resolve(op.stair, ownerPath).state, 'south');
  const north = withStairFacing(resolve(op.stair, ownerPath).state, 'north');
  const ridge = resolve(op.ridge, ownerPath);
  const gable = op.gable ? resolve(op.gable, ownerPath) : null;
  for (let level = 0; level < maxLevels; level += 1) {
    const nz = min[2] + level;
    const sz = max[2] - level;
    const y = min[1] + level;
    for (let x = min[0]; x <= max[0]; x += 1) {
      if (nz === sz) put(x, y, nz, ridge.state, ridge.assetAlias);
      else {
        put(x, y, nz, south, null);
        put(x, y, sz, north, null);
      }
      if (x === min[0] || x === max[0]) fillGableRowZ(x, y, nz, sz, gable, put);
    }
  }
};

const emitHipRing = (
  y: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  stairBase: string,
  ridge: { readonly state: string; readonly assetAlias: string | null },
  put: VoxelSetter,
): void => {
  if (x0 === x1 && z0 === z1) {
    put(x0, y, z0, ridge.state, ridge.assetAlias);
    return;
  }
  const north = withStairFacing(stairBase, 'north');
  const south = withStairFacing(stairBase, 'south');
  const east = withStairFacing(stairBase, 'east');
  const west = withStairFacing(stairBase, 'west');
  for (let x = x0; x <= x1; x += 1) {
    put(x, y, z0, z0 === z1 ? ridge.state : south, null);
    if (z1 !== z0) put(x, y, z1, north, null);
  }
  for (let z = z0 + 1; z < z1; z += 1) {
    put(x0, y, z, east, null);
    if (x1 !== x0) put(x1, y, z, west, null);
  }
};

const emitHipOrPyramid = (
  op: RoofOpInput,
  min: IntVec3,
  max: IntVec3,
  put: VoxelSetter,
  resolve: StateResolver,
  ownerPath: string,
): void => {
  const half = Math.min(Math.ceil((max[0] - min[0] + 1) / 2), Math.ceil((max[2] - min[2] + 1) / 2));
  const maxLevels = Math.min(max[1] - min[1] + 1, half);
  const stairBase = resolve(op.stair, ownerPath).state;
  const ridge = resolve(op.ridge, ownerPath);
  for (let level = 0; level < maxLevels; level += 1) {
    const x0 = min[0] + level;
    const x1 = max[0] - level;
    const z0 = min[2] + level;
    const z1 = max[2] - level;
    if (x0 > x1 || z0 > z1) break;
    emitHipRing(min[1] + level, x0, x1, z0, z1, stairBase, ridge, put);
  }
};

export const emitRoof = (
  op: RoofOpInput,
  put: VoxelSetter,
  resolve: StateResolver,
  ownerPath: string,
): void => {
  const min: IntVec3 = [
    Math.min(op.from[0], op.to[0]),
    Math.min(op.from[1], op.to[1]),
    Math.min(op.from[2], op.to[2]),
  ];
  const max: IntVec3 = [
    Math.max(op.from[0], op.to[0]),
    Math.max(op.from[1], op.to[1]),
    Math.max(op.from[2], op.to[2]),
  ];
  if (op.style === 'gable') {
    if (op.axis === 'z') emitGableAlongZ(op, min, max, put, resolve, ownerPath);
    else emitGableAlongX(op, min, max, put, resolve, ownerPath);
    return;
  }
  emitHipOrPyramid(op, min, max, put, resolve, ownerPath);
};
