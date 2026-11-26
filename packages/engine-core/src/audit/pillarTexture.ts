import { auditSubmetric } from '@ashfox/internal-contracts';
import type { AssetQualityProfile } from '../model/compiled';
import {
  PROFILE_WEIGHTS,
  ramp,
  round2,
  type AuditDeduction,
  type AuditPillarReport,
  type AuditSubmetric,
} from './contract';
import type { TelemetrySummary } from './hardGates';
import type { AuditRasterStats } from './rasterStats';

const computeFocusRatio = (
  profile: AssetQualityProfile,
  telemetry: TelemetrySummary,
  telemetryAvailable: boolean,
  raster: AuditRasterStats,
): number => {
  const noiseCoherence = 1 - ramp(raster.isolatedNoiseRate, 0.04, 0.2);
  const clutterCoherence = 1 - 0.8 * ramp(raster.highFreqClutterRate, 0.08, 0.3);
  const checkerCoherence = 1 - 0.8 * ramp(raster.checkerRate, 0.03, 0.16);
  const coherence = noiseCoherence * clutterCoherence * checkerCoherence;
  const ppuFactor = profile === 'block' ? 1 : 0.55 + 0.45 * ramp(raster.meanPpu, 1.0, 2.0);
  const nonFlatGate = telemetryAvailable
    ? ramp(telemetry.globalDeltaRatio, 0.01, 0.06)
    : ramp(raster.lumRange, 0.03, 0.09);
  if (!telemetryAvailable) return coherence * nonFlatGate * ppuFactor;
  if (profile !== 'creature') {
    const focusScore = Math.min(1, coherence + (telemetry.hasProtectedFocalTexels ? 0.2 : 0));
    return nonFlatGate * (0.8 * coherence + 0.2 * focusScore) * ppuFactor;
  }
  const symScore = ramp(telemetry.avgForwardSymmetry, 0.55, 0.95);
  const protectBonus = telemetry.hasProtectedFocalTexels ? 0.3 : 0;
  const focusScore = Math.min(1, symScore * 0.85 + protectBonus);
  return nonFlatGate * (0.65 * coherence + 0.35 * focusScore) * ppuFactor;
};

const makeDeduction = (
  metric: AuditSubmetric,
  summary: string,
  targets: readonly string[],
  fix: string,
): AuditDeduction | null => {
  const lost = round2(metric.maxScore - metric.score);
  if (lost < 0.5) return null;
  return { metricId: metric.id, pillar: 'texture', lostPoints: lost, summary, targets, fix };
};

const computeTextureRatios = (
  profile: AssetQualityProfile,
  telemetry: TelemetrySummary,
  telemetryAvailable: boolean,
  raster: AuditRasterStats,
  singleCubeBlock: boolean,
) => {
  const preRise = telemetryAvailable
    ? 0.55 * ramp(telemetry.globalDeltaRatio, 0.05, 0.3) +
      0.45 * ramp(telemetry.craftedChartRatio, 0.15, 0.85)
    : 0;
  const preRestGuard = 1 - 0.85 * ramp(telemetry.globalDeltaRatio, 0.68, 0.94);
  const roleBase = telemetryAvailable ? ramp(telemetry.weightedDistinctRoles, 1.1, 2.8) : 0;
  const valueBase =
    0.5 * ramp(raster.lumRange, 0.08, 0.34) +
    0.3 * ramp(raster.upDownContrast, 0.0, 0.12) +
    0.2 * ramp(raster.lumP90, 0.25, 0.58);
  const crushGuard = 1 - 0.9 * ramp(raster.darkCrushRate, 0.03, 0.2);
  const aoRatio = !telemetryAvailable
    ? 0
    : singleCubeBlock
      ? 0.5 * ramp(raster.upDownContrast, 0.02, 0.12) +
        0.5 * ramp(telemetry.globalDeltaRatio, 0.12, 0.35)
      : 0.6 * ramp(telemetry.aoTexelRatio, 0.0, 0.1) + 0.4 * ramp(telemetry.aoChartRatio, 0.0, 0.5);
  return {
    pre: preRise * preRestGuard,
    role: 0.6 * roleBase + 0.4 * raster.paletteHarmonyScore,
    ao: aoRatio,
    value: valueBase * crushGuard,
    focus: computeFocusRatio(profile, telemetry, telemetryAvailable, raster),
  };
};

const computeTextureMetrics = (
  profile: AssetQualityProfile,
  telemetry: TelemetrySummary,
  telemetryAvailable: boolean,
  raster: AuditRasterStats,
  singleCubeBlock: boolean,
): readonly AuditSubmetric[] => {
  const w = PROFILE_WEIGHTS[profile];
  const r = computeTextureRatios(profile, telemetry, telemetryAvailable, raster, singleCubeBlock);
  return [
    auditSubmetric(
      'texture.preGrainCoverage',
      'Pre-Grain Authored Coverage',
      r.pre,
      w.preGrainCoverage,
      telemetry.globalDeltaRatio,
      0.45,
      `${Math.round(telemetry.globalDeltaRatio * 100)}% pre-grain delta, ${Math.round(telemetry.craftedChartRatio * 100)}% crafted charts.`,
    ),
    auditSubmetric(
      'texture.roleDepth',
      'Palette Role Depth',
      r.role,
      w.roleDepth,
      round2(telemetry.weightedDistinctRoles),
      3.0,
      `Weighted mean ${round2(telemetry.weightedDistinctRoles)} distinct roles per chart.`,
    ),
    auditSubmetric(
      'texture.contactAo',
      singleCubeBlock ? 'Directional Block Contrast' : '3D Contact AO Shading',
      r.ao,
      w.contactAo,
      singleCubeBlock ? raster.upDownContrast : telemetry.aoTexelRatio,
      singleCubeBlock ? 0.12 : 0.1,
      singleCubeBlock
        ? `Single-cube block surface shading: upDownContrast=${round2(raster.upDownContrast)}, preDelta=${Math.round(telemetry.globalDeltaRatio * 100)}%.`
        : `${Math.round(telemetry.aoTexelRatio * 100)}% AO texels across ${Math.round(telemetry.aoChartRatio * 100)}% charts.`,
    ),
    auditSubmetric(
      'texture.valueHierarchy',
      'Luminance & Top-Down Value Hierarchy',
      r.value,
      w.valueHierarchy,
      raster.lumRange,
      0.34,
      `lumRange=${round2(raster.lumRange)}, upDownContrast=${round2(raster.upDownContrast)}.`,
    ),
    auditSubmetric(
      'texture.coherenceAndFocus',
      'Cluster Coherence & Focal Craft',
      r.focus,
      w.coherenceAndFocus,
      1 - raster.isolatedNoiseRate,
      0.94,
      `noise=${round2(raster.isolatedNoiseRate)}, clutter=${round2(raster.highFreqClutterRate)}, checker=${round2(raster.checkerRate)}, sym=${round2(telemetry.avgForwardSymmetry)}.`,
    ),
  ];
};

const buildTextureDeductions = (
  profile: AssetQualityProfile,
  metrics: readonly AuditSubmetric[],
  telemetry: TelemetrySummary,
  raster: AuditRasterStats,
): readonly AuditDeduction[] => {
  const overBusy = telemetry.globalDeltaRatio > 0.68;
  return [
    makeDeduction(
      metrics[0]!,
      overBusy
        ? `Surface is overly busy with too little calm rest area (${metrics[0]!.detail}).`
        : `Pre-grain authored coverage is low (${metrics[0]!.detail}).`,
      telemetry.bareChartIds,
      overBusy
        ? 'Reduce competing patterns so >= 32% of texels remain calm base fill.'
        : 'Replace bare fill charts with gradient, border, stripe, ao, and stamp details.',
    ),
    makeDeduction(
      metrics[1]!,
      `Low palette role variety (${metrics[1]!.detail}).`,
      telemetry.bareChartIds,
      'Use highlight, mid, shade, and accent palette roles within each chart.',
    ),
    makeDeduction(
      metrics[2]!,
      `Contact AO is sparse (${metrics[2]!.detail}).`,
      [],
      'Add `pattern ao` inside charts to shade 3D joint crevices and overhangs.',
    ),
    makeDeduction(
      metrics[3]!,
      `Weak value hierarchy (${metrics[3]!.detail}).`,
      [],
      'Apply vertical gradients (`space = model; axis = y;`) and brighter upward-facing tones.',
    ),
    makeDeduction(
      metrics[4]!,
      `Focal clarity or coherence lost points (${metrics[4]!.detail}).`,
      raster.noisyTextureIds,
      profile === 'creature'
        ? 'Use symmetric face stamps (`protect = true`) and avoid raw 1px noise.'
        : 'Avoid raw 1px noise/clutter and protect focal stamps with `protect = true`.',
    ),
  ].filter((d): d is AuditDeduction => d !== null);
};

export const evaluateTexturePillar = (
  profile: AssetQualityProfile,
  telemetry: TelemetrySummary,
  telemetryAvailable: boolean,
  raster: AuditRasterStats,
  singleCubeBlock = false,
): { readonly pillar: AuditPillarReport; readonly deductions: readonly AuditDeduction[] } => {
  const w = PROFILE_WEIGHTS[profile];
  const metrics = computeTextureMetrics(
    profile,
    telemetry,
    telemetryAvailable,
    raster,
    singleCubeBlock,
  );
  const score = round2(metrics.reduce((sum, m) => sum + m.score, 0));
  return {
    pillar: {
      id: 'texture',
      label: 'Texture & Value Craft',
      score,
      maxScore: w.textureMax,
      metrics,
    },
    deductions: buildTextureDeductions(profile, metrics, telemetry, raster),
  };
};
