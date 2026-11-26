import { auditSubmetric, ramp, round4, type AuditSubmetricShape } from '@ashfox/internal-contracts';
import type {
  StructureAuditDeduction,
  StructureGrid,
  StructureLightingField,
} from '../../compiler/structure/contract';
import type { CirculationResult } from './circulation';
import type { PaletteStateMeta } from './paletteMeta';

const LIGHT_DIRS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const hasPopulatedLighting = (lighting?: StructureLightingField): boolean => {
  if (!lighting) return false;
  for (let i = 0; i < lighting.blockR.length; i += 1) {
    if (lighting.blockR[i]! > 0 || lighting.blockG[i]! > 0 || lighting.blockB[i]! > 0) return true;
  }
  return false;
};

const seedLightSources = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  dist: Uint8Array,
): number[] => {
  const queue: number[] = [];
  for (let i = 0; i < grid.voxels.length; i += 1) {
    const v = grid.voxels[i]!;
    const tag = grid.customTags[i];
    const isBlockLight = v > 0 && paletteMeta[v]!.descriptor.light;
    const isCustomLight = tag !== null && (tag.includes('lantern') || tag.includes('rune'));
    if (isBlockLight || isCustomLight) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  return queue;
};

const expandLightNeighbors = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  dist: Uint8Array,
  cur: number,
  queue: number[],
): void => {
  const nextDist = dist[cur]! + 1;
  if (nextDist > 7) return;
  const [w, h, d] = grid.size;
  const cx = cur % w;
  const cz = Math.floor(cur / w) % d;
  const cy = Math.floor(cur / (w * d));
  for (const [dx, dy, dz] of LIGHT_DIRS) {
    const nx = cx + dx;
    const ny = cy + dy;
    const nz = cz + dz;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h || nz < 0 || nz >= d) continue;
    const nIdx = (ny * d + nz) * w + nx;
    const nSt = grid.voxels[nIdx]!;
    if (dist[nIdx] === 255 && (nSt <= 0 || paletteMeta[nSt]!.isPassable)) {
      dist[nIdx] = nextDist;
      queue.push(nIdx);
    }
  }
};

const computeApproxLightDist = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
): Uint8Array => {
  const dist = new Uint8Array(grid.voxels.length).fill(255);
  const queue = seedLightSources(grid, paletteMeta, dist);
  for (let head = 0; head < queue.length; head += 1) {
    expandLightNeighbors(grid, paletteMeta, dist, queue[head]!, queue);
  }
  return dist;
};

/** Computes fraction of interior cells receiving usable block or ambient light. */
export const computeLitInteriorRatio = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  interiorMask: Uint8Array,
  lighting?: StructureLightingField,
): number => {
  const useField = hasPopulatedLighting(lighting);
  const approxDist = useField ? null : computeApproxLightDist(grid, paletteMeta);
  let interior = 0;
  let lit = 0;
  for (let i = 0; i < interiorMask.length; i += 1) {
    if (interiorMask[i] !== 1) continue;
    interior += 1;
    if (useField && lighting) {
      const lum = Math.max(lighting.blockR[i]!, lighting.blockG[i]!, lighting.blockB[i]!);
      if (lum >= 40 || lighting.sky[i]! >= 120) lit += 1;
    } else if (approxDist && approxDist[i]! <= 7) {
      lit += 1;
    }
  }
  return interior > 0 ? round4(lit / interior) : 0;
};

const scoreInteriorSpecs = (
  specs: readonly { readonly metric: AuditSubmetricShape; readonly fix: string }[],
) => {
  const metrics = specs.map((s) => s.metric);
  const deductions: StructureAuditDeduction[] = [];
  for (const s of specs) {
    const lost = Number((s.metric.maxScore - s.metric.score).toFixed(2));
    if (lost > 0.25) {
      deductions.push({
        metricId: s.metric.id,
        pillar: 'interior',
        lostPoints: lost,
        summary: `${s.metric.label}: ${s.metric.detail}`,
        targets: [],
        fix: s.fix,
      });
    }
  }
  return {
    score: Number(metrics.reduce((sum, m) => sum + m.score, 0).toFixed(2)),
    metrics,
    deductions,
  };
};

const interiorItem = (
  id: string,
  label: string,
  ratio: number,
  maxScore: number,
  val: number,
  target: number,
  detail: string,
  fix: string,
) => ({ metric: auditSubmetric(id, label, ratio, maxScore, val, target, detail), fix });

const interiorRatios = (
  grid: StructureGrid,
  circ: CirculationResult,
  litInteriorRatio: number,
  lightSources: number,
  furnitureCount: number,
  furnitureKinds: number,
) => {
  const needsVertical = grid.floors.length >= 2 || grid.size[1] >= 14;
  const verticalScore = needsVertical ? ramp(circ.verticalConnectors, 1, 6) : 1;
  return {
    space: 0.55 * ramp(circ.walkableCells, 8, 52) + 0.45 * ramp(circ.avgInteriorHeadroom, 2.0, 3.4),
    circ:
      0.5 * ramp(circ.walkableReachRatio, 0.8, 1.0) +
      0.25 * (circ.accessibleDoorways >= 1 ? 1 : 0) +
      0.25 * verticalScore,
    light: 0.55 * ramp(litInteriorRatio, 0.35, 0.9) + 0.45 * ramp(lightSources, 1, 4),
    furnish: 0.55 * ramp(furnitureCount, 1, 8) + 0.45 * ramp(furnitureKinds, 1, 5),
    spaceDetail: `${circ.walkableCells} walkable cells, ${circ.avgInteriorHeadroom.toFixed(1)}m avg headroom`,
    circDetail: `${Math.round(circ.walkableReachRatio * 100)}% reachable, ${circ.accessibleDoorways} doorway(s)`,
    lightDetail: `${Math.round(litInteriorRatio * 100)}% lit interior, ${lightSources} light source(s)`,
  };
};

/** Evaluates Pillar 3: Interior Circulation & Lighting (25 pts). */
export const evaluateInteriorPillar = (
  grid: StructureGrid,
  circ: CirculationResult,
  litInteriorRatio: number,
  lightSources: number,
  furnitureCount: number,
  furnitureKinds: number,
) => {
  const r = interiorRatios(
    grid,
    circ,
    litInteriorRatio,
    lightSources,
    furnitureCount,
    furnitureKinds,
  );
  return scoreInteriorSpecs([
    interiorItem(
      'interior.space',
      'Walkable Area & Headroom',
      r.space,
      6,
      circ.walkableCells,
      48,
      r.spaceDetail,
      'Provide >= 2.5m headroom and generous walkable room footprints.',
    ),
    interiorItem(
      'interior.circulation',
      'Capsule Connectivity & Doors',
      r.circ,
      6,
      circ.walkableReachRatio,
      1,
      r.circDetail,
      'Connect all rooms and upper floors via doors and navigable stairs.',
    ),
    interiorItem(
      'interior.lighting',
      'Warm Interior Lighting',
      r.light,
      7,
      litInteriorRatio,
      0.85,
      r.lightDetail,
      'Place lanterns, torches, or lit hearths across dark room corners.',
    ),
    interiorItem(
      'interior.furnishing',
      'Interior Furnishing & Props',
      r.furnish,
      6,
      furnitureCount,
      8,
      `${furnitureCount} furniture blocks across ${furnitureKinds} types`,
      'Furnish rooms with beds, chests, hearths, tables, bookshelves, and rugs.',
    ),
  ]);
};
