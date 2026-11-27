import { compareText } from '@ashfox/internal-contracts';
import type { AssetQualityProfile, CompiledModel } from '../model/compiled';
import type { AssetAuthoringTelemetry, ChartAuthoringTelemetry } from '../model/telemetry';
import type { AuditGateResult } from './contract';
import type { CraftFloorReport } from './craftFloor';
import type { AuditSceneGeometry } from './geometry';
import type { AuditRasterStats } from './rasterStats';
import { findBuriedCubes, findFloatingComponents } from './silhouette';

export interface TelemetrySummary {
  readonly chartCount: number;
  readonly totalVisibleTexels: number;
  readonly globalDeltaRatio: number;
  readonly craftedChartRatio: number;
  readonly weightedDistinctRoles: number;
  readonly maxDistinctRoles: number;
  readonly aoTexelRatio: number;
  readonly aoChartRatio: number;
  readonly bareChartIds: readonly string[];
  readonly grainModes: readonly string[];
  readonly tones: readonly string[];
  readonly hasProtectedFocalTexels: boolean;
  readonly avgForwardSymmetry: number;
}

const EMPTY_SUMMARY: TelemetrySummary = {
  chartCount: 0,
  totalVisibleTexels: 0,
  globalDeltaRatio: 0,
  craftedChartRatio: 0,
  weightedDistinctRoles: 0,
  maxDistinctRoles: 0,
  aoTexelRatio: 0,
  aoChartRatio: 0,
  bareChartIds: [],
  grainModes: [],
  tones: [],
  hasProtectedFocalTexels: false,
  avgForwardSymmetry: 0,
};

interface TelemetryAcc {
  visible: number;
  delta: number;
  ao: number;
  crafted: number;
  aoCharts: number;
  weightedRoles: number;
  maxDistinctRoles: number;
  hasProtected: boolean;
  symSum: number;
  symCount: number;
  readonly bareChartIds: string[];
  readonly grainSet: Set<string>;
}

const isChartCrafted = (c: ChartAuthoringTelemetry): boolean =>
  c.distinctRoles >= 2 || (c.visibleTexels > 0 && c.authoredDeltaTexels / c.visibleTexels >= 0.12);

const recordChartTelemetry = (
  acc: TelemetryAcc,
  c: ChartAuthoringTelemetry,
  forward: CompiledModel['forward'],
): void => {
  acc.visible += c.visibleTexels;
  acc.delta += c.authoredDeltaTexels;
  acc.ao += c.aoTexels;
  acc.weightedRoles += c.distinctRoles * c.visibleTexels;
  acc.maxDistinctRoles = Math.max(acc.maxDistinctRoles, c.distinctRoles);
  if (c.aoTexels > 0) acc.aoCharts += 1;
  if (c.protectedTexels > 0) acc.hasProtected = true;
  if (isChartCrafted(c)) acc.crafted += 1;
  else acc.bareChartIds.push(c.id);
  for (const mode of Object.values(c.regionGrainModes)) acc.grainSet.add(mode);
  const sym = c.faceSymmetry[forward] ?? c.faceSymmetry.flat;
  if (sym !== undefined && c.authoredDeltaTexels > 0) {
    acc.symSum += sym;
    acc.symCount += 1;
  }
};

export const summarizeTelemetry = (
  telemetry: AssetAuthoringTelemetry | undefined,
  forward: CompiledModel['forward'],
): TelemetrySummary => {
  if (telemetry === undefined) return EMPTY_SUMMARY;
  const textures = Object.values(telemetry.textures);
  const charts = textures.flatMap((t) => t.charts);
  const acc: TelemetryAcc = {
    visible: 0,
    delta: 0,
    ao: 0,
    crafted: 0,
    aoCharts: 0,
    weightedRoles: 0,
    maxDistinctRoles: 0,
    hasProtected: false,
    symSum: 0,
    symCount: 0,
    bareChartIds: [],
    grainSet: new Set<string>(),
  };
  for (const chart of charts) recordChartTelemetry(acc, chart, forward);
  const n = charts.length;
  return {
    chartCount: n,
    totalVisibleTexels: acc.visible,
    globalDeltaRatio: acc.visible > 0 ? acc.delta / acc.visible : 0,
    craftedChartRatio: n > 0 ? acc.crafted / n : 0,
    weightedDistinctRoles: acc.visible > 0 ? acc.weightedRoles / acc.visible : 0,
    maxDistinctRoles: acc.maxDistinctRoles,
    aoTexelRatio: acc.visible > 0 ? acc.ao / acc.visible : 0,
    aoChartRatio: n > 0 ? acc.aoCharts / n : 0,
    bareChartIds: acc.bareChartIds.sort(compareText).slice(0, 6),
    grainModes: [...acc.grainSet].sort(compareText),
    tones: [...new Set(textures.map((t) => t.tone))].sort(compareText),
    hasProtectedFocalTexels: acc.hasProtected,
    avgForwardSymmetry: acc.symCount > 0 ? acc.symSum / acc.symCount : 0,
  };
};

const structuralGate = (
  profile: AssetQualityProfile,
  scene: AuditSceneGeometry,
  craft?: CraftFloorReport,
): AuditGateResult => {
  const parts = scene.obbs.length;
  const minOk =
    profile === 'creature'
      ? parts >= 6 && scene.boneCount >= 3
      : profile === 'prop'
        ? parts >= 3
        : parts >= 1;
  const minMsg =
    profile === 'creature'
      ? `creature requires >= 6 visible parts and >= 3 bones (got ${parts} parts, ${scene.boneCount} bones).`
      : profile === 'prop'
        ? `prop requires >= 3 visible parts (got ${parts}).`
        : `block requires >= 1 visible part (got ${parts}).`;
  const craftFail = minOk
    ? craft?.blockingFailures.find((c) => c.id !== 'craft.pbrHeadroom')
    : undefined;
  if (craftFail) {
    return {
      id: 'profile_structural_minimum',
      passed: false,
      message: `${craftFail.id}: ${craftFail.summary}`,
      targets: craftFail.targets,
      fix: craftFail.fix,
    };
  }
  return {
    id: 'profile_structural_minimum',
    passed: minOk,
    message: minOk ? `Meets structural minimum for ${profile} (${parts} parts).` : minMsg,
    targets: [],
    fix:
      profile === 'creature'
        ? 'Add hierarchical body/head/limb bones and >= 6 articulated visible parts.'
        : 'Add secondary structural parts to meet the profile minimum.',
  };
};

const preGrainGate = (
  telemetry: TelemetrySummary,
  telemetryAvailable: boolean,
  raster: AuditRasterStats,
  craft?: CraftFloorReport,
): AuditGateResult => {
  if (!telemetryAvailable) {
    const ok = raster.lumRange >= 0.06;
    return {
      id: 'pre_grain_authored_floor',
      passed: ok,
      message: ok
        ? 'Authored surface tonal floor satisfied (telemetry unavailable; checked raster spread).'
        : `Pre-grain telemetry unavailable and surface luminance range (${raster.lumRange.toFixed(3)}) is near flat.`,
      targets: [],
      fix: 'Author palette roles, gradients, borders, or AO patterns before grain/tone.',
    };
  }
  const ok = telemetry.globalDeltaRatio >= 0.05 && telemetry.maxDistinctRoles >= 2;
  const pbrFail = ok
    ? craft?.blockingFailures.find((c) => c.id === 'craft.pbrHeadroom')
    : undefined;
  if (pbrFail) {
    return {
      id: 'pre_grain_authored_floor',
      passed: false,
      message: `${pbrFail.id}: ${pbrFail.summary}`,
      targets: pbrFail.targets,
      fix: pbrFail.fix,
    };
  }
  return {
    id: 'pre_grain_authored_floor',
    passed: ok,
    message: ok
      ? `Pre-grain authored delta ${(telemetry.globalDeltaRatio * 100).toFixed(1)}% across ${telemetry.maxDistinctRoles}+ palette roles.`
      : `Bare fill detected: only ${(telemetry.globalDeltaRatio * 100).toFixed(1)}% pre-grain authored delta (min 5%) and max ${telemetry.maxDistinctRoles} roles/chart.`,
    targets: ok ? [] : telemetry.bareChartIds,
    fix: 'Add multi-role patterns (gradient, border, stripe, ao) or stamps on charts before grain.',
  };
};

const spatialGates = (scene: AuditSceneGeometry): readonly AuditGateResult[] => {
  const floating = findFloatingComponents(scene.obbs, 0.75);
  const buried = findBuriedCubes(scene.obbs);
  const hasVisible = scene.obbs.length >= 1 && scene.enabledFaces.length > 0;
  const grounded = hasVisible && scene.worldMin[1] >= -0.5 && scene.worldMin[1] <= 1.0;
  return [
    {
      id: 'visible_geometry',
      passed: hasVisible,
      message: hasVisible
        ? `${scene.obbs.length} visible primitives with ${scene.enabledFaces.length} enabled faces.`
        : 'Model has no visible cubes or planes with enabled faces.',
      targets: [],
      fix: 'Add at least one visible cube or plane component.',
    },
    {
      id: 'ground_contact',
      passed: grounded,
      message: grounded
        ? `Grounded at minY = ${scene.worldMin[1].toFixed(2)}.`
        : `Model rests at minY = ${scene.worldMin[1].toFixed(2)} (expected -0.5..1.0).`,
      targets: [],
      fix: 'Align lowest feet/base geometry to Y = 0.',
    },
    {
      id: 'no_disconnected_floating_parts',
      passed: floating.length === 0,
      message:
        floating.length === 0
          ? 'All visible parts form one connected volume within 0.75u.'
          : `${floating.length} floating part(s) detached by > 0.75u from main body.`,
      targets: floating.slice(0, 6),
      fix: 'Attach or socket-connect detached parts to the parent volume.',
    },
    {
      id: 'no_buried_hidden_cubes',
      passed: buried.length === 0,
      message:
        buried.length === 0
          ? 'No cube is completely enclosed inside an opaque cube.'
          : `${buried.length} cube(s) completely buried inside opaque geometry.`,
      targets: buried.slice(0, 6),
      fix: 'Remove or expose inner cubes completely hidden inside larger opaque cubes.',
    },
  ];
};

export const evaluateHardGates = (
  profile: AssetQualityProfile,
  scene: AuditSceneGeometry,
  raster: AuditRasterStats,
  telemetry: TelemetrySummary,
  telemetryAvailable: boolean,
  craft?: CraftFloorReport,
): readonly AuditGateResult[] => {
  const cleanNoise = raster.isolatedNoiseRate <= 0.2 && raster.checkerRate <= 0.18;
  return [
    ...spatialGates(scene),
    {
      id: 'texture_coverage_complete',
      passed: raster.allFacesCovered,
      message: raster.allFacesCovered
        ? 'All enabled faces map to valid opaque/masked texture regions.'
        : `${raster.missingFaceTargets.length} enabled face(s) lack valid texture coverage.`,
      targets: raster.missingFaceTargets,
      fix: 'Bind every enabled face to a surface texture with non-empty UV coordinates.',
    },
    preGrainGate(telemetry, telemetryAvailable, raster, craft),
    {
      id: 'anti_noise_coherence',
      passed: cleanNoise,
      message: cleanNoise
        ? `Noise ${(raster.isolatedNoiseRate * 100).toFixed(1)}% / checker ${(raster.checkerRate * 100).toFixed(1)}% within limits (<= 20% / 18%).`
        : `Excessive 1px noise or checkerboard (${(raster.isolatedNoiseRate * 100).toFixed(1)}% / ${(raster.checkerRate * 100).toFixed(1)}%).`,
      targets: cleanNoise ? [] : raster.noisyTextureIds,
      fix: 'Replace confetti noise and 1px checker dithering with cohesive organic gradients and clustered textures.',
    },
    structuralGate(profile, scene, craft),
  ];
};
