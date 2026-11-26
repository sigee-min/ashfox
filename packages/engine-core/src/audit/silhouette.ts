import { compareText } from '@ashfox/internal-contracts';
import type { Vec3 } from '../model/identity';
import type { AuditObb } from './geometry';

export interface SilhouetteSummary {
  readonly avgFillRatio: number;
  readonly avgCompactness: number;
  readonly frontSymmetryIoU: number;
  readonly baseStability: boolean;
}

const obbRadiusScalar = (
  obb: AuditObb,
  ax: number,
  ay: number,
  az: number,
  margin: number,
): number =>
  (obb.half[0] + margin) * Math.abs(obb.ax[0] * ax + obb.ax[1] * ay + obb.ax[2] * az) +
  (obb.half[1] + margin) * Math.abs(obb.ay[0] * ax + obb.ay[1] * ay + obb.ay[2] * az) +
  (obb.half[2] + margin) * Math.abs(obb.az[0] * ax + obb.az[1] * ay + obb.az[2] * az);

const isSeparatingAxisScalar = (
  a: AuditObb,
  b: AuditObb,
  dx: number,
  dy: number,
  dz: number,
  pad: number,
  ax: number,
  ay: number,
  az: number,
): boolean => {
  if (ax * ax + ay * ay + az * az < 1e-12) return false;
  const ra = obbRadiusScalar(a, ax, ay, az, pad);
  const rb = obbRadiusScalar(b, ax, ay, az, pad);
  return Math.abs(dx * ax + dy * ay + dz * az) > ra + rb;
};

const obbAxisVec = (obb: AuditObb, index: number): Vec3 =>
  index === 0 ? obb.ax : index === 1 ? obb.ay : obb.az;

const hasCrossSeparatingAxis = (
  a: AuditObb,
  b: AuditObb,
  dx: number,
  dy: number,
  dz: number,
  pad: number,
): boolean => {
  for (let i = 0; i < 3; i += 1) {
    const u = obbAxisVec(a, i);
    for (let j = 0; j < 3; j += 1) {
      const v = obbAxisVec(b, j);
      const cx = u[1] * v[2] - u[2] * v[1];
      const cy = u[2] * v[0] - u[0] * v[2];
      const cz = u[0] * v[1] - u[1] * v[0];
      if (isSeparatingAxisScalar(a, b, dx, dy, dz, pad, cx, cy, cz)) return true;
    }
  }
  return false;
};

export const obbsTouchWithin = (a: AuditObb, b: AuditObb, margin: number): boolean => {
  if (
    a.aabbMax[0] + margin < b.aabbMin[0] ||
    b.aabbMax[0] + margin < a.aabbMin[0] ||
    a.aabbMax[1] + margin < b.aabbMin[1] ||
    b.aabbMax[1] + margin < a.aabbMin[1] ||
    a.aabbMax[2] + margin < b.aabbMin[2] ||
    b.aabbMax[2] + margin < a.aabbMin[2]
  ) {
    return false;
  }
  const pad = margin * 0.5;
  const dx = b.center[0] - a.center[0];
  const dy = b.center[1] - a.center[1];
  const dz = b.center[2] - a.center[2];
  if (
    isSeparatingAxisScalar(a, b, dx, dy, dz, pad, a.ax[0], a.ax[1], a.ax[2]) ||
    isSeparatingAxisScalar(a, b, dx, dy, dz, pad, a.ay[0], a.ay[1], a.ay[2]) ||
    isSeparatingAxisScalar(a, b, dx, dy, dz, pad, a.az[0], a.az[1], a.az[2]) ||
    isSeparatingAxisScalar(a, b, dx, dy, dz, pad, b.ax[0], b.ax[1], b.ax[2]) ||
    isSeparatingAxisScalar(a, b, dx, dy, dz, pad, b.ay[0], b.ay[1], b.ay[2]) ||
    isSeparatingAxisScalar(a, b, dx, dy, dz, pad, b.az[0], b.az[1], b.az[2])
  ) {
    return false;
  }
  return !hasCrossSeparatingAxis(a, b, dx, dy, dz, pad);
};

const collectComponent = (
  start: number,
  obbs: readonly AuditObb[],
  visited: Uint8Array,
  margin: number,
): number[] => {
  const queue = [start];
  const comp: number[] = [];
  visited[start] = 1;
  while (queue.length > 0) {
    const cur = queue.pop()!;
    comp.push(cur);
    for (let next = 0; next < obbs.length; next += 1) {
      if (visited[next] !== 0) continue;
      if (obbsTouchWithin(obbs[cur]!, obbs[next]!, margin)) {
        visited[next] = 1;
        queue.push(next);
      }
    }
  }
  return comp;
};

export const findFloatingComponents = (
  obbs: readonly AuditObb[],
  margin = 0.75,
): readonly string[] => {
  if (obbs.length <= 1) return [];
  const visited = new Uint8Array(obbs.length);
  const components: number[][] = [];
  for (let i = 0; i < obbs.length; i += 1) {
    if (visited[i] === 0) components.push(collectComponent(i, obbs, visited, margin));
  }
  if (components.length <= 1) return [];
  let mainIndex = 0;
  let maxVolume = -1;
  for (let i = 0; i < components.length; i += 1) {
    const vol = components[i]!.reduce((sum, idx) => sum + obbs[idx]!.volume, 0);
    if (vol > maxVolume) {
      maxVolume = vol;
      mainIndex = i;
    }
  }
  const floating: string[] = [];
  for (let i = 0; i < components.length; i += 1) {
    if (i === mainIndex) continue;
    for (const idx of components[i]!) floating.push(obbs[idx]!.nodeId);
  }
  return floating.sort(compareText);
};

const aabbContainsWithMargin = (inner: AuditObb, outer: AuditObb, margin: number): boolean =>
  inner.aabbMin[0] >= outer.aabbMin[0] - margin &&
  inner.aabbMax[0] <= outer.aabbMax[0] + margin &&
  inner.aabbMin[1] >= outer.aabbMin[1] - margin &&
  inner.aabbMax[1] <= outer.aabbMax[1] + margin &&
  inner.aabbMin[2] >= outer.aabbMin[2] - margin &&
  inner.aabbMax[2] <= outer.aabbMax[2] + margin;

const cornerInsideObb = (corner: Vec3, outer: AuditObb): boolean => {
  const dx = corner[0] - outer.center[0];
  const dy = corner[1] - outer.center[1];
  const dz = corner[2] - outer.center[2];
  return (
    Math.abs(dx * outer.ax[0] + dy * outer.ax[1] + dz * outer.ax[2]) <= outer.half[0] + 0.05 &&
    Math.abs(dx * outer.ay[0] + dy * outer.ay[1] + dz * outer.ay[2]) <= outer.half[1] + 0.05 &&
    Math.abs(dx * outer.az[0] + dy * outer.az[1] + dz * outer.az[2]) <= outer.half[2] + 0.05
  );
};

export const findBuriedCubes = (obbs: readonly AuditObb[]): readonly string[] => {
  const buried: string[] = [];
  for (const inner of obbs) {
    if (inner.isPlane) continue;
    const isHidden = obbs.some((outer) => {
      if (
        outer.nodeId === inner.nodeId ||
        !outer.opaque ||
        outer.volume < inner.volume - 1e-4 ||
        !aabbContainsWithMargin(inner, outer, 0.1)
      ) {
        return false;
      }
      return inner.corners.every((corner) => cornerInsideObb(corner, outer));
    });
    if (isHidden) buried.push(inner.nodeId);
  }
  return buried.sort(compareText);
};

const GRID = 48;

const drawFaceQuad = (
  baseU: number,
  baseV: number,
  aU: number,
  aV: number,
  bU: number,
  bV: number,
  centerU: number,
  centerV: number,
  scale: number,
  grid: Uint8Array,
): void => {
  const halfGrid = (GRID - 1) * 0.5;
  const spanA = Math.hypot(aU, aV) * 2 * scale;
  const spanB = Math.hypot(bU, bV) * 2 * scale;
  const stepsA = Math.min(20, Math.max(4, Math.ceil(spanA * 1.5)));
  const stepsB = Math.min(20, Math.max(4, Math.ceil(spanB * 1.5)));
  for (let i = 0; i <= stepsA; i += 1) {
    const s = (i / stepsA) * 2 - 1;
    const rowU = baseU + aU * s - centerU;
    const rowV = baseV + aV * s - centerV;
    for (let j = 0; j <= stepsB; j += 1) {
      const t = (j / stepsB) * 2 - 1;
      const gx = Math.min(GRID - 1, Math.max(0, Math.round(halfGrid + (rowU + bU * t) * scale)));
      const gy = Math.min(GRID - 1, Math.max(0, Math.round(halfGrid + (rowV + bV * t) * scale)));
      grid[gy * GRID + gx] = 1;
    }
  }
};

const projectAxis = (
  obb: AuditObb,
  axisU: 0 | 1 | 2,
  axisV: 0 | 1 | 2,
  centerU: number,
  centerV: number,
  scale: number,
  grid: Uint8Array,
): void => {
  const cu = obb.center[axisU]!;
  const cv = obb.center[axisV]!;
  const exU = obb.ax[axisU]! * obb.half[0];
  const exV = obb.ax[axisV]! * obb.half[0];
  const eyU = obb.ay[axisU]! * obb.half[1];
  const eyV = obb.ay[axisV]! * obb.half[1];
  const ezU = obb.az[axisU]! * obb.half[2];
  const ezV = obb.az[axisV]! * obb.half[2];
  for (let s = -1; s <= 1; s += 2) {
    drawFaceQuad(cu + exU * s, cv + exV * s, eyU, eyV, ezU, ezV, centerU, centerV, scale, grid);
    drawFaceQuad(cu + eyU * s, cv + eyV * s, exU, exV, ezU, ezV, centerU, centerV, scale, grid);
    drawFaceQuad(cu + ezU * s, cv + ezV * s, exU, exV, eyU, eyV, centerU, centerV, scale, grid);
  }
};

const cellBoundaryEdges = (grid: Uint8Array, x: number, y: number): number => {
  const left = x === 0 || grid[y * GRID + x - 1] === 0 ? 1 : 0;
  const right = x === GRID - 1 || grid[y * GRID + x + 1] === 0 ? 1 : 0;
  const down = y === 0 || grid[(y - 1) * GRID + x] === 0 ? 1 : 0;
  const up = y === GRID - 1 || grid[(y + 1) * GRID + x] === 0 ? 1 : 0;
  return left + right + down + up;
};

const gridStats = (grid: Uint8Array): { readonly fill: number; readonly compactness: number } => {
  let area = 0;
  let perimeter = 0;
  let minX = GRID;
  let maxX = -1;
  let minY = GRID;
  let maxY = -1;
  for (let i = 0; i < GRID * GRID; i += 1) {
    if (grid[i] === 0) continue;
    const x = i % GRID;
    const y = (i - x) / GRID;
    area += 1;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    perimeter += cellBoundaryEdges(grid, x, y);
  }
  if (area === 0) return { fill: 1, compactness: 1 };
  const bboxArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
  return {
    fill: area / bboxArea,
    compactness: perimeter / (4 * Math.sqrt(area)),
  };
};

const occupiedXSpan = (grid: Uint8Array): readonly [number, number] | null => {
  let minX = GRID;
  let maxX = -1;
  for (let i = 0; i < GRID * GRID; i += 1) {
    if (grid[i] !== 1) continue;
    const x = i % GRID;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  return maxX < minX ? null : [minX, maxX];
};

const symmetryIoU = (grid: Uint8Array): number => {
  const bounds = occupiedXSpan(grid);
  if (bounds === null) return 1;
  const [minX, maxX] = bounds;
  const span = minX + maxX;
  let inter = 0;
  let union = 0;
  for (let i = 0; i < GRID * GRID; i += 1) {
    const x = i % GRID;
    if (x < minX || x > maxX) continue;
    const mx = span - x;
    const a = grid[i]!;
    const b = mx >= 0 && mx < GRID ? grid[i - x + mx]! : 0;
    inter += a & b;
    union += a | b;
  }
  return union === 0 ? 1 : inter / union;
};

const renderViewGrid = (
  obbs: readonly AuditObb[],
  axisU: 0 | 1 | 2,
  axisV: 0 | 1 | 2,
  worldMin: Vec3,
  worldMax: Vec3,
): Uint8Array => {
  const spanU = Math.max(0.01, worldMax[axisU]! - worldMin[axisU]!);
  const spanV = Math.max(0.01, worldMax[axisV]! - worldMin[axisV]!);
  const centerU = (worldMin[axisU]! + worldMax[axisU]!) * 0.5;
  const centerV = (worldMin[axisV]! + worldMax[axisV]!) * 0.5;
  const scale = (GRID - 4) / Math.max(spanU, spanV);
  const grid = new Uint8Array(GRID * GRID);
  for (const obb of obbs) {
    projectAxis(obb, axisU, axisV, centerU, centerV, scale, grid);
  }
  return grid;
};

const checkBaseStability = (obbs: readonly AuditObb[], worldMin: Vec3, worldMax: Vec3): boolean => {
  if (obbs.length === 0) return false;
  const height = Math.max(0.1, worldMax[1] - worldMin[1]);
  const baseCutoff = worldMin[1] + height * 0.25;
  let totalVol = 0;
  let cx = 0;
  let cz = 0;
  let bMinX = Infinity;
  let bMaxX = -Infinity;
  let bMinZ = Infinity;
  let bMaxZ = -Infinity;
  for (const obb of obbs) {
    const w = Math.max(0.01, obb.volume);
    totalVol += w;
    cx += obb.center[0] * w;
    cz += obb.center[2] * w;
    if (obb.aabbMin[1] <= baseCutoff + 0.05) {
      bMinX = Math.min(bMinX, obb.aabbMin[0]);
      bMaxX = Math.max(bMaxX, obb.aabbMax[0]);
      bMinZ = Math.min(bMinZ, obb.aabbMin[2]);
      bMaxZ = Math.max(bMaxZ, obb.aabbMax[2]);
    }
  }
  if (totalVol <= 0 || bMaxX < bMinX) return false;
  const padX = Math.max(1.0, (bMaxX - bMinX) * 0.15);
  const padZ = Math.max(1.0, (bMaxZ - bMinZ) * 0.15);
  const meanX = cx / totalVol;
  const meanZ = cz / totalVol;
  return (
    meanX >= bMinX - padX && meanX <= bMaxX + padX && meanZ >= bMinZ - padZ && meanZ <= bMaxZ + padZ
  );
};

export const analyzeSilhouettes = (
  obbs: readonly AuditObb[],
  worldMin: Vec3,
  worldMax: Vec3,
): SilhouetteSummary => {
  if (obbs.length === 0) {
    return { avgFillRatio: 1, avgCompactness: 1, frontSymmetryIoU: 0, baseStability: false };
  }
  const front = renderViewGrid(obbs, 0, 1, worldMin, worldMax);
  const side = renderViewGrid(obbs, 2, 1, worldMin, worldMax);
  const top = renderViewGrid(obbs, 0, 2, worldMin, worldMax);
  const stats = [gridStats(front), gridStats(side), gridStats(top)];
  return {
    avgFillRatio: stats.reduce((s, v) => s + v.fill, 0) / 3,
    avgCompactness: stats.reduce((s, v) => s + v.compactness, 0) / 3,
    frontSymmetryIoU: symmetryIoU(front),
    baseStability: checkBaseStability(obbs, worldMin, worldMax),
  };
};
