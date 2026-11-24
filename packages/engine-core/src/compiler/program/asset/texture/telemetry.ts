import { freeze } from '../../../../immutable';
import type {
  AssetAuthoringTelemetry,
  ChartAuthoringTelemetry,
  GrainMode,
  TextureAuthoringTelemetry,
} from './contract';
import type { FaceDirection, PaintGrid, TextureRegion } from './raster';

export type { AssetAuthoringTelemetry, ChartAuthoringTelemetry, TextureAuthoringTelemetry };

const faceSymmetryRatio = (grid: PaintGrid, region: TextureRegion): number => {
  if (region.width <= 1) return 1;
  let total = 0;
  let matched = 0;
  for (let y = 0; y < region.height; y += 1) {
    const half = Math.floor(region.width / 2);
    for (let x = 0; x < half; x += 1) {
      const leftIdx = (region.y + y) * grid.width + region.x + x;
      const rightIdx = (region.y + y) * grid.width + region.x + (region.width - 1 - x);
      const lVal = grid.values[leftIdx]!;
      const rVal = grid.values[rightIdx]!;
      if (lVal === 0 && rVal === 0) continue;
      total += 1;
      if (lVal === rVal && grid.tones[leftIdx] === grid.tones[rightIdx]) matched += 1;
    }
  }
  return total === 0 ? 1 : matched / total;
};

interface ChartCounts {
  visibleTexels: number;
  authoredDeltaTexels: number;
  aoTexels: number;
  protectedTexels: number;
}

const recordTexel = (
  grid: PaintGrid,
  index: number,
  baseRoleId: number,
  roles: Set<number>,
  counts: ChartCounts,
): void => {
  const role = grid.values[index]!;
  if (role === 0) return;
  counts.visibleTexels += 1;
  roles.add(role);
  const hasAo = grid.ao[index]! > 0;
  if (hasAo) counts.aoTexels += 1;
  if (grid.fixed[index] !== 0) counts.protectedTexels += 1;
  if (role !== baseRoleId || hasAo) counts.authoredDeltaTexels += 1;
};

const accumulateRegionCounts = (
  grid: PaintGrid,
  region: TextureRegion,
  baseRoleId: number,
  roles: Set<number>,
  counts: ChartCounts,
): void => {
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const index = (region.y + y) * grid.width + region.x + x;
      recordTexel(grid, index, baseRoleId, roles, counts);
    }
  }
};

/** Snapshot pre-tone, pre-grain authored structure for a chart grid. */
export const snapshotChartPreGrain = (
  id: string,
  layout: 'box' | 'flat',
  grid: PaintGrid,
  regions: readonly TextureRegion[],
  baseRoleId: number,
  modeFor: (region: TextureRegion) => GrainMode,
): ChartAuthoringTelemetry => {
  const counts: ChartCounts = {
    visibleTexels: 0,
    authoredDeltaTexels: 0,
    aoTexels: 0,
    protectedTexels: 0,
  };
  const roles = new Set<number>();
  const regionGrainModes: Record<string, GrainMode> = {};
  const faceSymmetry: Record<string, number> = {};
  for (const region of regions) {
    const key: FaceDirection | 'flat' = region.direction ?? 'flat';
    regionGrainModes[key] = modeFor(region);
    faceSymmetry[key] = faceSymmetryRatio(grid, region);
    accumulateRegionCounts(grid, region, baseRoleId, roles, counts);
  }
  return freeze({
    id,
    layout,
    visibleTexels: counts.visibleTexels,
    authoredDeltaTexels: counts.authoredDeltaTexels,
    aoTexels: counts.aoTexels,
    protectedTexels: counts.protectedTexels,
    distinctRoles: roles.size,
    regionGrainModes: freeze(regionGrainModes),
    faceSymmetry: freeze(faceSymmetry),
  });
};
