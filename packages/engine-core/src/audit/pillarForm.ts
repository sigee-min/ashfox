import type { AssetQualityProfile } from '../model/compiled';
import {
  PROFILE_WEIGHTS,
  ramp,
  round2,
  round4,
  type AuditDeduction,
  type AuditPillarReport,
  type AuditSubmetric,
} from './contract';
import type { AuditObb, AuditSceneGeometry } from './geometry';
import { analyzeSilhouettes } from './silhouette';

const partSizeTierEntropy = (obbs: readonly AuditObb[]): number => {
  if (obbs.length < 3) return obbs.length === 2 ? 0.35 : 0;
  const vols = obbs.map((o) => Math.max(0.01, o.volume)).sort((a, b) => a - b);
  const median = vols[Math.floor(vols.length / 2)]!;
  let micro = 0;
  let meso = 0;
  let macro = 0;
  for (const v of vols) {
    const ratio = v / median;
    if (ratio < 0.45) micro += 1;
    else if (ratio > 2.0) macro += 1;
    else meso += 1;
  }
  const n = vols.length;
  let h = 0;
  for (const count of [micro, meso, macro]) {
    if (count === 0) continue;
    const p = count / n;
    h -= p * Math.log(p);
  }
  return h / Math.log(3);
};

const profileFormTargets = (profile: AssetQualityProfile) => {
  if (profile === 'creature') {
    return {
      minParts: 5,
      targetParts: 18,
      angleTarget: 0.35,
      nonBoxTarget: 0.38,
      compactTarget: 1.45,
    };
  }
  if (profile === 'prop') {
    return {
      minParts: 2,
      targetParts: 12,
      angleTarget: 0.3,
      nonBoxTarget: 0.34,
      compactTarget: 1.38,
    };
  }
  return {
    minParts: 1,
    targetParts: 6,
    angleTarget: 0.12,
    nonBoxTarget: 0.14,
    compactTarget: 1.18,
  };
};

const makeDeduction = (
  metric: AuditSubmetric,
  summary: string,
  fix: string,
): AuditDeduction | null => {
  const lost = round2(metric.maxScore - metric.score);
  if (lost < 0.5) return null;
  return { metricId: metric.id, pillar: 'form', lostPoints: lost, summary, targets: [], fix };
};

const metric = (
  id: string,
  label: string,
  ratio: number,
  maxScore: number,
  value: number,
  target: number,
  detail: string,
): AuditSubmetric => ({
  id,
  label,
  score: round2(ratio * maxScore),
  maxScore,
  value,
  target,
  detail,
});

const silhouetteAndBalanceMetrics = (
  profile: AssetQualityProfile,
  scene: AuditSceneGeometry,
): readonly [AuditSubmetric, AuditSubmetric] => {
  const w = PROFILE_WEIGHTS[profile];
  const t = profileFormTargets(profile);
  const count = scene.obbs.length;
  const sil = analyzeSilhouettes(scene.obbs, scene.worldMin, scene.worldMax);
  const nonBox = Math.max(0, 1 - sil.avgFillRatio);
  const silRatio =
    count === 0
      ? 0
      : 0.5 * ramp(nonBox, 0.03, t.nonBoxTarget) +
        0.5 * ramp(sil.avgCompactness, 1.02, t.compactTarget);
  const balRatio =
    count === 0
      ? 0
      : 0.65 * ramp(sil.frontSymmetryIoU, 0.5, 0.92) + 0.35 * (sil.baseStability ? 1 : 0.2);
  return [
    metric(
      'form.silhouette',
      '3-View Silhouette Breakup',
      silRatio,
      w.silhouette,
      round4(nonBox),
      t.nonBoxTarget,
      `avgFillRatio=${round2(sil.avgFillRatio)}, compactness=${round2(sil.avgCompactness)}.`,
    ),
    metric(
      'form.balance',
      'Symmetry & Base Stability',
      balRatio,
      w.balance,
      round4(sil.frontSymmetryIoU),
      0.92,
      `frontSymmetryIoU=${round2(sil.frontSymmetryIoU)}, groundedBase=${sil.baseStability}.`,
    ),
  ];
};

const computeFormMetrics = (
  profile: AssetQualityProfile,
  scene: AuditSceneGeometry,
): readonly AuditSubmetric[] => {
  const w = PROFILE_WEIGHTS[profile];
  const t = profileFormTargets(profile);
  const count = scene.obbs.length;
  const entropy = partSizeTierEntropy(scene.obbs);
  const partsRatio =
    count === 0 ? 0 : 0.6 * ramp(count, t.minParts, t.targetParts) + 0.4 * ramp(entropy, 0.2, 0.85);
  const angledCount = scene.obbs.filter((o) => o.angled || o.isPlane).length;
  const angledShare = count > 0 ? angledCount / count : 0;
  const anglesRatio = count === 0 ? 0 : ramp(angledShare, 0, t.angleTarget);
  return [
    metric(
      'form.parts',
      'Parts & Scale Hierarchy',
      partsRatio,
      w.parts,
      count,
      t.targetParts,
      `${count} parts, size-tier entropy ${round2(entropy)}.`,
    ),
    metric(
      'form.angles',
      'Angled Sculpting & Planes',
      anglesRatio,
      w.angles,
      round4(angledShare),
      t.angleTarget,
      `${angledCount}/${count} angled cubes or thin planes (${Math.round(angledShare * 100)}%).`,
    ),
    ...silhouetteAndBalanceMetrics(profile, scene),
  ];
};

export const evaluateFormPillar = (
  profile: AssetQualityProfile,
  scene: AuditSceneGeometry,
): { readonly pillar: AuditPillarReport; readonly deductions: readonly AuditDeduction[] } => {
  const w = PROFILE_WEIGHTS[profile];
  const metrics = computeFormMetrics(profile, scene);
  const deductions = [
    makeDeduction(
      metrics[0]!,
      `Low part richness (${metrics[0]!.detail}).`,
      'Decompose blocky volumes into macro/meso/micro sub-parts.',
    ),
    makeDeduction(
      metrics[1]!,
      `Low angled/plane detail (${metrics[1]!.detail}).`,
      'Use 22.5° rotated cubes, sloped joints, or thin plane accents (ears, fins, fur tufts).',
    ),
    makeDeduction(
      metrics[2]!,
      `Silhouette remains boxy (${metrics[2]!.detail}).`,
      'Taper limbs, break outer silhouettes with stepped overhangs and angled planes.',
    ),
    makeDeduction(
      metrics[3]!,
      `Weak symmetry or base balance (${metrics[3]!.detail}).`,
      'Use mirror-x on paired parts and keep center of mass over the base footprint.',
    ),
  ].filter((d): d is AuditDeduction => d !== null);
  const score = round2(metrics.reduce((sum, m) => sum + m.score, 0));
  return {
    pillar: { id: 'form', label: '3D Form & Silhouette', score, maxScore: w.formMax, metrics },
    deductions,
  };
};
