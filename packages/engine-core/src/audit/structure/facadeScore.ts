import { auditSubmetric, ramp, round4, type AuditSubmetricShape } from '@ashfox/internal-contracts';
import type { StructureAuditDeduction, StructureGrid } from '../../compiler/structure/contract';
import type { PaletteStateMeta } from './paletteMeta';

export interface FacadeStats {
  readonly facadeReliefRatio: number;
  readonly openingRatio: number;
  readonly roofShapeBlocks: number;
  readonly footprintCols: number;
  readonly heightVariance: number;
  readonly exteriorAccents: number;
  readonly framingBlocks: number;
}

interface FacadeCounts {
  facadeFaces: number;
  reliefFaces: number;
  openingBlocks: number;
  roofShapeBlocks: number;
  exteriorAccents: number;
  framingBlocks: number;
}

const isExteriorFacing = (
  grid: StructureGrid,
  interiorMask: Uint8Array,
  w: number,
  d: number,
  idx: number,
  x: number,
  z: number,
): boolean => {
  if (x === 0 || x + 1 >= w || z === 0 || z + 1 >= d) return true;
  const voxels = grid.voxels;
  return (
    (voxels[idx + 1]! <= 0 && interiorMask[idx + 1] === 0) ||
    (voxels[idx - 1]! <= 0 && interiorMask[idx - 1] === 0) ||
    (voxels[idx + w]! <= 0 && interiorMask[idx + w] === 0) ||
    (voxels[idx - w]! <= 0 && interiorMask[idx - w] === 0)
  );
};

const analyzeHeightSilhouette = (
  topCoverY: Int16Array,
): { readonly footprintCols: number; readonly heightVariance: number } => {
  let footprintCols = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < topCoverY.length; i += 1) {
    const y = topCoverY[i]!;
    if (y < 0) continue;
    footprintCols += 1;
    sum += y;
    sumSq += y * y;
  }
  if (footprintCols === 0) return { footprintCols: 0, heightVariance: 0 };
  const mean = sum / footprintCols;
  return {
    footprintCols,
    heightVariance: Math.sqrt(Math.max(0, sumSq / footprintCols - mean * mean)),
  };
};

const accumulateFacadeCell = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  interiorMask: Uint8Array,
  w: number,
  d: number,
  roofMinY: number,
  x: number,
  y: number,
  z: number,
  acc: FacadeCounts,
): void => {
  const idx = (y * d + z) * w + x;
  const st = grid.voxels[idx]!;
  if (st <= 0) return;
  const meta = paletteMeta[st]!;
  if (y >= roofMinY && (meta.isStair || meta.isSlab)) acc.roofShapeBlocks += 1;
  if (!isExteriorFacing(grid, interiorMask, w, d, idx, x, z)) return;
  acc.facadeFaces += 1;
  if (!meta.descriptor.solidOpaque || grid.customTags[idx] !== null) acc.reliefFaces += 1;
  if (meta.isOpening) acc.openingBlocks += 1;
  if (
    meta.descriptor.light ||
    meta.baseId.includes('leaves') ||
    meta.descriptor.shape === 'trapdoor'
  ) {
    acc.exteriorAccents += 1;
  }
  if (
    meta.baseId.includes('log') ||
    meta.baseId.includes('pillar') ||
    meta.descriptor.shape === 'fence'
  ) {
    acc.framingBlocks += 1;
  }
};

/** Scans exterior shell faces for relief, openings, framing, and roof silhouette. */
export const analyzeFacade = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  topCoverY: Int16Array,
  interiorMask: Uint8Array,
): FacadeStats => {
  const w = grid.size[0];
  const h = grid.size[1];
  const d = grid.size[2];
  const roofMinY = Math.floor(h * 0.4);
  const acc: FacadeCounts = {
    facadeFaces: 0,
    reliefFaces: 0,
    openingBlocks: 0,
    roofShapeBlocks: 0,
    exteriorAccents: 0,
    framingBlocks: 0,
  };
  for (let y = 1; y < h; y += 1) {
    for (let z = 0; z < d; z += 1) {
      for (let x = 0; x < w; x += 1) {
        accumulateFacadeCell(grid, paletteMeta, interiorMask, w, d, roofMinY, x, y, z, acc);
      }
    }
  }
  const sil = analyzeHeightSilhouette(topCoverY);
  const openingCount = Math.max(acc.openingBlocks, grid.openings.length * 2);
  return {
    facadeReliefRatio: acc.facadeFaces > 0 ? round4(acc.reliefFaces / acc.facadeFaces) : 0,
    openingRatio: acc.facadeFaces > 0 ? round4(openingCount / acc.facadeFaces) : 0,
    roofShapeBlocks: acc.roofShapeBlocks,
    footprintCols: sil.footprintCols,
    heightVariance: sil.heightVariance,
    exteriorAccents: acc.exteriorAccents,
    framingBlocks: acc.framingBlocks,
  };
};

interface MetricSpec {
  readonly metric: AuditSubmetricShape;
  readonly fix: string;
}

const scoreSpecs = (
  pillar: 'architecture' | 'facade',
  specs: readonly MetricSpec[],
): {
  readonly score: number;
  readonly metrics: readonly AuditSubmetricShape[];
  readonly deductions: readonly StructureAuditDeduction[];
} => {
  const metrics = specs.map((s) => s.metric);
  const deductions: StructureAuditDeduction[] = [];
  for (const s of specs) {
    const lost = Number((s.metric.maxScore - s.metric.score).toFixed(2));
    if (lost > 0.25) {
      deductions.push({
        metricId: s.metric.id,
        pillar,
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

const archItem = (
  id: string,
  label: string,
  ratio: number,
  maxScore: number,
  val: number,
  target: number,
  detail: string,
  fix: string,
): MetricSpec => ({ metric: auditSubmetric(id, label, ratio, maxScore, val, target, detail), fix });

const collectMassingFeatures = (grid: StructureGrid) => {
  const jettyFloors = grid.floors.filter(
    (f) => f.jetty && Object.values(f.jetty).some((v) => (v ?? 0) > 0),
  ).length;
  const octagonRooms = grid.rooms.filter((r) => r.shape === 'octagon').length;
  const bayArcadeOpenings = grid.openings.filter(
    (o) => o.kind === 'bay_window' || o.kind === 'arcade',
  ).length;
  const multiRoofWings = Math.max(0, grid.roofCount - 1);
  return { jettyFloors, octagonRooms, bayArcadeOpenings, multiRoofWings };
};

const archRatios = (
  grid: StructureGrid,
  blockCount: number,
  shapeKinds: number,
  interiorCells: number,
  accessibleDoorways: number,
  facade: FacadeStats,
) => {
  const massing = collectMassingFeatures(grid);
  const massingBonus =
    massing.jettyFloors + massing.octagonRooms + massing.bayArcadeOpenings + massing.multiRoofWings;
  return {
    footprint:
      0.55 * ramp(blockCount, 40, 220) + 0.45 * ramp(Math.min(grid.size[0], grid.size[2]), 5, 11),
    roof: Math.min(
      1,
      0.45 * ramp(facade.roofShapeBlocks + grid.roofCount * 12, 4, 24) +
        0.25 * (grid.hasRoofTrim || facade.roofShapeBlocks >= 12 ? 1 : 0) +
        0.3 *
          ramp(
            facade.heightVariance + grid.dormerCount + grid.chimneyCount + massing.multiRoofWings,
            0.5,
            2.2,
          ),
    ),
    form: Math.min(
      1,
      0.6 * ramp(shapeKinds, 2, 6) +
        0.4 * ramp(facade.heightVariance, 0.35, 1.8) +
        0.22 * ramp(massingBonus, 1, 4),
    ),
    comp: Math.min(
      1,
      Math.max(
        0.4 * ramp(grid.rooms.length + grid.floors.length + massing.octagonRooms, 1, 4) +
          0.35 * ramp(interiorCells, 16, 80) +
          0.25 * (accessibleDoorways >= 1 ? 1 : 0) +
          0.12 * ramp(massing.jettyFloors + massing.bayArcadeOpenings, 1, 3),
        interiorCells >= 45 && accessibleDoorways >= 1 ? 0.78 : 0,
      ),
    ),
    rooms: grid.rooms.length || (interiorCells >= 45 ? 1 : 0),
    roofDetail: `${facade.roofShapeBlocks} roof slope/trim blocks, variance ${facade.heightVariance.toFixed(2)}`,
  };
};

/** Evaluates Pillar 1: Architecture & Silhouette (30 pts). */
export const evaluateArchitecture = (
  grid: StructureGrid,
  blockCount: number,
  shapeKinds: number,
  interiorCells: number,
  accessibleDoorways: number,
  facade: FacadeStats,
) => {
  const r = archRatios(grid, blockCount, shapeKinds, interiorCells, accessibleDoorways, facade);
  return scoreSpecs('architecture', [
    archItem(
      'arch.footprint',
      'Structural Massing & Scale',
      r.footprint,
      7,
      blockCount,
      200,
      `${blockCount} blocks across ${grid.size.join('x')}`,
      'Expand structural footprint and vertical massing.',
    ),
    archItem(
      'arch.roof_craft',
      'Roof Form & Silhouette',
      r.roof,
      9,
      facade.roofShapeBlocks,
      20,
      r.roofDetail,
      'Add pitched stair/slab roof, overhang trim, dormers, or chimney silhouette.',
    ),
    archItem(
      'arch.form_variety',
      'Form & Shape Variety',
      r.form,
      8,
      shapeKinds,
      6,
      `${shapeKinds} distinct block shapes`,
      'Combine stairs, slabs, walls, fences, and trims for richer form contrast.',
    ),
    archItem(
      'arch.composition',
      'Spatial Composition',
      r.comp,
      6,
      r.rooms,
      3,
      `${grid.rooms.length} declared rooms, ${interiorCells} interior cells`,
      'Organize multi-room or multi-floor layouts with clear entrances.',
    ),
  ]);
};

const facadeRatios = (
  grid: StructureGrid,
  accessibleDoorways: number,
  facade: FacadeStats,
  trimCount: number,
) => {
  const openingSweet =
    facade.openingRatio > 0.45
      ? ramp(1 - facade.openingRatio, 0.25, 0.55)
      : ramp(facade.openingRatio, 0.02, 0.08);
  const bayArcade = grid.openings.filter(
    (o) => o.kind === 'bay_window' || o.kind === 'arcade',
  ).length;
  const trimBonus = trimCount > 0 ? ramp(trimCount, 4, 40) : 0;
  return {
    relief: Math.min(
      1,
      ramp(facade.facadeReliefRatio, 0.02, 0.16) + 0.22 * trimBonus + 0.15 * ramp(bayArcade, 1, 3),
    ),
    openings: Math.min(
      1,
      0.65 * openingSweet + 0.35 * (accessibleDoorways >= 1 ? 1 : 0) + 0.15 * ramp(bayArcade, 1, 2),
    ),
    accents: ramp(
      facade.exteriorAccents +
        grid.customPlacements.length +
        Math.min(8, Math.floor(trimCount / 4)),
      1,
      6,
    ),
    reliefDetail:
      trimCount > 0
        ? `${Math.round(facade.facadeReliefRatio * 100)}% relief, ${trimCount} sub-voxel trims`
        : `${Math.round(facade.facadeReliefRatio * 100)}% exterior relief elements`,
  };
};

/** Evaluates Pillar 2: Facade Relief & Rhythm (25 pts). */
export const evaluateFacade = (
  grid: StructureGrid,
  accessibleDoorways: number,
  facade: FacadeStats,
  trimCount = 0,
) => {
  const r = facadeRatios(grid, accessibleDoorways, facade, trimCount);
  return scoreSpecs('facade', [
    {
      metric: auditSubmetric(
        'facade.relief',
        'Facade Relief & Depth',
        r.relief,
        9,
        facade.facadeReliefRatio,
        0.16,
        r.reliefDetail,
      ),
      fix: 'Break flat walls with recessed windows, shutters, sills, lintels, and pilasters.',
    },
    {
      metric: auditSubmetric(
        'facade.openings',
        'Openings & Fenestration Rhythm',
        r.openings,
        7,
        facade.openingRatio,
        0.1,
        `${Math.round(facade.openingRatio * 100)}% openings, ${accessibleDoorways} doorway(s)`,
      ),
      fix: 'Add framed windows and doors across primary elevations.',
    },
    {
      metric: auditSubmetric(
        'facade.framing',
        'Timber/Stone Structural Framing',
        ramp(facade.framingBlocks + grid.semanticStats.facadeCount * 4, 2, 16),
        5,
        facade.framingBlocks,
        16,
        `${facade.framingBlocks} framing/column elements`,
      ),
      fix: 'Add corner posts, horizontal timber beams, or plinth stone trims.',
    },
    {
      metric: auditSubmetric(
        'facade.accents',
        'Exterior Lanterns & Trim Accents',
        r.accents,
        4,
        facade.exteriorAccents,
        6,
        `${facade.exteriorAccents} exterior accent blocks`,
      ),
      fix: 'Mount exterior wall lanterns, shutters, flower boxes, or porch railings.',
    },
  ]);
};
