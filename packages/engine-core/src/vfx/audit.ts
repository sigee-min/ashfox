import { clamp01 } from '../textures/oklch';
import {
  DEFAULT_VFX_BUDGET,
  type CompiledVfx,
  type CompiledVfxElement,
  type VfxBudget,
} from './contract';
import { measurePaletteContrast } from './oklch';
import { evalScalarLifeCurve } from './particleGeo';

export type VfxAuditMetricId =
  | 'vfx.timingReadability'
  | 'vfx.valueContrast'
  | 'vfx.cleanEnvelope'
  | 'vfx.silhouetteClarity'
  | 'vfx.runtimeBudget';

export interface VfxAuditMetric {
  readonly id: VfxAuditMetricId;
  readonly score: number;
  readonly maxScore: number;
  readonly passed: boolean;
  readonly detail: string;
}

export interface VfxAuditReport {
  readonly passed: boolean;
  readonly score: number;
  readonly maxScore: number;
  readonly metrics: readonly VfxAuditMetric[];
  readonly hardGateFailures: readonly string[];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

const sampleElementEnergy = (el: CompiledVfxElement, t: number): number => {
  if (t < el.startTime - 1e-6 || t > el.endTime + 1e-6) return 0;
  const span = Math.max(1e-6, el.endTime - el.startTime);
  const u = clamp01((t - el.startTime) / span);
  const scl = evalScalarLifeCurve(el.scaleCurve, u);
  const alpha = evalScalarLifeCurve(el.alphaCurve, u);
  return Math.max(0, scl * alpha);
};

const evaluateTimingReadability = (compiled: CompiledVfx): VfxAuditMetric => {
  const samples = 24;
  const energies: number[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = (compiled.durationSeconds * i) / samples;
    let total = 0;
    for (const el of compiled.elements) total += sampleElementEnergy(el, t);
    for (const burst of compiled.particleBursts) {
      const active = burst.tracks.filter((tr) => t >= tr.birthTime && t <= tr.deathTime).length;
      total += active / Math.max(1, burst.particleCount);
    }
    energies.push(total);
  }
  const peak = Math.max(...energies, 0);
  const mean = energies.reduce((s, v) => s + v, 0) / energies.length;
  const contrastRatio = peak > 1e-4 ? (peak - mean) / peak : 0;
  const scoreRatio =
    compiled.loop === 'loop' ? clamp01(0.7 + contrastRatio) : clamp01(contrastRatio * 2.2);
  const score = round2(20 * scoreRatio);
  const passed = peak > 0.25 && (compiled.loop === 'loop' || contrastRatio >= 0.22);
  return {
    id: 'vfx.timingReadability',
    score,
    maxScore: 20,
    passed,
    detail: `peak=${round2(peak)}, mean=${round2(mean)}, contrast=${round2(contrastRatio)}`,
  };
};

const evaluateValueContrast = (compiled: CompiledVfx): VfxAuditMetric => {
  const c = measurePaletteContrast(compiled.palette);
  const coreOk = c.coreL >= 0.9;
  const hierarchyOk = c.coreToMidDeltaL >= 0.12 && c.midToEdgeDeltaL >= 0.12;
  const chromaOk = c.midChroma >= 0.08;
  const ratio =
    (coreOk ? 0.45 : clamp01(c.coreL / 0.9) * 0.35) +
    (hierarchyOk ? 0.35 : 0.15) +
    (chromaOk ? 0.2 : 0.05);
  return {
    id: 'vfx.valueContrast',
    score: round2(20 * ratio),
    maxScore: 20,
    passed: coreOk && hierarchyOk && chromaOk,
    detail: `L_core=${round2(c.coreL)}, L_mid=${round2(c.midL)}, L_edge=${round2(c.edgeL)}, C_mid=${round2(c.midChroma)}`,
  };
};

const elementEndValue = (el: CompiledVfxElement, duration: number): number => {
  if (el.endTime < duration - 1e-4) return 0;
  const sclEnd = el.scaleCurve[el.scaleCurve.length - 1]?.value ?? 1;
  const alphaEnd = el.alphaCurve[el.alphaCurve.length - 1]?.value ?? 1;
  return Math.min(sclEnd, alphaEnd);
};

const evaluateCleanEnvelope = (compiled: CompiledVfx): VfxAuditMetric => {
  if (compiled.loop === 'once') {
    const leakyElements = compiled.elements.filter(
      (el) => elementEndValue(el, compiled.durationSeconds) > 0.05,
    );
    const leakyParticles = compiled.particleBursts.some((b) =>
      b.tracks.some((tr) => {
        const last = tr.scale.values[tr.scale.values.length - 1];
        return last !== undefined && Math.max(last[0], last[1], last[2]) > 0.01;
      }),
    );
    const ok = leakyElements.length === 0 && !leakyParticles;
    return {
      id: 'vfx.cleanEnvelope',
      score: ok ? 20 : 6,
      maxScore: 20,
      passed: ok,
      detail: ok ? 'once clip cleanly decays to 0 at end' : 'non-zero element/particle at clip end',
    };
  }
  const mismatches = compiled.elements.filter((el) => {
    const startVal = (el.scaleCurve[0]?.value ?? 1) * (el.alphaCurve[0]?.value ?? 1);
    const endVal =
      (el.scaleCurve[el.scaleCurve.length - 1]?.value ?? 1) *
      (el.alphaCurve[el.alphaCurve.length - 1]?.value ?? 1);
    return Math.abs(startVal - endVal) > 0.08;
  });
  const ok = mismatches.length === 0;
  return {
    id: 'vfx.cleanEnvelope',
    score: ok ? 20 : 8,
    maxScore: 20,
    passed: ok,
    detail: ok ? 'loop clip boundary C0/C1 continuous' : 'loop start/end mismatch',
  };
};

const evaluateSilhouetteClarity = (compiled: CompiledVfx): VfxAuditMetric => {
  const kinds = new Set<string>(compiled.elements.map((el) => el.mesh.kind));
  for (const b of compiled.particleBursts) kinds.add(b.particleShape);
  let maxExtent = 0;
  for (const el of compiled.elements) {
    const dx = el.mesh.boundsMax[0] - el.mesh.boundsMin[0];
    const dy = el.mesh.boundsMax[1] - el.mesh.boundsMin[1];
    const dz = el.mesh.boundsMax[2] - el.mesh.boundsMin[2];
    maxExtent = Math.max(maxExtent, Math.hypot(dx, dy, dz));
  }
  for (const b of compiled.particleBursts) {
    const dx = b.boundsMax[0] - b.boundsMin[0];
    const dy = b.boundsMax[1] - b.boundsMin[1];
    const dz = b.boundsMax[2] - b.boundsMin[2];
    maxExtent = Math.max(maxExtent, Math.hypot(dx, dy, dz));
  }
  const hasContrastShapes = kinds.size >= 2;
  const hasReadableExtent = maxExtent >= 1.5;
  const score = round2(20 * ((hasContrastShapes ? 0.5 : 0.25) + (hasReadableExtent ? 0.5 : 0.2)));
  return {
    id: 'vfx.silhouetteClarity',
    score,
    maxScore: 20,
    passed: hasContrastShapes && hasReadableExtent,
    detail: `distinctShapes=${kinds.size}, maxExtent=${round2(maxExtent)}`,
  };
};

const evaluateRuntimeBudget = (
  compiled: CompiledVfx,
  budget: VfxBudget,
): { readonly metric: VfxAuditMetric; readonly failures: readonly string[] } => {
  const s = compiled.stats;
  const failures: string[] = [];
  if (s.drawCalls > budget.maxDrawCalls) {
    failures.push(`drawCalls ${s.drawCalls} exceeds max ${budget.maxDrawCalls}`);
  }
  if (s.triangles > budget.maxTriangles) {
    failures.push(`triangles ${s.triangles} exceeds max ${budget.maxTriangles}`);
  }
  if (s.estimatedGlbBytes > budget.maxEstimatedGlbBytes) {
    failures.push(
      `estimatedGlbBytes ${s.estimatedGlbBytes} exceeds max ${budget.maxEstimatedGlbBytes}`,
    );
  }
  if (s.particleCount > budget.maxParticles) {
    failures.push(`particleCount ${s.particleCount} exceeds max ${budget.maxParticles}`);
  }
  const ok = failures.length === 0;
  return {
    metric: {
      id: 'vfx.runtimeBudget',
      score: ok ? 20 : 0,
      maxScore: 20,
      passed: ok,
      detail: `draws=${s.drawCalls}/${budget.maxDrawCalls}, tris=${s.triangles}/${budget.maxTriangles}, estGlb=${s.estimatedGlbBytes}/${budget.maxEstimatedGlbBytes}, particles=${s.particleCount}/${budget.maxParticles}`,
    },
    failures,
  };
};

/**
 * Evaluate VFX quality audit across 5 pillars + hard runtime budget gates
 * (`draws <= 4`, `tris <= 2500`, `estimatedGlb <= 150KB`, `particles <= 64`).
 */
export const auditVfx = (
  compiled: CompiledVfx,
  budgetOverride?: Partial<VfxBudget>,
): VfxAuditReport => {
  const budget: VfxBudget = {
    maxDrawCalls: budgetOverride?.maxDrawCalls ?? DEFAULT_VFX_BUDGET.maxDrawCalls,
    maxTriangles: budgetOverride?.maxTriangles ?? DEFAULT_VFX_BUDGET.maxTriangles,
    maxEstimatedGlbBytes:
      budgetOverride?.maxEstimatedGlbBytes ?? DEFAULT_VFX_BUDGET.maxEstimatedGlbBytes,
    maxParticles: budgetOverride?.maxParticles ?? DEFAULT_VFX_BUDGET.maxParticles,
  };
  const m1 = evaluateTimingReadability(compiled);
  const m2 = evaluateValueContrast(compiled);
  const m3 = evaluateCleanEnvelope(compiled);
  const m4 = evaluateSilhouetteClarity(compiled);
  const budgetResult = evaluateRuntimeBudget(compiled, budget);
  const metrics = Object.freeze([m1, m2, m3, m4, budgetResult.metric]);
  const score = round2(metrics.reduce((sum, m) => sum + m.score, 0));
  const passed = budgetResult.failures.length === 0 && metrics.every((m) => m.passed);
  return Object.freeze({
    passed,
    score,
    maxScore: 100,
    metrics,
    hardGateFailures: Object.freeze(budgetResult.failures),
  });
};
