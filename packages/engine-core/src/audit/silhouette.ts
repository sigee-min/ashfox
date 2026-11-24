import type { Vec3 } from '../model/identity';
import type { AuditObb } from './geometry';

export interface SilhouetteSummary {
  readonly avgFillRatio: number;
  readonly avgCompactness: number;
  readonly frontSymmetryIoU: number;
  readonly baseStability: boolean;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const satAxes = (a: AuditObb, b: AuditObb): readonly Vec3[] => {
  const aAxes = [a.ax, a.ay, a.az] as const;
  const bAxes = [b.ax, b.ay, b.az] as const;
  const axes: Vec3[] = [...aAxes, ...bAxes];
  for (const ax of aAxes) {
    for (const bx of bAxes) axes.push(cross(ax, bx));
  }
  return axes;
};

const obbProjectedRadius = (obb: AuditObb, axis: Vec3, margin: number): number =>
  (obb.half[0] + margin) * Math.abs(dot(obb.ax, axis)) +
  (obb.half[1] + margin) * Math.abs(dot(obb.ay, axis)) +
  (obb.half[2] + margin) * Math.abs(dot(obb.az, axis));

export const obbsTouchWithin = (a: AuditObb, b: AuditObb, margin: number): boolean => {
  const pad = margin * 0.5;
  for (let i = 0; i < 3; i += 1) {
    if (a.aabbMax[i]! + margin < b.aabbMin[i]! || b.aabbMax[i]! + margin < a.aabbMin[i]!) {
      return false;
    }
  }
  const delta = sub(b.center, a.center);
  for (const axis of satAxes(a, b)) {
    if (Math.hypot(axis[0], axis[1], axis[2]) < 1e-6) continue;
    const ra = obbProjectedRadius(a, axis, pad);
    const rb = obbProjectedRadius(b, axis, pad);
    if (Math.abs(dot(delta, axis)) > ra + rb) return false;
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
  return floating.sort();
};

const cornerInsideObb = (corner: Vec3, outer: AuditObb): boolean => {
  const d = sub(corner, outer.center);
  return (
    Math.abs(dot(d, outer.ax)) <= outer.half[0] + 0.05 &&
    Math.abs(dot(d, outer.ay)) <= outer.half[1] + 0.05 &&
    Math.abs(dot(d, outer.az)) <= outer.half[2] + 0.05
  );
};

export const findBuriedCubes = (obbs: readonly AuditObb[]): readonly string[] => {
  const buried: string[] = [];
  for (const inner of obbs) {
    if (inner.isPlane) continue;
    const isHidden = obbs.some((outer) => {
      if (outer.nodeId === inner.nodeId || !outer.opaque || outer.volume < inner.volume - 1e-4) {
        return false;
      }
      return inner.corners.every((corner) => cornerInsideObb(corner, outer));
    });
    if (isHidden) buried.push(inner.nodeId);
  }
  return buried.sort();
};

const GRID = 48;

const projectAxis = (
  obb: AuditObb,
  axisU: 0 | 1 | 2,
  axisV: 0 | 1 | 2,
  minU: number,
  minV: number,
  scale: number,
  grid: Uint8Array,
): void => {
  const steps = 6;
  for (let i = 0; i <= steps; i += 1) {
    const sx = (i / steps) * 2 - 1;
    for (let j = 0; j <= steps; j += 1) {
      const sy = (j / steps) * 2 - 1;
      for (let k = 0; k <= steps; k += 1) {
        if (i !== 0 && i !== steps && j !== 0 && j !== steps && k !== 0 && k !== steps) continue;
        const sz = (k / steps) * 2 - 1;
        const px =
          obb.center[0] +
          obb.ax[0] * obb.half[0] * sx +
          obb.ay[0] * obb.half[1] * sy +
          obb.az[0] * obb.half[2] * sz;
        const py =
          obb.center[1] +
          obb.ax[1] * obb.half[0] * sx +
          obb.ay[1] * obb.half[1] * sy +
          obb.az[1] * obb.half[2] * sz;
        const pz =
          obb.center[2] +
          obb.ax[2] * obb.half[0] * sx +
          obb.ay[2] * obb.half[1] * sy +
          obb.az[2] * obb.half[2] * sz;
        const pt = [px, py, pz] as const;
        const gx = Math.min(GRID - 1, Math.max(0, Math.floor((pt[axisU] - minU) * scale)));
        const gy = Math.min(GRID - 1, Math.max(0, Math.floor((pt[axisV] - minV) * scale)));
        grid[gy * GRID + gx] = 1;
      }
    }
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
  const scale = (GRID - 2) / Math.max(spanU, spanV);
  const grid = new Uint8Array(GRID * GRID);
  for (const obb of obbs) {
    projectAxis(obb, axisU, axisV, worldMin[axisU]!, worldMin[axisV]!, scale, grid);
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
