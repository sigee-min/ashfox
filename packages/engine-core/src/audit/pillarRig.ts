import type { AssetQualityProfile, CompiledModel } from '../model/compiled';
import type { AnimationClip } from '../model/motion';
import {
  PROFILE_WEIGHTS,
  ramp,
  round2,
  round4,
  type AuditDeduction,
  type AuditPillarReport,
  type AuditSubmetric,
} from './contract';
import type { AuditSceneGeometry } from './geometry';
import type { TelemetrySummary } from './hardGates';
import type { AuditRasterStats } from './rasterStats';

const materialCraftRatio = (telemetry: TelemetrySummary, available: boolean): number => {
  if (!available) return 0.35;
  const bestTone = telemetry.tones.includes('painterly')
    ? 1.0
    : telemetry.tones.includes('voxel')
      ? 0.55
      : 0.25;
  const distinctModes = telemetry.grainModes.length;
  const grainScore =
    distinctModes >= 2
      ? 1.0
      : telemetry.grainModes[0] === 'soft'
        ? 0.7
        : telemetry.grainModes[0] === 'none'
          ? 0.5
          : 0.45;
  return 0.5 * bestTone + 0.5 * grainScore;
};

const clipMotionQuality = (
  clip: AnimationClip,
): { readonly animatedJoints: number; readonly maxKeys: number } => {
  const animatedTargets = new Set<string>();
  let maxKeys = 0;
  for (const ch of Object.values(clip.channels)) {
    if (ch.keys.length > maxKeys) maxKeys = ch.keys.length;
    if (ch.property !== 'rotation' || ch.keys.length < 2) continue;
    const nums = ch.keys.flatMap((k) => k.value.filter((v): v is number => typeof v === 'number'));
    if (nums.length < 2) continue;
    let span = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const vals = ch.keys
        .map((k) => k.value[axis])
        .filter((v): v is number => typeof v === 'number');
      if (vals.length >= 2) span = Math.max(span, Math.max(...vals) - Math.min(...vals));
    }
    if (span >= 2) animatedTargets.add(ch.targetNodeId);
  }
  return { animatedJoints: animatedTargets.size, maxKeys };
};

const creatureRigRatio = (
  scene: AuditSceneGeometry,
  animations: Readonly<Record<string, AnimationClip>>,
): { readonly ratio: number; readonly detail: string } => {
  const clips = Object.values(animations);
  const idle = animations.idle ?? clips.find((c) => c.name === 'idle');
  const idleInfo = idle ? clipMotionQuality(idle) : { animatedJoints: 0, maxKeys: 0 };
  const idleQuality = idle ? 0.3 + 0.7 * ramp(idleInfo.animatedJoints, 1, 5) : 0;
  const maxKeysOverall = Math.max(
    idleInfo.maxKeys,
    ...clips.map((c) => clipMotionQuality(c).maxKeys),
  );
  const secondaryQuality = clips.length >= 2 ? 1.0 : maxKeysOverall >= 3 ? 0.5 : 0;
  const ratio =
    0.35 * ramp(scene.boneCount, 3, 9) +
    0.15 * ramp(scene.maxBoneDepth, 1, 3) +
    0.35 * idleQuality +
    0.15 * secondaryQuality;
  return {
    ratio,
    detail: `${scene.boneCount} bones (depth ${scene.maxBoneDepth}), idle animated joints=${idleInfo.animatedJoints}, clips=${clips.length}.`,
  };
};

const staticRigRatio = (
  scene: AuditSceneGeometry,
  animations: Readonly<Record<string, AnimationClip>>,
): { readonly ratio: number; readonly detail: string } => {
  const cleanHierarchy = !scene.hasOrphanEmptyBones && scene.obbs.length >= 1;
  const clips = Object.values(animations);
  const ratio = cleanHierarchy ? 1.0 : 0.35;
  return {
    ratio,
    detail: `cleanHierarchy=${cleanHierarchy}, bones=${scene.boneCount}, clips=${clips.length}.`,
  };
};

const makeDeduction = (
  metric: AuditSubmetric,
  summary: string,
  fix: string,
): AuditDeduction | null => {
  const lost = round2(metric.maxScore - metric.score);
  if (lost < 0.5) return null;
  return { metricId: metric.id, pillar: 'rig', lostPoints: lost, summary, targets: [], fix };
};

const buildRigMetrics = (
  profile: AssetQualityProfile,
  model: CompiledModel,
  scene: AuditSceneGeometry,
  telemetry: TelemetrySummary,
  telemetryAvailable: boolean,
  raster: AuditRasterStats,
): { readonly metrics: readonly AuditSubmetric[]; readonly rigDetail: string } => {
  const w = PROFILE_WEIGHTS[profile];
  const matRatio = materialCraftRatio(telemetry, telemetryAvailable);
  const rigInfo =
    profile === 'creature'
      ? creatureRigRatio(scene, model.animations)
      : staticRigRatio(scene, model.animations);
  const ppuScore =
    profile === 'block' ? ramp(raster.meanPpu, 0.5, 1.0) : ramp(raster.meanPpu, 1.0, 2.0);
  const uvRatio =
    ppuScore *
    (0.7 + 0.18 * raster.ppuConsistency + 0.12 * ramp(raster.atlasUtilization, 0.08, 0.45));
  return {
    rigDetail: rigInfo.detail,
    metrics: [
      {
        id: 'rig.materialCraft',
        label: 'Tone & Material Grain Differentiation',
        score: round2(matRatio * w.materialCraft),
        maxScore: w.materialCraft,
        value: round4(matRatio),
        target: 1.0,
        detail: `tones=[${telemetry.tones.join(', ')}], grainModes=[${telemetry.grainModes.join(', ')}].`,
      },
      {
        id: 'rig.rigAndMotion',
        label:
          profile === 'creature' ? 'Skeleton Depth & Idle Motion' : 'Hierarchy & Rig Cleanliness',
        score: round2(rigInfo.ratio * w.rigAndMotion),
        maxScore: w.rigAndMotion,
        value: round4(rigInfo.ratio),
        target: 1.0,
        detail: rigInfo.detail,
      },
      {
        id: 'rig.uvEfficiency',
        label: 'UV Density & Atlas Packing',
        score: round2(uvRatio * w.uvEfficiency),
        maxScore: w.uvEfficiency,
        value: round4(raster.meanPpu),
        target: profile === 'block' ? 1.0 : 2.0,
        detail: `meanPpu=${round2(raster.meanPpu)}, ppuConsistency=${round2(raster.ppuConsistency)}, atlasUtil=${Math.round(raster.atlasUtilization * 100)}%.`,
      },
    ],
  };
};

export const evaluateRigPillar = (
  profile: AssetQualityProfile,
  model: CompiledModel,
  scene: AuditSceneGeometry,
  telemetry: TelemetrySummary,
  telemetryAvailable: boolean,
  raster: AuditRasterStats,
): { readonly pillar: AuditPillarReport; readonly deductions: readonly AuditDeduction[] } => {
  const w = PROFILE_WEIGHTS[profile];
  const { metrics, rigDetail } = buildRigMetrics(
    profile,
    model,
    scene,
    telemetry,
    telemetryAvailable,
    raster,
  );
  const deductions = [
    makeDeduction(
      metrics[0]!,
      `Material craft (${metrics[0]!.detail}).`,
      'Enable `tone painterly` and assign per-chart/face `grain soft|none|clustered` per material.',
    ),
    makeDeduction(
      metrics[1]!,
      profile === 'creature'
        ? `Rig/motion incomplete (${rigDetail}).`
        : `Static hierarchy has empty orphan bones or lacks secondary structure (${rigDetail}).`,
      profile === 'creature'
        ? 'Build >= 9 hierarchical bones and animate >= 5 joints cleanly in `motion idle` plus a second clip.'
        : 'Remove unused empty bones.',
    ),
    makeDeduction(
      metrics[2]!,
      `UV density/packing (${metrics[2]!.detail}).`,
      'Use density = 2 for creature/prop (density = 1 for block) with consistent texel scale and auto-atlas.',
    ),
  ].filter((d): d is AuditDeduction => d !== null);
  const score = round2(metrics.reduce((sum, m) => sum + m.score, 0));
  return {
    pillar: { id: 'rig', label: 'Materials, Rig & UV Craft', score, maxScore: w.rigMax, metrics },
    deductions,
  };
};
