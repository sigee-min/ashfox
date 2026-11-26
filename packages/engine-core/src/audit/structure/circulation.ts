import { round2, round4 } from '@ashfox/internal-contracts';
import type { StructureGrid } from '../../compiler/structure/contract';
import type { PaletteStateMeta } from './paletteMeta';

export interface CirculationResult {
  readonly walkableCells: number;
  readonly reachableCells: number;
  readonly walkableReachRatio: number;
  readonly avgInteriorHeadroom: number;
  readonly accessibleDoorways: number;
  readonly unreachableRooms: readonly string[];
  readonly unreachableFloors: readonly string[];
  readonly verticalConnectors: number;
}

const CARDINAL_DX = [1, -1, 0, 0] as const;
const CARDINAL_DZ = [0, 0, 1, -1] as const;

const isPassableAt = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const w = grid.size[0];
  const h = grid.size[1];
  const d = grid.size[2];
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return false;
  const st = grid.voxels[(y * d + z) * w + x]!;
  return st <= 0 || paletteMeta[st]!.isPassable;
};

const canStandAt = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const w = grid.size[0];
  const h = grid.size[1];
  const d = grid.size[2];
  if (x < 0 || x >= w || y < 1 || y + 1 >= h || z < 0 || z >= d) return false;
  const rowBase = (y * d + z) * w + x;
  const atFeet = grid.voxels[rowBase]!;
  if (atFeet > 0 && !paletteMeta[atFeet]!.isPassable) return false;
  const atHead = grid.voxels[rowBase + w * d]!;
  if (atHead > 0 && !paletteMeta[atHead]!.isPassable) return false;
  const below = grid.voxels[rowBase - w * d]!;
  return (
    (below > 0 && paletteMeta[below]!.canStandOn) || (atFeet > 0 && paletteMeta[atFeet]!.isLadder)
  );
};

const isStepUpAllowed = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  interiorMask: Uint8Array,
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  nz: number,
): boolean => {
  const w = grid.size[0];
  const d = grid.size[2];
  if (!isPassableAt(grid, paletteMeta, cx, cy + 2, cz)) return false;
  const idx = (cy * d + cz) * w + cx;
  const st = grid.voxels[(cy * d + nz) * w + nx]!;
  if (st <= 0) return false;
  const meta = paletteMeta[st]!;
  return meta.isStair || meta.isSlab || meta.isLadder || interiorMask[idx] === 0;
};

const enqueueNeighbor = (
  nx: number,
  ny: number,
  nz: number,
  w: number,
  d: number,
  visited: Uint8Array,
  queue: number[],
): void => {
  const next = (ny * d + nz) * w + nx;
  if (visited[next] !== 0) return;
  visited[next] = 1;
  queue.push(next);
};

const expandCapsuleNeighbors = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  interiorMask: Uint8Array,
  cur: number,
  visited: Uint8Array,
  queue: number[],
): void => {
  const w = grid.size[0];
  const d = grid.size[2];
  const cx = cur % w;
  const cz = ((cur / w) | 0) % d;
  const cy = (cur / (w * d)) | 0;
  const curSt = grid.voxels[cur]!;
  if (curSt > 0 && paletteMeta[curSt]!.isLadder) {
    if (canStandAt(grid, paletteMeta, cx, cy + 1, cz))
      enqueueNeighbor(cx, cy + 1, cz, w, d, visited, queue);
    if (canStandAt(grid, paletteMeta, cx, cy - 1, cz))
      enqueueNeighbor(cx, cy - 1, cz, w, d, visited, queue);
  }
  for (let dir = 0; dir < 4; dir += 1) {
    const nx = cx + CARDINAL_DX[dir]!;
    const nz = cz + CARDINAL_DZ[dir]!;
    if (canStandAt(grid, paletteMeta, nx, cy, nz)) {
      enqueueNeighbor(nx, cy, nz, w, d, visited, queue);
    } else if (
      canStandAt(grid, paletteMeta, nx, cy + 1, nz) &&
      isStepUpAllowed(grid, paletteMeta, interiorMask, cx, cy, cz, nx, nz)
    ) {
      enqueueNeighbor(nx, cy + 1, nz, w, d, visited, queue);
    } else if (
      isPassableAt(grid, paletteMeta, nx, cy + 1, nz) &&
      canStandAt(grid, paletteMeta, nx, cy - 1, nz)
    ) {
      enqueueNeighbor(nx, cy - 1, nz, w, d, visited, queue);
    }
  }
};

const touchesExteriorAir = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  interiorMask: Uint8Array,
  x: number,
  y: number,
  z: number,
): boolean => {
  const w = grid.size[0];
  const d = grid.size[2];
  for (let dir = 0; dir < 4; dir += 1) {
    const nx = x + CARDINAL_DX[dir]!;
    const nz = z + CARDINAL_DZ[dir]!;
    if (nx < 0 || nx >= w || nz < 0 || nz >= d) return true;
    const nIdx = (y * d + nz) * w + nx;
    if (interiorMask[nIdx] === 0 && isPassableAt(grid, paletteMeta, nx, y, nz)) return true;
  }
  return false;
};

const isEntrySeedCell = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  interiorMask: Uint8Array,
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, _h, d] = grid.size;
  if (!canStandAt(grid, paletteMeta, x, y, z)) return false;
  const idx = (y * d + z) * w + x;
  if (interiorMask[idx] === 0) return true;
  const st = grid.voxels[idx]!;
  return (
    st > 0 &&
    paletteMeta[st]!.isDoor &&
    touchesExteriorAir(grid, paletteMeta, interiorMask, x, y, z)
  );
};

const seedSocketEntries = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  visited: Uint8Array,
  queue: number[],
): void => {
  const [w, h, d] = grid.size;
  for (const socket of grid.sockets) {
    if (socket.schema !== 'std.entry') continue;
    const sx = Math.max(0, Math.min(w - 1, Math.round(socket.position[0])));
    const sy = Math.max(1, Math.min(h - 2, Math.round(socket.position[1])));
    const sz = Math.max(0, Math.min(d - 1, Math.round(socket.position[2])));
    if (canStandAt(grid, paletteMeta, sx, sy, sz))
      enqueueNeighbor(sx, sy, sz, w, d, visited, queue);
  }
};

const seedEntryCells = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  interiorMask: Uint8Array,
  visited: Uint8Array,
  queue: number[],
): void => {
  const [w, h, d] = grid.size;
  for (let y = 1; y < h - 1; y += 1) {
    for (let z = 0; z < d; z += 1) {
      for (let x = 0; x < w; x += 1) {
        if (isEntrySeedCell(grid, paletteMeta, interiorMask, x, y, z)) {
          enqueueNeighbor(x, y, z, w, d, visited, queue);
        }
      }
    }
  }
  seedSocketEntries(grid, paletteMeta, visited, queue);
};

const computeHeadroom = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  x: number,
  y: number,
  z: number,
): number => {
  const h = grid.size[1];
  let clear = 0;
  for (let ry = y; ry < h; ry += 1) {
    if (!isPassableAt(grid, paletteMeta, x, ry, z)) break;
    clear += 1;
  }
  return clear;
};

const isRoomReachable = (
  grid: StructureGrid,
  walkableMask: Uint8Array,
  visited: Uint8Array,
  room: StructureGrid['rooms'][number],
): boolean => {
  const [w, h, d] = grid.size;
  let hasWalkable = false;
  let reached = false;
  for (let y = Math.max(1, room.from[1] + 1); y <= Math.min(h - 2, room.to[1] - 1); y += 1) {
    for (let z = Math.max(0, room.from[2]); z <= Math.min(d - 1, room.to[2]); z += 1) {
      for (let x = Math.max(0, room.from[0]); x <= Math.min(w - 1, room.to[0]); x += 1) {
        const idx = (y * d + z) * w + x;
        if (walkableMask[idx] !== 1) continue;
        hasWalkable = true;
        if (visited[idx] === 1) reached = true;
      }
    }
  }
  return !hasWalkable || reached;
};

const isFloorReachable = (
  grid: StructureGrid,
  walkableMask: Uint8Array,
  visited: Uint8Array,
  floor: StructureGrid['floors'][number],
): boolean => {
  const [w, h, d] = grid.size;
  let hasWalkable = false;
  let reached = false;
  const minY = Math.max(1, floor.y + 1);
  const maxY = Math.min(h - 2, floor.y + floor.height - 1);
  for (let y = minY; y <= maxY; y += 1) {
    for (let i = y * w * d; i < (y + 1) * w * d; i += 1) {
      if (walkableMask[i] !== 1) continue;
      hasWalkable = true;
      if (visited[i] === 1) reached = true;
    }
  }
  return !hasWalkable || reached;
};

const isConnectorBlock = (meta: PaletteStateMeta | undefined): boolean =>
  meta !== undefined && (meta.isStair || meta.isLadder);

const hasFloorSlabAt = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, _h, d] = grid.size;
  if (x < 0 || x >= w || z < 0 || z >= d) return false;
  const st = grid.voxels[(y * d + z) * w + x]!;
  return st > 0 && paletteMeta[st]!.canStandOn;
};

const isNarrowCeilingBeam = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  x: number,
  y: number,
  z: number,
): boolean => {
  if (y <= 1) return false;
  const [w, _h, d] = grid.size;
  const st = grid.voxels[(y * d + z) * w + x]!;
  const below = grid.voxels[((y - 1) * d + z) * w + x]!;
  if (isConnectorBlock(paletteMeta[st]) || isConnectorBlock(paletteMeta[below])) return false;
  if (grid.floors.length > 0) return !grid.floors.some((f) => y === f.y + 1);
  const hasX =
    hasFloorSlabAt(grid, paletteMeta, x - 1, y - 1, z) ||
    hasFloorSlabAt(grid, paletteMeta, x + 1, y - 1, z);
  const hasZ =
    hasFloorSlabAt(grid, paletteMeta, x, y - 1, z - 1) ||
    hasFloorSlabAt(grid, paletteMeta, x, y - 1, z + 1);
  return !(hasX && hasZ);
};

const scanRowWalkable = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  interiorMask: Uint8Array,
  walkableMask: Uint8Array,
  y: number,
  z: number,
): { readonly walkable: number; readonly headroom: number; readonly connectors: number } => {
  const [w, _h, d] = grid.size;
  let walkable = 0;
  let headroom = 0;
  let connectors = 0;
  for (let x = 0; x < w; x += 1) {
    const idx = (y * d + z) * w + x;
    const st = grid.voxels[idx]!;
    if (st > 0 && isConnectorBlock(paletteMeta[st])) connectors += 1;
    if (interiorMask[idx] !== 1 || !canStandAt(grid, paletteMeta, x, y, z)) continue;
    if (isNarrowCeilingBeam(grid, paletteMeta, x, y, z)) continue;
    walkableMask[idx] = 1;
    walkable += 1;
    headroom += computeHeadroom(grid, paletteMeta, x, y, z);
  }
  return { walkable, headroom, connectors };
};

const scanWalkableAndConnectors = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  interiorMask: Uint8Array,
  walkableMask: Uint8Array,
): {
  readonly walkableCells: number;
  readonly headroomSum: number;
  readonly verticalConnectors: number;
} => {
  const [_w, h, d] = grid.size;
  let walkableCells = 0;
  let headroomSum = 0;
  let verticalConnectors = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let z = 0; z < d; z += 1) {
      const row = scanRowWalkable(grid, paletteMeta, interiorMask, walkableMask, y, z);
      walkableCells += row.walkable;
      headroomSum += row.headroom;
      verticalConnectors += row.connectors;
    }
  }
  return { walkableCells, headroomSum, verticalConnectors };
};

const tallyReachedAndDoors = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  walkableMask: Uint8Array,
  visited: Uint8Array,
): { readonly reachableCells: number; readonly reachedDoors: number } => {
  const [w, _h, d] = grid.size;
  let reachableCells = 0;
  const doors = new Set<string>();
  for (let idx = 0; idx < walkableMask.length; idx += 1) {
    if (visited[idx] !== 1) continue;
    if (walkableMask[idx] === 1) reachableCells += 1;
    const st = grid.voxels[idx]!;
    if (st > 0 && paletteMeta[st]!.isDoor) doors.add(`${idx % w},${Math.floor(idx / w) % d}`);
  }
  return { reachableCells, reachedDoors: doors.size };
};

/** Runs 1x2x1 player capsule 3D BFS through floors, doors, stairs, and ladders. */
export const analyzeCirculation = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  interiorMask: Uint8Array,
): CirculationResult => {
  const walkableMask = new Uint8Array(grid.voxels.length);
  const visited = new Uint8Array(grid.voxels.length);
  const queue: number[] = [];
  const scan = scanWalkableAndConnectors(grid, paletteMeta, interiorMask, walkableMask);

  seedEntryCells(grid, paletteMeta, interiorMask, visited, queue);
  for (let head = 0; head < queue.length; head += 1) {
    expandCapsuleNeighbors(grid, paletteMeta, interiorMask, queue[head]!, visited, queue);
  }

  const reached = tallyReachedAndDoors(grid, paletteMeta, walkableMask, visited);
  const unreachableRooms = grid.rooms
    .filter((r) => r.enclosed && !isRoomReachable(grid, walkableMask, visited, r))
    .map((r) => r.name);
  const unreachableFloors = grid.floors
    .filter((f) => !isFloorReachable(grid, walkableMask, visited, f))
    .map((f) => f.name);
  const declaredDoors = grid.openings.filter((o) => o.kind === 'door').length;
  return {
    walkableCells: scan.walkableCells,
    reachableCells: reached.reachableCells,
    walkableReachRatio:
      scan.walkableCells > 0 ? round4(reached.reachableCells / scan.walkableCells) : 0,
    avgInteriorHeadroom: scan.walkableCells > 0 ? round2(scan.headroomSum / scan.walkableCells) : 0,
    accessibleDoorways: Math.max(reached.reachedDoors, declaredDoors),
    unreachableRooms,
    unreachableFloors,
    verticalConnectors: scan.verticalConnectors,
  };
};
