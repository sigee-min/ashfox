import { round4 } from '@ashfox/internal-contracts';
import type { StructureGrid, StructureRoomMeta } from '../../compiler/structure/contract';
import type { PaletteStateMeta } from './paletteMeta';

export interface ConnectivityResult {
  readonly blockCount: number;
  readonly grounded: boolean;
  readonly singleComponent: boolean;
  readonly floatingTargets: readonly string[];
}

export interface EnclosureResult {
  readonly topCoverY: Int16Array;
  readonly interiorMask: Uint8Array;
  readonly interiorCells: number;
  readonly skyLeakCells: number;
  readonly skyLeakRate: number;
  readonly leakTargets: readonly string[];
  readonly roofedInteriorChecked: boolean;
}

const DIRS6: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const visitSolidNeighbors = (
  grid: StructureGrid,
  cur: number,
  visited: Uint8Array,
  queue: number[],
): void => {
  const [w, h, d] = grid.size;
  const cx = cur % w;
  const cz = Math.floor(cur / w) % d;
  const cy = Math.floor(cur / (w * d));
  for (const [dx, dy, dz] of DIRS6) {
    const nx = cx + dx;
    const ny = cy + dy;
    const nz = cz + dz;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h || nz < 0 || nz >= d) continue;
    const next = (ny * d + nz) * w + nx;
    if (visited[next] === 0 && grid.voxels[next]! > 0) {
      visited[next] = 1;
      queue.push(next);
    }
  }
};

const collectFloatingTargets = (grid: StructureGrid, visited: Uint8Array): readonly string[] => {
  const [w, _h, d] = grid.size;
  const targets: string[] = [];
  for (let i = 0; i < grid.voxels.length && targets.length < 3; i += 1) {
    if (grid.voxels[i]! <= 0 || visited[i] !== 0) continue;
    const x = i % w;
    const z = Math.floor(i / w) % d;
    const y = Math.floor(i / (w * d));
    targets.push(`voxel(${x},${y},${z})`);
  }
  return targets;
};

/** Verifies foundation contact at Y=0 and full structural continuity to ground. */
export const analyzeConnectivity = (grid: StructureGrid): ConnectivityResult => {
  const [w, _h, d] = grid.size;
  const total = grid.voxels.length;
  const visited = new Uint8Array(total);
  const queue: number[] = [];
  let blockCount = 0;
  let grounded = false;
  for (let i = 0; i < total; i += 1) {
    if (grid.voxels[i]! <= 0) continue;
    blockCount += 1;
    if (Math.floor(i / (w * d)) === 0) {
      grounded = true;
      visited[i] = 1;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    visitSolidNeighbors(grid, queue[head]!, visited, queue);
  }
  const singleComponent = blockCount > 0 && queue.length === blockCount;
  const floatingTargets = singleComponent ? [] : collectFloatingTargets(grid, visited);
  return { blockCount, grounded, singleComponent, floatingTargets };
};

const computeTopCoverY = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
): Int16Array => {
  const [w, h, d] = grid.size;
  const topCoverY = new Int16Array(w * d).fill(-1);
  for (let z = 0; z < d; z += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let y = h - 1; y >= 0; y -= 1) {
        const st = grid.voxels[(y * d + z) * w + x]!;
        if (st > 0 && paletteMeta[st]!.isRoofCover) {
          topCoverY[z * w + x] = y;
          break;
        }
      }
    }
  }
  return topCoverY;
};

const tryPushOutdoor2d = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  outdoor: Uint8Array,
  queue: number[],
  x: number,
  y: number,
  z: number,
): void => {
  const [w, _h, d] = grid.size;
  const col = z * w + x;
  if (outdoor[col] !== 0) return;
  const st = grid.voxels[(y * d + z) * w + x]!;
  if (st > 0 && paletteMeta[st]!.isWallBarrier) return;
  outdoor[col] = 1;
  queue.push(col);
};

const compute2dEnclosedAtY = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  y: number,
): Uint8Array => {
  const [w, _h, d] = grid.size;
  const outdoor = new Uint8Array(w * d);
  const queue: number[] = [];
  for (let x = 0; x < w; x += 1) {
    tryPushOutdoor2d(grid, paletteMeta, outdoor, queue, x, y, 0);
    tryPushOutdoor2d(grid, paletteMeta, outdoor, queue, x, y, d - 1);
  }
  for (let z = 1; z < d - 1; z += 1) {
    tryPushOutdoor2d(grid, paletteMeta, outdoor, queue, 0, y, z);
    tryPushOutdoor2d(grid, paletteMeta, outdoor, queue, w - 1, y, z);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const col = queue[head]!;
    const cx = col % w;
    const cz = Math.floor(col / w);
    if (cx > 0) tryPushOutdoor2d(grid, paletteMeta, outdoor, queue, cx - 1, y, cz);
    if (cx + 1 < w) tryPushOutdoor2d(grid, paletteMeta, outdoor, queue, cx + 1, y, cz);
    if (cz > 0) tryPushOutdoor2d(grid, paletteMeta, outdoor, queue, cx, y, cz - 1);
    if (cz + 1 < d) tryPushOutdoor2d(grid, paletteMeta, outdoor, queue, cx, y, cz + 1);
  }
  const enclosed = new Uint8Array(w * d);
  for (let i = 0; i < enclosed.length; i += 1) enclosed[i] = outdoor[i] === 0 ? 1 : 0;
  return enclosed;
};

const recordInteriorCell = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  topCoverY: Int16Array,
  interiorMask: Uint8Array,
  leakedCols: Map<number, string>,
  x: number,
  y: number,
  z: number,
  label: string,
): number => {
  const [w, _h, d] = grid.size;
  const idx = (y * d + z) * w + x;
  const st = grid.voxels[idx]!;
  if (st > 0 && !paletteMeta[st]!.isPassable) return 0;
  interiorMask[idx] = 1;
  const col = z * w + x;
  if (topCoverY[col]! <= y && !leakedCols.has(col)) leakedCols.set(col, label);
  return 1;
};

const markRoomBounds = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  room: StructureRoomMeta,
  topCoverY: Int16Array,
  interiorMask: Uint8Array,
  leakedCols: Map<number, string>,
): number => {
  const [w, h, d] = grid.size;
  let checked = 0;
  const insetX = room.to[0] - room.from[0] >= 2 ? 1 : 0;
  const insetZ = room.to[2] - room.from[2] >= 2 ? 1 : 0;
  const x0 = Math.max(0, Math.min(w - 1, room.from[0] + insetX));
  const x1 = Math.max(0, Math.min(w - 1, room.to[0] - insetX));
  const y0 = Math.max(1, Math.min(h - 2, room.from[1] + 1));
  const y1 = Math.max(y0, Math.min(h - 2, room.to[1] - 1));
  const z0 = Math.max(0, Math.min(d - 1, room.from[2] + insetZ));
  const z1 = Math.max(0, Math.min(d - 1, room.to[2] - insetZ));
  for (let y = y0; y <= y1; y += 1) {
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        checked += recordInteriorCell(
          grid,
          paletteMeta,
          topCoverY,
          interiorMask,
          leakedCols,
          x,
          y,
          z,
          `${room.name}(${x},${y},${z})`,
        );
      }
    }
  }
  return checked;
};

const markVoxelEnclosedLayer = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  topCoverY: Int16Array,
  interiorMask: Uint8Array,
  leakedCols: Map<number, string>,
  y: number,
  encCurr: Uint8Array,
  encAbove: Uint8Array,
): number => {
  const w = grid.size[0];
  const d = grid.size[2];
  let checked = 0;
  for (let z = 0; z < d; z += 1) {
    for (let x = 0; x < w; x += 1) {
      const col = z * w + x;
      if (encCurr[col] === 0 || (encAbove[col] === 0 && topCoverY[col]! <= y)) continue;
      checked += recordInteriorCell(
        grid,
        paletteMeta,
        topCoverY,
        interiorMask,
        leakedCols,
        x,
        y,
        z,
        `leak(${x},${y},${z})`,
      );
    }
  }
  return checked;
};

const scanVoxelLayers = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  topCoverY: Int16Array,
  interiorMask: Uint8Array,
  leakedCols: Map<number, string>,
): number => {
  const h = grid.size[1];
  if (h <= 2) return 0;
  let checked = 0;
  let encCurr = compute2dEnclosedAtY(grid, paletteMeta, 1);
  for (let y = 1; y < h - 1; y += 1) {
    const encAbove = compute2dEnclosedAtY(grid, paletteMeta, y + 1);
    checked += markVoxelEnclosedLayer(
      grid,
      paletteMeta,
      topCoverY,
      interiorMask,
      leakedCols,
      y,
      encCurr,
      encAbove,
    );
    encCurr = encAbove;
  }
  return checked;
};

/** Computes roof coverage, interior room masks, and vertical sky leaks. */
export const analyzeEnclosure = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
): EnclosureResult => {
  const topCoverY = computeTopCoverY(grid, paletteMeta);
  const interiorMask = new Uint8Array(grid.voxels.length);
  const leakedCols = new Map<number, string>();
  const enclosedRooms = grid.rooms.filter((r) => r.enclosed && r.kind !== 'courtyard');
  let checkedCells = 0;
  if (enclosedRooms.length > 0) {
    for (const room of enclosedRooms) {
      checkedCells += markRoomBounds(grid, paletteMeta, room, topCoverY, interiorMask, leakedCols);
    }
  } else {
    checkedCells = scanVoxelLayers(grid, paletteMeta, topCoverY, interiorMask, leakedCols);
  }
  let interiorCells = 0;
  for (let i = 0; i < interiorMask.length; i += 1) {
    if (interiorMask[i] === 1) interiorCells += 1;
  }
  const colDenom = Math.max(1, Math.ceil(interiorCells / 2));
  return {
    topCoverY,
    interiorMask,
    interiorCells,
    skyLeakCells: leakedCols.size,
    skyLeakRate: interiorCells > 0 ? round4(Math.min(1, leakedCols.size / colDenom)) : 0,
    leakTargets: [...leakedCols.values()].slice(0, 4),
    roofedInteriorChecked: checkedCells > 0,
  };
};
