import { compareText } from '@ashfox/internal-contracts';
import { add3, cross3, dot3, length3, scale3, sub3 } from '../math/vec3';
import type { Vec3 } from '../model/identity';
import type { AuditObb } from './geometry';

export interface SilhouetteSummary {
  readonly avgFillRatio: number;
  readonly avgCompactness: number;
  readonly frontSymmetryIoU: number;
  readonly baseStability: boolean;
}

const obbProjectedRadius = (obb: AuditObb, axis: Vec3, margin: number): number =>
  (obb.half[0] + margin) * Math.abs(dot3(obb.ax, axis)) +
  (obb.half[1] + margin) * Math.abs(dot3(obb.ay, axis)) +
  (obb.half[2] + margin) * Math.abs(dot3(obb.az, axis));

const obbAxis = (obb: AuditObb, index: number): Vec3 =>
  index === 0 ? obb.ax : index === 1 ? obb.ay : obb.az;

const isSeparatingAxis = (
  a: AuditObb,
  b: AuditObb,
  delta: Vec3,
  pad: number,
  axis: Vec3,
): boolean => {
  if (length3(axis) < 1e-6) return false;
  const ra = obbProjectedRadius(a, axis, pad);
  const rb = obbProjectedRadius(b, axis, pad);
  return Math.abs(dot3(delta, axis)) > ra + rb;
};

export const obbsTouchWithin = (a: AuditObb, b: AuditObb, margin: number): boolean => {
  const pad = margin * 0.5;
  for (let i = 0; i < 3; i += 1) {
    if (a.aabbMax[i]! + margin < b.aabbMin[i]! || b.aabbMax[i]! + margin < a.aabbMin[i]!) {
      return false;
    }
  }
  const delta = sub3(b.center, a.center);
  if (
    isSeparatingAxis(a, b, delta, pad, a.ax) ||
    isSeparatingAxis(a, b, delta, pad, a.ay) ||
    isSeparatingAxis(a, b, delta, pad, a.az) ||
    isSeparatingAxis(a, b, delta, pad, b.ax) ||
    isSeparatingAxis(a, b, delta, pad, b.ay) ||
    isSeparatingAxis(a, b, delta, pad, b.az)
  ) {
    return false;
  }
  for (let i = 0; i < 3; i += 1) {
    const ax = obbAxis(a, i);
    for (let j = 0; j < 3; j += 1) {
      if (isSeparatingAxis(a, b, delta, pad, cross3(ax, obbAxis(b, j)))) return false;
    }
  }
  return true;
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
  const d = sub3(corner, outer.center);
  return (
    Math.abs(dot3(d, outer.ax)) <= outer.half[0] + 0.05 &&
    Math.abs(dot3(d, outer.ay)) <= outer.half[1] + 0.05 &&
    Math.abs(dot3(d, outer.az)) <= outer.half[2] + 0.05
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
  base: Vec3,
  edgeA: Vec3,
  edgeB: Vec3,
  axisU: 0 | 1 | 2,
  axisV: 0 | 1 | 2,
  centerU: number,
  centerV: number,
  scale: number,
  grid: Uint8Array,
): void => {
  const baseU = base[axisU];
  const baseV = base[axisV];
  const aU = edgeA[axisU];
  const aV = edgeA[axisV];
  const bU = edgeB[axisU];
  const bV = edgeB[axisV];
  const halfGrid = (GRID - 1) * 0.5;
  const spanA = Math.hypot(aU, aV) * 2 * scale;
  const spanB = Math.hypot(bU, bV) * 2 * scale;
  const stepsA = Math.min(20, Math.max(4, Math.ceil(spanA * 1.5)));
  const stepsB = Math.min(20, Math.max(4, Math.ceil(spanB * 1.5)));
  for (let i = 0; i <= stepsA; i += 1) {
    const s = (i / stepsA) * 2 - 1;
    const rowU = baseU + aU * s;
    const rowV = baseV + aV * s;
    for (let j = 0; j <= stepsB; j += 1) {
      const t = (j / stepsB) * 2 - 1;
      const gx = Math.min(
        GRID - 1,
        Math.max(0, Math.round(halfGrid + (rowU + bU * t - centerU) * scale)),
      );
      const gy = Math.min(
        GRID - 1,
        Math.max(0, Math.round(halfGrid + (rowV + bV * t - centerV) * scale)),
      );
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
  const ex = scale3(obb.ax, obb.half[0]);
  const ey = scale3(obb.ay, obb.half[1]);
  const ez = scale3(obb.az, obb.half[2]);
  for (const s of [-1, 1]) {
    drawFaceQuad(
      add3(obb.center, scale3(ex, s)),
      ey,
      ez,
      axisU,
      axisV,
      centerU,
      centerV,
      scale,
      grid,
    );
    drawFaceQuad(
      add3(obb.center, scale3(ey, s)),
      ex,
      ez,
      axisU,
      axisV,
      centerU,
      centerV,
      scale,
      grid,
    );
    drawFaceQuad(
      add3(obb.center, scale3(ez, s)),
      ex,
      ey,
      axisU,
      axisV,
      centerU,
      centerV,
      scale,
      grid,
    );
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
