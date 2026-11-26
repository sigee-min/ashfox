import { auditSubmetric, ramp, round4, type AuditSubmetricShape } from '@ashfox/internal-contracts';
import type {
  StructureAuditDeduction,
  StructureAuditMetrics,
  StructureBakedMesh,
  StructureGrid,
} from '../../compiler/structure/contract';

export const computeMeshAndSemanticRatios = (
  grid: StructureGrid,
  mesh?: StructureBakedMesh,
): { readonly greedyCompressionRatio: number; readonly semanticRatio: number } => {
  const raw = mesh?.rawFaceCount ?? 0;
  const merged = mesh?.mergedQuadCount ?? 0;
  const greedyCompressionRatio = raw > 0 ? round4(Math.min(1, merged / raw)) : 1;
  const s = grid.semanticStats;
  const semanticOps =
    s.roomCount + s.facadeCount + s.stairCount + s.furnishCount + s.weatheringCount;
  const totalOps = semanticOps + s.rawSetCount;
  const semanticRatio = totalOps > 0 ? round4(semanticOps / totalOps) : 0;
  return { greedyCompressionRatio, semanticRatio };
};

const scoreCraftSpecs = (
  specs: readonly { readonly metric: AuditSubmetricShape; readonly fix: string }[],
) => {
  const metrics = specs.map((s) => s.metric);
  const deductions: StructureAuditDeduction[] = [];
  for (const s of specs) {
    const lost = Number((s.metric.maxScore - s.metric.score).toFixed(2));
    if (lost > 0.25) {
      deductions.push({
        metricId: s.metric.id,
        pillar: 'craft',
        lostPoints: lost,
        summary: `${s.metric.label}: ${s.metric.detail}`,
        targets: [],
        fix: s.fix,
      });
    }
  }
  return {
    score: Number(metrics.reduce((sum, item) => sum + item.score, 0).toFixed(2)),
    metrics,
    deductions,
  };
};

const craftItem = (
  id: string,
  label: string,
  ratio: number,
  maxScore: number,
  val: number,
  target: number,
  detail: string,
  fix: string,
) => ({ metric: auditSubmetric(id, label, ratio, maxScore, val, target, detail), fix });

const craftRatios = (grid: StructureGrid, m: StructureAuditMetrics, mesh?: StructureBakedMesh) => {
  const mod =
    0.55 * ramp(m.prefabUses, 0, 3) +
    0.25 * (grid.density === 2 ? 1 : 0.4) +
    0.2 * Math.max(m.semanticRatio, m.prefabUses >= 2 ? 0.8 : 0);
  const custom =
    0.6 * ramp(m.customAssetCount, 0, 2) + 0.4 * ramp(grid.customPlacements.length, 0, 4);
  const hasMeshStats = (mesh?.rawFaceCount ?? 0) > 0;
  const opt = hasMeshStats ? ramp(1 - m.greedyCompressionRatio, 0.2, 0.6) : 0.75;
  const optDetail = hasMeshStats
    ? `${Math.round((1 - m.greedyCompressionRatio) * 100)}% quad reduction`
    : 'Greedy stats deferred';
  return { mod, custom, opt, optDetail };
};

/** Evaluates Pillar 4: Modularity & Craft (20 pts). */
export const evaluateCraftPillar = (
  grid: StructureGrid,
  m: StructureAuditMetrics,
  mesh?: StructureBakedMesh,
) => {
  const r = craftRatios(grid, m, mesh);
  return scoreCraftSpecs([
    craftItem(
      'craft.palette',
      'Material Palette Richness',
      ramp(m.distinctMaterials, 3, 10),
      7,
      m.distinctMaterials,
      10,
      `${m.distinctMaterials} distinct block materials`,
      'Mix complementary stone, timber, trim, glass, and accent block materials.',
    ),
    craftItem(
      'craft.modularity',
      'Modular Prefabs & Semantic DSL',
      r.mod,
      5,
      m.prefabUses,
      3,
      `${m.prefabUses} prefab uses, density=${grid.density}`,
      'Reuse modular prefabs/modules and semantic room/facade/roof directives.',
    ),
    craftItem(
      'craft.custom_props',
      'Custom .ashfox Props',
      r.custom,
      4,
      m.customAssetCount,
      2,
      `${m.customAssetCount} custom prop types (${grid.customPlacements.length} placed)`,
      'Import and place custom .ashfox props such as wall lanterns or carved pillars.',
    ),
    craftItem(
      'craft.optimization',
      'Greedy Mesh Optimization',
      r.opt,
      4,
      m.greedyCompressionRatio,
      0.4,
      r.optDetail,
      'Use cohesive wall/floor planes so greedy meshing merges coplanar quads.',
    ),
  ]);
};
