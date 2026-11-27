import type { IntVec3 } from '../../project/structure/contract';
import { formatBlockState, parseBlockState } from '../../project/structure/state';
import type { StructureOpeningMeta, StructureRoomMeta } from './contract';

export interface WeatheringContext {
  readonly seed: number;
  readonly size: IntVec3;
  readonly voxels: Int32Array;
  readonly states: readonly string[];
  readonly rooms: readonly StructureRoomMeta[];
  readonly roofCells: readonly IntVec3[];
  readonly chimneyTops: readonly IntVec3[];
  readonly openings?: readonly StructureOpeningMeta[];
  readonly protectedAir?: Uint8Array;
  readonly customTags?: readonly (string | null)[];
  readonly ownerPath: string;
  readonly resolve: (
    keyOrState: string,
    ownerPath: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null };
  readonly put: (x: number, y: number, z: number, state: string, assetAlias: string | null) => void;
}

export const seededNoise = (seed: number, x: number, y: number, z: number): number => {
  let h =
    (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export const DIRS4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const DIRS6: readonly IntVec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export const voxelAt = (ctx: WeatheringContext, x: number, y: number, z: number): number => {
  const [w, h, d] = ctx.size;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return -1;
  return ctx.voxels[(y * d + z) * w + x]!;
};

export const isCustomTagged = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, , d] = ctx.size;
  return (ctx.customTags?.[(y * d + z) * w + x] ?? null) !== null;
};

export const isProtectedAir = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, , d] = ctx.size;
  return (ctx.protectedAir?.[(y * d + z) * w + x] ?? 0) !== 0;
};

export const hasExposedCardinal = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
): boolean => {
  for (const [dx, dz] of DIRS4) {
    if (voxelAt(ctx, x + dx, y, z + dz) <= 0) return true;
  }
  return false;
};

export const hasAdjacentSolid = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
): boolean => {
  for (const [dx, dy, dz] of DIRS6) {
    if (voxelAt(ctx, x + dx, y + dy, z + dz) > 0) return true;
  }
  return false;
};

export const isInsideAnyRoom = (
  rooms: readonly StructureRoomMeta[],
  x: number,
  y: number,
  z: number,
): boolean =>
  rooms.some(
    (r) =>
      x > r.from[0] && x < r.to[0] && y > r.from[1] && y < r.to[1] && z > r.from[2] && z < r.to[2],
  );

export const isNearOpening = (
  openings: readonly StructureOpeningMeta[] | undefined,
  x: number,
  y: number,
  z: number,
  pad = 1,
): boolean => {
  if (!openings) return false;
  return openings.some(
    (o) =>
      x >= o.from[0] - pad &&
      x <= o.to[0] + pad &&
      y >= o.from[1] - pad &&
      y <= o.to[1] + pad &&
      z >= o.from[2] - pad &&
      z <= o.to[2] + pad,
  );
};

export const matchesOptionalTarget = (
  actualState: string,
  targetState: string | null,
  fallbackCheck: (baseName: string) => boolean,
): boolean => {
  const name = parseBlockState(actualState).name;
  if (targetState !== null) return name === parseBlockState(targetState).name;
  return fallbackCheck(name);
};

export const replaceWithPreservedProps = (actualState: string, intoState: string): string => {
  const actual = parseBlockState(actualState);
  const into = parseBlockState(intoState);
  if (Object.keys(into.properties).length > 0 || Object.keys(actual.properties).length === 0) {
    return intoState;
  }
  return formatBlockState({ name: into.name, properties: actual.properties });
};

export const findExteriorOutward = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
): readonly [number, number] | null => {
  for (const [dx, dz] of DIRS4) {
    const nx = x + dx;
    const nz = z + dz;
    if (voxelAt(ctx, nx, y, nz) <= 0 && !isInsideAnyRoom(ctx.rooms, nx, y, nz)) {
      return [dx, dz];
    }
  }
  return null;
};

const pushValidNeighbors = (
  ctx: WeatheringContext,
  cur: number,
  visited: Uint8Array,
  queue: number[],
  removedIndices: ReadonlySet<number>,
): void => {
  const [w, h, d] = ctx.size;
  const cx = cur % w;
  const cz = Math.floor(cur / w) % d;
  const cy = Math.floor(cur / (w * d));
  for (const [dx, dy, dz] of DIRS6) {
    const [nx, ny, nz] = [cx + dx, cy + dy, cz + dz];
    if (nx < 0 || nx >= w || ny < 0 || ny >= h || nz < 0 || nz >= d) continue;
    const next = (ny * d + nz) * w + nx;
    if (visited[next] === 0 && ctx.voxels[next]! > 0 && !removedIndices.has(next)) {
      visited[next] = 1;
      queue.push(next);
    }
  }
};

export const isSingleComponentWithout = (
  ctx: WeatheringContext,
  removedIndices: ReadonlySet<number>,
): boolean => {
  const [w, h, d] = ctx.size;
  const total = w * h * d;
  const visited = new Uint8Array(total);
  const queue: number[] = [];
  let solidCount = 0;
  for (let i = 0; i < total; i += 1) {
    if (ctx.voxels[i]! <= 0 || removedIndices.has(i)) continue;
    solidCount += 1;
    if (Math.floor(i / (w * d)) === 0) {
      visited[i] = 1;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    pushValidNeighbors(ctx, queue[head]!, visited, queue, removedIndices);
  }
  return solidCount > 0 && queue.length === solidCount;
};

const scanPlane = (
  w: number,
  d: number,
  y: number,
  pad: number,
  stepXZ: number,
  fn: (x: number, y: number, z: number) => void,
): void => {
  for (let z = pad; z < d - pad; z += stepXZ) {
    for (let x = pad; x < w - pad; x += stepXZ) fn(x, y, z);
  }
};

export const scanCells = (
  [w, , d]: IntVec3,
  yMin: number,
  yMax: number,
  stepXZ: number,
  stepY: number,
  fn: (x: number, y: number, z: number) => void,
): void => {
  const pad = stepXZ > 1 ? 1 : 0;
  for (let y = yMax; y >= yMin; y -= stepY) scanPlane(w, d, y, pad, stepXZ, fn);
};
