import { auditSubmetric } from '@ashfox/internal-contracts';
import type { AssetQualityProfile } from '../model/compiled';
import type { AuditAnatomyReport } from './anatomy';
import {
  PROFILE_WEIGHTS,
  ramp,
  round2,
  type AuditDeduction,
  type AuditPillarReport,
  type AuditSubmetric,
} from './contract';
import { isRewardedAngledPart, type CraftFloorReport } from './craftFloor';
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
      angleTarget: 0.15,
      nonBoxTarget: 0.34,
      compactTarget: 1.38,
    };
  }
  return {
    minParts: 1,
    targetParts: 8,
    angleTarget: 0,
    nonBoxTarget: 0.08,
    compactTarget: 1.05,
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

const balanceRatio = (
  profile: AssetQualityProfile,
  frontSymmetryIoU: number,
  baseStability: boolean,
  taper: number,
): number => {
  const grounded = baseStability ? 1 : 0.2;
  if (profile === 'block') return grounded;
  if (profile === 'prop') return 0.65 * grounded + 0.35 * taper;
  const rawBal = 0.65 * ramp(frontSymmetryIoU, 0.35, 0.72) + 0.35 * grounded;
  return 0.75 * rawBal + 0.25 * taper;
};

const silhouetteAndBalanceMetrics = (
  profile: AssetQualityProfile,
  scene: AuditSceneGeometry,
  anatomy: AuditAnatomyReport,
  craft?: CraftFloorReport,
): readonly [AuditSubmetric, AuditSubmetric] => {
  const w = PROFILE_WEIGHTS[profile];
  const t = profileFormTargets(profile);
  const count = anatomy.structuralObbs.length;
  const sil = analyzeSilhouettes(scene.obbs, scene.worldMin, scene.worldMax);
  const nonBox = Math.max(0, 1 - sil.avgFillRatio);
  const rawSil =
    0.5 * ramp(nonBox, 0.03, t.nonBoxTarget) +
    0.5 * ramp(sil.avgCompactness, 1.02, t.compactTarget);
  const shapedSil = profile === 'block' ? 0.65 + 0.35 * rawSil : rawSil;
  const solidCardGuard = 1 - 0.35 * ramp(anatomy.solidPlaneCount, 0, 2);
  const craftGuard = craft ? Math.max(0.35, 1 - craft.formPenalty * 0.04) : 1;
  const silRatio =
    count === 0 ? 0 : shapedSil * (1 - 0.6 * anatomy.overlapPenalty) * solidCardGuard * craftGuard;
  const balRatio =
    count === 0
      ? 0
      : balanceRatio(
          profile,
          sil.frontSymmetryIoU,
          sil.baseStability,
          anatomy.taperAndArticulationScore,
        );
  return [
    auditSubmetric(
      'form.silhouette',
      profile === 'block' ? 'Silhouette & Clean Seating' : '3-View Silhouette Breakup',
      silRatio,
      w.silhouette,
      nonBox,
      t.nonBoxTarget,
      `avgFillRatio=${round2(sil.avgFillRatio)}, overlap=${round2(anatomy.overlapPenalty)}, solidPlanes=${anatomy.solidPlaneCount}.`,
    ),
    auditSubmetric(
      'form.balance',
      profile === 'creature' ? 'Symmetry & Base Stability' : 'Base Stability & Taper',
      balRatio,
      w.balance,
      sil.frontSymmetryIoU,
      profile === 'creature' ? 0.72 : 1.0,
      `frontSymmetryIoU=${round2(sil.frontSymmetryIoU)}, groundedBase=${sil.baseStability}, taper=${round2(anatomy.taperAndArticulationScore)}.`,
    ),
  ];
};

const computeFormMetrics = (
  profile: AssetQualityProfile,
  scene: AuditSceneGeometry,
  anatomy: AuditAnatomyReport,
  craft?: CraftFloorReport,
): readonly AuditSubmetric[] => {
  const w = PROFILE_WEIGHTS[profile];
  const t = profileFormTargets(profile);
  const obbs = anatomy.structuralObbs;
  const count = obbs.length;
  const entropy = partSizeTierEntropy(obbs);
  const microGuard = 1 - 0.18 * ramp(anatomy.microSpeckCount, 0, 2);
  const craftGuard = craft ? Math.max(0.35, 1 - craft.formPenalty * 0.04) : 1;
  const rawParts =
    profile === 'block' && count === 1
      ? 0.72
      : 0.6 * ramp(count, t.minParts, t.targetParts) + 0.4 * ramp(entropy, 0.2, 0.85);
  const partsRatio = count === 0 ? 0 : rawParts * microGuard;
  const angledCount = obbs.filter(isRewardedAngledPart).length;
  const angledShare = count > 0 ? angledCount / count : 0;
  const anglesRatio =
    count === 0
      ? 0
      : profile === 'block'
        ? (1 - anatomy.overlapPenalty) * microGuard
        : (0.55 * ramp(angledShare, 0, t.angleTarget) + 0.45 * anatomy.taperAndArticulationScore) *
          microGuard *
          craftGuard;
  return [
    auditSubmetric(
      'form.parts',
      'Parts & Scale Hierarchy',
      partsRatio,
      w.parts,
      count,
      t.targetParts,
      `${count} structural parts, entropy=${round2(entropy)}, microSpecks=${anatomy.microSpeckCount}.`,
    ),
    auditSubmetric(
      'form.angles',
      profile === 'block' ? 'Grid Alignment & Step Craft' : 'Angled Sculpting & Planes',
      anglesRatio,
      w.angles,
      profile === 'block' ? 1 - anatomy.overlapPenalty : angledShare,
      profile === 'block' ? 1.0 : t.angleTarget,
      profile === 'block'
        ? `orthogonal step craft, overlap=${round2(anatomy.overlapPenalty)}, microSpecks=${anatomy.microSpeckCount}.`
        : `${angledCount}/${count} angled cubes/planes (${Math.round(angledShare * 100)}%), taper=${round2(anatomy.taperAndArticulationScore)}.`,
    ),
    ...silhouetteAndBalanceMetrics(profile, scene, anatomy, craft),
  ];
};

export const evaluateFormPillar = (
  profile: AssetQualityProfile,
  scene: AuditSceneGeometry,
  anatomy: AuditAnatomyReport,
  craft?: CraftFloorReport,
): { readonly pillar: AuditPillarReport; readonly deductions: readonly AuditDeduction[] } => {
  const w = PROFILE_WEIGHTS[profile];
  const metrics = computeFormMetrics(profile, scene, anatomy, craft);
  const overlapDominates = anatomy.overlapPenalty > 0.25;
  const craftDeductions = craft ? craft.deductions.filter((d) => d.pillar === 'form') : [];
  const deductions = [
    ...craftDeductions,
    makeDeduction(
      metrics[0]!,
      `Low part richness (${metrics[0]!.detail}).`,
      'Decompose blocky volumes into macro/meso/micro sub-parts.',
    ),
    makeDeduction(
      metrics[1]!,
      profile === 'block'
        ? `Grid alignment or overlap issue (${metrics[1]!.detail}).`
        : `Low angled/plane detail (${metrics[1]!.detail}).`,
      profile === 'block'
        ? 'Separate intersecting opaque cubes and remove stray micro-speck geometry.'
        : 'Use 22.5° rotated cubes, sloped joints, or thin plane accents (ears, fins, fur tufts).',
    ),
    makeDeduction(
      metrics[2]!,
      overlapDominates
        ? `Cube overlap or Z-fighting (${metrics[2]!.detail}).`
        : `Silhouette remains boxy (${metrics[2]!.detail}).`,
      overlapDominates
        ? 'Separate overlapping opaque cubes or recess socket joins cleanly.'
        : 'Taper limbs, break outer silhouettes with stepped overhangs and angled planes.',
    ),
    makeDeduction(
      metrics[3]!,
      `Weak ${profile === 'creature' ? 'symmetry or ' : ''}base balance (${metrics[3]!.detail}).`,
      profile === 'creature'
        ? 'Use mirror = x on paired parts and keep center of mass over the base footprint.'
        : 'Keep the center of mass over a grounded base footprint and vary part proportions cleanly.',
    ),
  ].filter((d): d is AuditDeduction => d !== null);
  const score = round2(metrics.reduce((sum, m) => sum + m.score, 0));
  return {
    pillar: { id: 'form', label: '3D Form & Silhouette', score, maxScore: w.formMax, metrics },
    deductions,
  };
};
