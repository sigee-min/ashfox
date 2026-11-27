import { auditSubmetric } from '@ashfox/internal-contracts';
import type { BakedClip, BakedKey, RigJoint } from '../animation/contract';
import { quatFromEulerXyzDeg } from '../animation/quat';
import type { AssetQualityProfile, CompiledModel } from '../model/compiled';
import type { AnimationClip } from '../model/motion';
import { evaluateMotionQuality } from './motion';
import {
  PROFILE_WEIGHTS,
  ramp,
  round2,
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

const toBakedKey = (
  property: 'position' | 'rotation' | 'scale',
  k: AnimationClip['channels'][string]['keys'][number],
): BakedKey => {
  const nums: readonly [number, number, number] = [
    typeof k.value[0] === 'number' ? k.value[0] : 0,
    typeof k.value[1] === 'number' ? k.value[1] : 0,
    typeof k.value[2] === 'number' ? k.value[2] : 0,
  ];
  return {
    time: k.timeSeconds,
    value: property === 'rotation' ? (k.quaternion ?? quatFromEulerXyzDeg(nums)) : nums,
    interpolation: k.interpolation === 'step' ? 'step' : 'linear',
  };
};

const toBakedClips = (animations: Readonly<Record<string, AnimationClip>>): BakedClip[] =>
  Object.values(animations).map((clip) => ({
    id: clip.id,
    name: clip.name,
    duration: clip.durationSeconds,
    fps: clip.fps,
    loop: clip.loop === 'loop' ? 'loop' : 'once',
    channels: Object.values(clip.channels).map((ch) => ({
      jointId: ch.targetNodeId,
      property: ch.property,
      keys: ch.keys.map((k) => toBakedKey(ch.property, k)),
    })),
    cues: clip.cues ?? [],
    sampledFrames: Math.max(2, Math.round(clip.durationSeconds * clip.fps)),
  }));

const toRigJoints = (model: CompiledModel): RigJoint[] =>
  Object.values(model.scene.nodes)
    .filter((node) => node.kind === 'bone')
    .map((node) => ({
      id: node.id,
      parentId: node.parentId,
      role: 'body',
      channels: ['position', 'rotation', 'scale'],
      restPosition: node.transform.pivot,
      restRotation: quatFromEulerXyzDeg(node.transform.rotation),
      restScale: node.transform.scale,
    }));

const creatureRigRatio = (
  model: CompiledModel,
  scene: AuditSceneGeometry,
  animations: Readonly<Record<string, AnimationClip>>,
): { readonly ratio: number; readonly detail: string } => {
  const clips = toBakedClips(animations);
  const joints = toRigJoints(model);
  const motion = evaluateMotionQuality({ clips, joints });
  const skeletonRatio = 0.7 * ramp(scene.boneCount, 3, 9) + 0.3 * ramp(scene.maxBoneDepth, 1, 3);
  const motionRatio = clips.length === 0 ? 0 : motion.score / 100;
  const ratio = 0.4 * skeletonRatio + 0.6 * motionRatio;
  return {
    ratio,
    detail: `${scene.boneCount} bones (depth ${scene.maxBoneDepth}), motionAudit=${motion.score}/100, clips=${clips.length}.`,
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
      ? creatureRigRatio(model, scene, model.animations)
      : staticRigRatio(scene, model.animations);
  const ppuScore =
    profile === 'block' ? ramp(raster.meanPpu, 0.5, 1.0) : ramp(raster.meanPpu, 1.0, 2.0);
  const uvRatio =
    ppuScore *
    (0.7 + 0.18 * raster.ppuConsistency + 0.12 * ramp(raster.atlasUtilization, 0.08, 0.45));
  return {
    rigDetail: rigInfo.detail,
    metrics: [
      auditSubmetric(
        'rig.materialCraft',
        'Tone & Material Grain Differentiation',
        matRatio,
        w.materialCraft,
        matRatio,
        1.0,
        `tones=[${telemetry.tones.join(', ')}], grainModes=[${telemetry.grainModes.join(', ')}].`,
      ),
      auditSubmetric(
        'rig.rigAndMotion',
        profile === 'creature' ? 'Skeleton Depth & Idle Motion' : 'Hierarchy & Rig Cleanliness',
        rigInfo.ratio,
        w.rigAndMotion,
        rigInfo.ratio,
        1.0,
        rigInfo.detail,
      ),
      auditSubmetric(
        'rig.uvEfficiency',
        'UV Density & Atlas Packing',
        uvRatio,
        w.uvEfficiency,
        raster.meanPpu,
        profile === 'block' ? 1.0 : 2.0,
        `meanPpu=${round2(raster.meanPpu)}, ppuConsistency=${round2(raster.ppuConsistency)}, atlasUtil=${Math.round(raster.atlasUtilization * 100)}%.`,
      ),
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
