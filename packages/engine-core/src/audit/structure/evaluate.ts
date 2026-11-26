import {
  DEFAULT_AUDIT_THRESHOLD,
  gradeForAudit,
  rankTopAuditDeductions,
  round2,
} from '@ashfox/internal-contracts';
import { deepFreeze } from '../../immutable';
import { isValidMinecraftState } from '../../project/structure/state';
import type {
  StructureAuditDeduction,
  StructureAuditPillar,
  StructureBakedMesh,
  StructureLightingField,
} from '../../compiler/structure/contract';
import type {
  StructureAuditGate,
  StructureAuditMetrics,
  StructureAuditReport,
  StructureGrid,
} from './contract';
import { analyzeCirculation, type CirculationResult } from './circulation';
import { computeMeshAndSemanticRatios, evaluateCraftPillar } from './craftScore';
import {
  analyzeConnectivity,
  analyzeEnclosure,
  type ConnectivityResult,
  type EnclosureResult,
} from './enclosure';
import { analyzeFacade, evaluateArchitecture, evaluateFacade } from './facadeScore';
import { computeLitInteriorRatio, evaluateInteriorPillar } from './interiorScore';
import { buildPaletteMeta, type PaletteStateMeta } from './paletteMeta';

interface MaterialCounts {
  readonly lightSources: number;
  readonly furnitureCount: number;
  readonly furnitureKinds: number;
  readonly distinctMaterials: number;
  readonly shapeKinds: number;
  readonly customAssetCount: number;
}

const collectMaterialCounts = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
): MaterialCounts => {
  let lightSources = 0;
  let furnitureCount = 0;
  const materials = new Set<string>();
  const shapes = new Set<string>();
  const customAliases = new Set<string>();
  const furnitureTypes = new Set<string>();

  for (let i = 0; i < grid.voxels.length; i += 1) {
    const v = grid.voxels[i]!;
    if (v <= 0) continue;
    const meta = paletteMeta[v]!;
    materials.add(meta.baseId);
    shapes.add(meta.descriptor.shape);
    if (meta.descriptor.light) lightSources += 1;
    if (meta.descriptor.furniture) {
      furnitureCount += 1;
      furnitureTypes.add(meta.descriptor.shape);
    }
    const tag = grid.customTags[i];
    if (tag) {
      customAliases.add(tag);
      furnitureCount += 1;
      if (tag.includes('lantern') || tag.includes('rune')) lightSources += 1;
    }
  }
  return {
    lightSources,
    furnitureCount,
    furnitureKinds: furnitureTypes.size,
    distinctMaterials: materials.size,
    shapeKinds: shapes.size,
    customAssetCount: customAliases.size,
  };
};

const circulationMessage = (circ: CirculationResult): string => {
  if (circ.walkableCells < 6) return `Only ${circ.walkableCells} walkable interior cells (min 6).`;
  if (circ.unreachableRooms.length > 0)
    return `Unreachable rooms: ${circ.unreachableRooms.join(', ')}.`;
  if (circ.unreachableFloors.length > 0)
    return `Unreachable floors: ${circ.unreachableFloors.join(', ')}.`;
  return `Capsule reach: ${Math.round(circ.walkableReachRatio * 100)}% (${circ.reachableCells}/${circ.walkableCells}).`;
};

const makeGate = (
  id: string,
  passed: boolean,
  message: string,
  targets: readonly string[],
  fix: string,
): StructureAuditGate => ({ id, passed, message, targets, fix });

const enclosureGateMessage = (enc: EnclosureResult): string => {
  if (enc.roofedInteriorChecked && enc.skyLeakCells === 0) {
    return 'Enclosed rooms are weatherproof with 0 vertical sky leaks.';
  }
  return enc.roofedInteriorChecked
    ? `Detected ${enc.skyLeakCells} sky-exposed interior column(s).`
    : 'No enclosed weatherproof interior room detected.';
};

const buildGates = (
  grid: StructureGrid,
  conn: ConnectivityResult,
  enc: EnclosureResult,
  circ: CirculationResult,
): readonly StructureAuditGate[] => {
  const validIds = grid.states.every((s) => s === 'minecraft:air' || isValidMinecraftState(s));
  const circOk =
    circ.walkableCells >= 6 &&
    circ.walkableReachRatio >= 0.8 &&
    circ.unreachableRooms.length === 0 &&
    circ.unreachableFloors.length === 0;
  const encOk = enc.roofedInteriorChecked && enc.skyLeakCells === 0;
  const groundMsg = conn.grounded ? 'Foundation touches Y = 0.' : 'No blocks at Y = 0.';
  const contMsg = conn.singleComponent
    ? 'All blocks connect continuously to the foundation.'
    : 'Floating disconnected blocks detected.';
  const idMsg = validIds
    ? 'All palette states match canonical Minecraft IDs.'
    : 'Invalid Minecraft block state detected.';
  return [
    makeGate(
      'visible_geometry',
      conn.blockCount > 0,
      `Placed ${conn.blockCount} blocks.`,
      [],
      'Add structure geometry.',
    ),
    makeGate('ground_contact', conn.grounded, groundMsg, [], 'Place foundation on y = 0.'),
    makeGate(
      'structural_continuity',
      conn.singleComponent,
      contMsg,
      conn.floatingTargets,
      'Connect all floating blocks to the grounded structure.',
    ),
    makeGate(
      'playable_circulation',
      circOk,
      circulationMessage(circ),
      [...circ.unreachableRooms, ...circ.unreachableFloors],
      'Ensure >= 80% walkable cells and every room/floor are reachable by a 1x2x1 player capsule.',
    ),
    makeGate(
      'weatherproof_enclosure',
      encOk,
      enclosureGateMessage(enc),
      enc.leakTargets,
      'Cover every enclosed interior room completely with roof blocks.',
    ),
    makeGate('valid_minecraft_ids', validIds, idMsg, [], 'Use valid minecraft:block_id states.'),
  ];
};

const gateDeductions = (gates: readonly StructureAuditGate[]): readonly StructureAuditDeduction[] =>
  gates
    .filter((g) => !g.passed)
    .map((g) => ({
      metricId: `gate.${g.id}`,
      pillar: 'gate' as const,
      lostPoints: 100,
      summary: g.message,
      targets: g.targets,
      fix: g.fix,
    }));

const buildMetrics = (
  conn: ConnectivityResult,
  enc: EnclosureResult,
  circ: CirculationResult,
  facade: ReturnType<typeof analyzeFacade>,
  counts: MaterialCounts,
  litInteriorRatio: number,
  prefabUses: number,
  ratios: { readonly greedyCompressionRatio: number; readonly semanticRatio: number },
): StructureAuditMetrics => ({
  blockCount: conn.blockCount,
  interiorCells: enc.interiorCells,
  walkableCells: circ.walkableCells,
  walkableReachRatio: circ.walkableReachRatio,
  avgInteriorHeadroom: circ.avgInteriorHeadroom,
  skyLeakRate: enc.skyLeakRate,
  litInteriorRatio,
  facadeReliefRatio: facade.facadeReliefRatio,
  openingRatio: facade.openingRatio,
  accessibleDoorways: circ.accessibleDoorways,
  lightSources: counts.lightSources,
  furnitureCount: counts.furnitureCount,
  distinctMaterials: counts.distinctMaterials,
  shapeKinds: counts.shapeKinds,
  prefabUses,
  customAssetCount: counts.customAssetCount,
  greedyCompressionRatio: ratios.greedyCompressionRatio,
  semanticRatio: ratios.semanticRatio,
});

const toPillar = (
  id: StructureAuditPillar['id'],
  label: string,
  maxScore: number,
  res: { readonly score: number; readonly metrics: StructureAuditPillar['metrics'] },
): StructureAuditPillar => ({
  id,
  label,
  score: round2(res.score),
  maxScore,
  metrics: res.metrics,
});

const evaluatePillars = (
  grid: StructureGrid,
  conn: ConnectivityResult,
  enc: EnclosureResult,
  circ: CirculationResult,
  facade: ReturnType<typeof analyzeFacade>,
  counts: MaterialCounts,
  litInteriorRatio: number,
  metrics: StructureAuditMetrics,
  mesh?: StructureBakedMesh,
) => {
  const arch = evaluateArchitecture(
    grid,
    conn.blockCount,
    counts.shapeKinds,
    enc.interiorCells,
    circ.accessibleDoorways,
    facade,
  );
  const fac = evaluateFacade(grid, circ.accessibleDoorways, facade, mesh?.trimCount ?? 0);
  const intr = evaluateInteriorPillar(
    grid,
    circ,
    litInteriorRatio,
    counts.lightSources,
    counts.furnitureCount,
    counts.furnitureKinds,
  );
  const craft = evaluateCraftPillar(grid, metrics, mesh);
  const pillars: readonly StructureAuditPillar[] = [
    toPillar('architecture', 'Architecture & Silhouette', 30, arch),
    toPillar('facade', 'Facade Relief & Rhythm', 25, fac),
    toPillar('interior', 'Interior Circulation & Lighting', 25, intr),
    toPillar('craft', 'Modularity & Craft', 20, craft),
  ];
  const raw = Math.round(arch.score + fac.score + intr.score + craft.score);
  const deductions = [
    ...arch.deductions,
    ...fac.deductions,
    ...intr.deductions,
    ...craft.deductions,
  ];
  return { pillars, raw, deductions };
};

/** Evaluates 6 hard gates and 4 architectural quality pillars (100 pts total). */
export const evaluateStructureQuality = (
  grid: StructureGrid,
  prefabUses: number,
  lighting?: StructureLightingField,
  mesh?: StructureBakedMesh,
): StructureAuditReport => {
  const paletteMeta = buildPaletteMeta(grid.states);
  const conn = analyzeConnectivity(grid);
  const enc = analyzeEnclosure(grid, paletteMeta);
  const circ = analyzeCirculation(grid, paletteMeta, enc.interiorMask);
  const facade = analyzeFacade(grid, paletteMeta, enc.topCoverY, enc.interiorMask);
  const counts = collectMaterialCounts(grid, paletteMeta);
  const litInteriorRatio = computeLitInteriorRatio(grid, paletteMeta, enc.interiorMask, lighting);
  const metrics = buildMetrics(
    conn,
    enc,
    circ,
    facade,
    counts,
    litInteriorRatio,
    prefabUses,
    computeMeshAndSemanticRatios(grid, mesh),
  );
  const gates = buildGates(grid, conn, enc, circ);
  const pillarRes = evaluatePillars(
    grid,
    conn,
    enc,
    circ,
    facade,
    counts,
    litInteriorRatio,
    metrics,
    mesh,
  );
  const allGatesPass = gates.every((g) => g.passed);
  const score = Math.max(0, Math.min(allGatesPass ? 100 : 45, pillarRes.raw));
  const passed = allGatesPass && score >= DEFAULT_AUDIT_THRESHOLD;
  return deepFreeze({
    schemaVersion: 1 as const,
    profile: 'structure' as const,
    threshold: DEFAULT_AUDIT_THRESHOLD,
    passed,
    score,
    grade: gradeForAudit(allGatesPass, score, passed, DEFAULT_AUDIT_THRESHOLD),
    hardGates: gates,
    pillars: pillarRes.pillars,
    topDeductions: rankTopAuditDeductions(gateDeductions(gates), pillarRes.deductions),
    metrics,
  });
};
