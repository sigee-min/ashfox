import type { SpriteProduct } from '../../compiler/sprite/contract';
import type { SpriteProfile } from '../../project/sprite/contract';
import { clamp01, ramp, round2, round4, type AuditSubmetric, type QualityGrade } from '../contract';
import {
  DEFAULT_SPRITE_THRESHOLD,
  type SpriteAuditDeduction,
  type SpriteAuditGateResult,
  type SpriteAuditOptions,
  type SpriteAuditPillarId,
  type SpriteAuditPillarReport,
  type SpriteAuditReport,
} from './contract';
import { analyzeSpriteRaster, type SpriteRasterStats } from './stats';

const gradeFor = (allGates: boolean, score: number, passed: boolean): QualityGrade => {
  if (!allGates || score < 50) return 'fail';
  if (!passed || score < DEFAULT_SPRITE_THRESHOLD) return 'needs_work';
  return score >= 85 ? 'excellent' : 'pass';
};

const sub = (
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
  score: round2(clamp01(ratio) * maxScore),
  maxScore,
  value: round4(value),
  target,
  detail,
});

const evaluateGates = (
  profile: SpriteProfile,
  s: SpriteRasterStats,
): readonly SpriteAuditGateResult[] => {
  const isTile = profile === 'tile';
  const coverageOk = isTile
    ? s.opaqueRatio >= 0.99
    : s.opaqueRatio >= 0.14 && s.opaqueRatio <= 0.96;
  const crushOk = s.darkCrushRate <= 0.14;
  const strayOk = isTile || s.strayPixelCount <= 2;
  const seamOk = !isTile || s.wrapSeamJump <= 0.08;
  const noiseOk = s.isolatedNoiseRate <= 0.28 && s.checkerRate <= 0.22;
  return [
    {
      id: 'non_empty_canvas',
      passed: coverageOk,
      message: coverageOk
        ? `Canvas coverage ${(s.opaqueRatio * 100).toFixed(1)}% fits ${profile}.`
        : `Canvas coverage ${(s.opaqueRatio * 100).toFixed(1)}% outside ${profile} bounds.`,
      fix: isTile ? 'Fill 100% of tile canvas.' : 'Keep item silhouette within 14%–96% of canvas.',
    },
    {
      id: 'no_crushed_blacks',
      passed: crushOk,
      message: crushOk
        ? `Crushed dark rate ${(s.darkCrushRate * 100).toFixed(1)}% <= 14%.`
        : `${(s.darkCrushRate * 100).toFixed(1)}% pixels fall below luminance 0.14.`,
      fix: 'Lift shadow stops and outlines above relative luminance 0.14.',
    },
    {
      id: 'no_stray_pixels',
      passed: strayOk,
      message: strayOk
        ? `${s.strayPixelCount} stray 1px pixels.`
        : `${s.strayPixelCount} disconnected 1px stray pixels.`,
      fix: 'Remove isolated 1px orphan pixels outside the main silhouette.',
    },
    {
      id: 'tile_seamless_wrap',
      passed: seamOk,
      message: seamOk
        ? `Wrap seam jump ${s.wrapSeamJump.toFixed(3)} <= 0.080.`
        : `Tile wrap seam jump ${s.wrapSeamJump.toFixed(3)} exceeds 0.080.`,
      fix: 'Use wrapping tile patterns (brick, plank, voronoi, blotch) under profile = tile.',
    },
    {
      id: 'anti_raw_noise',
      passed: noiseOk,
      message: noiseOk
        ? `Noise ${(s.isolatedNoiseRate * 100).toFixed(1)}% / checker ${(s.checkerRate * 100).toFixed(1)}% clean.`
        : `Excessive 1px noise (${(s.isolatedNoiseRate * 100).toFixed(1)}%) or checker (${(s.checkerRate * 100).toFixed(1)}%).`,
      fix: 'Replace single-pixel confetti with clustered/directional grain and coherent shading.',
    },
  ];
};

const edgeDefinitionScore = (
  isTile: boolean,
  sprite: SpriteProduct,
  s: SpriteRasterStats,
): number => {
  if (isTile)
    return ramp(sprite.telemetry.authoredPatternPixels / Math.max(1, s.opaqueCount), 0.2, 0.9);
  const outline = sprite.telemetry.outlinePixels > 0 ? 0.65 : 0.25;
  const rim = sprite.telemetry.hasRimHighlight ? 0.2 : 0;
  return Math.min(1, outline + rim + 0.15 * (1 - ramp(s.strayPixelCount, 0, 3)));
};

const ITEM_SILHOUETTE_FIXES = [
  'Adjust sprite scale/coverage to sit cleanly in canvas.',
  'Center silhouette mass near canvas midpoint.',
  'Add sel_out outline with optional innerRim.',
] as const;

const TILE_SILHOUETTE_FIXES = [
  'Adjust sprite scale/coverage to sit cleanly in canvas.',
  'Use seamless wrapping tile patterns.',
  'Add structured brick/plank/voronoi/blotch layers.',
] as const;

const COLOR_FIXES = [
  'Widen ramp contrast while keeping shadow luma >= 0.14.',
  'Orient light from top_left/top for clear upper-vs-lower value read.',
  'Use auto OKLCH hue-shifted ramps and multiple materials.',
  'Keep cohesive palette ramps (6–24 distinct colors).',
] as const;

const silhouetteMetrics = (
  isTile: boolean,
  sprite: SpriteProduct,
  s: SpriteRasterStats,
): readonly AuditSubmetric[] => {
  const fillScore = isTile
    ? ramp(s.opaqueRatio, 0.9, 1.0)
    : ramp(s.opaqueRatio, 0.14, 0.25) * (1 - 0.5 * ramp(s.opaqueRatio, 0.78, 0.98));
  const balanceScore = isTile
    ? 1 - ramp(s.wrapSeamJump, 0.02, 0.09)
    : 1 - ramp(s.centerOffset, 0.25, 0.75);
  const edgeScore = edgeDefinitionScore(isTile, sprite, s);
  return [
    sub(
      'sprite.coverage',
      isTile ? 'Tile Fill Completeness' : 'Silhouette Mass',
      fillScore,
      12,
      s.opaqueRatio,
      isTile ? 1 : 0.45,
      `opaque=${(s.opaqueRatio * 100).toFixed(0)}%`,
    ),
    sub(
      'sprite.balance',
      isTile ? 'Seamless Edge Continuity' : 'Canvas Centering',
      balanceScore,
      11,
      isTile ? s.wrapSeamJump : s.centerOffset,
      0,
      isTile ? `seam=${s.wrapSeamJump.toFixed(3)}` : `offset=${s.centerOffset.toFixed(2)}`,
    ),
    sub(
      'sprite.definition',
      isTile ? 'Pattern Structure' : 'Outline & Rim Definition',
      edgeScore,
      12,
      sprite.telemetry.outlinePixels,
      12,
      `outline=${sprite.telemetry.outlinePixels}px`,
    ),
  ];
};

const evaluateSilhouettePillar = (
  profile: SpriteProfile,
  sprite: SpriteProduct,
  s: SpriteRasterStats,
): {
  readonly pillar: SpriteAuditPillarReport;
  readonly deductions: readonly SpriteAuditDeduction[];
} => {
  const isTile = profile === 'tile';
  const metrics = silhouetteMetrics(isTile, sprite, s);
  const score = round2(metrics.reduce((sum, m) => sum + m.score, 0));
  return {
    pillar: {
      id: 'silhouette',
      label: isTile ? 'Tile Framing & Seam' : 'Silhouette & Framing',
      score,
      maxScore: 35,
      metrics,
    },
    deductions: buildDeductions(
      'silhouette',
      metrics,
      isTile ? TILE_SILHOUETTE_FIXES : ITEM_SILHOUETTE_FIXES,
    ),
  };
};

const evaluateColorPillar = (
  sprite: SpriteProduct,
  s: SpriteRasterStats,
): {
  readonly pillar: SpriteAuditPillarReport;
  readonly deductions: readonly SpriteAuditDeduction[];
} => {
  const lumRatio = ramp(s.lumRange, 0.14, 0.48) * (1 - 0.8 * ramp(s.darkCrushRate, 0.04, 0.18));
  const hierarchyRatio =
    sprite.profile === 'tile'
      ? ramp(s.lumP90 - s.lumP10, 0.08, 0.3)
      : 0.6 * ramp(s.topBottomContrast, 0.01, 0.12) + 0.4 * ramp(s.lumP90, 0.35, 0.72);
  const hueRatio =
    0.55 * ramp(s.hueShiftDegrees, 4, 28) + 0.45 * ramp(sprite.telemetry.materialCount, 1, 3);
  const economyRatio = ramp(s.uniqueColors, 4, 10) * (1 - 0.6 * ramp(s.uniqueColors, 26, 48));
  const metrics = [
    sub(
      'sprite.lumRange',
      'Luminance Contrast & Safe Darks',
      lumRatio,
      10,
      s.lumRange,
      0.4,
      `range=${s.lumRange.toFixed(2)}`,
    ),
    sub(
      'sprite.hierarchy',
      'Value Hierarchy',
      hierarchyRatio,
      9,
      s.topBottomContrast,
      0.08,
      `topBot=${s.topBottomContrast.toFixed(2)}`,
    ),
    sub(
      'sprite.hueShift',
      'OKLCH Hue Shift & Material Depth',
      hueRatio,
      9,
      s.hueShiftDegrees,
      18,
      `hueShift=${s.hueShiftDegrees.toFixed(1)}deg`,
    ),
    sub(
      'sprite.paletteEconomy',
      'Palette Discipline',
      economyRatio,
      7,
      s.uniqueColors,
      12,
      `colors=${s.uniqueColors}`,
    ),
  ];
  const score = round2(metrics.reduce((sum, m) => sum + m.score, 0));
  return {
    pillar: { id: 'color', label: 'Color, Value & Hue Shift', score, maxScore: 35, metrics },
    deductions: buildDeductions('color', metrics, COLOR_FIXES),
  };
};

const evaluateSurfacePillar = (
  sprite: SpriteProduct,
  s: SpriteRasterStats,
): {
  readonly pillar: SpriteAuditPillarReport;
  readonly deductions: readonly SpriteAuditDeduction[];
} => {
  const coherence =
    (1 - ramp(s.isolatedNoiseRate, 0.03, 0.22)) * (1 - ramp(s.checkerRate, 0.03, 0.18));
  const patternRatio = ramp(
    sprite.telemetry.authoredPatternPixels / Math.max(1, s.opaqueCount),
    0.1,
    0.65,
  );
  const craftRatio =
    sprite.profile === 'tile'
      ? 0.5 * ramp(sprite.telemetry.layerCount, 1, 4) + 0.5 * patternRatio
      : 0.5 * ramp(sprite.telemetry.layerCount, 2, 5) +
        0.5 * Math.max(patternRatio, ramp(sprite.telemetry.materialCount, 2, 3));
  const resFactor = sprite.raster.width >= 32 ? 1.0 : 0.85;
  const metrics = [
    sub(
      'sprite.coherence',
      'Cluster Coherence',
      coherence,
      14,
      1 - s.isolatedNoiseRate,
      0.96,
      `noise=${s.isolatedNoiseRate.toFixed(2)}`,
    ),
    sub(
      'sprite.craft',
      'Layer & Pattern Craft',
      craftRatio * resFactor,
      16,
      sprite.telemetry.layerCount,
      4,
      `layers=${sprite.telemetry.layerCount}, w=${sprite.raster.width}`,
    ),
  ];
  const score = round2(metrics.reduce((sum, m) => sum + m.score, 0));
  return {
    pillar: { id: 'surface', label: 'Surface & Pixel Craft', score, maxScore: 30, metrics },
    deductions: buildDeductions('surface', metrics, [
      'Use clustered or directional grain instead of raw 1px noise.',
      'Combine layered shapes/parts, patterns, and 32x32 canvas detail.',
    ]),
  };
};

const buildDeductions = (
  pillar: SpriteAuditPillarId,
  metrics: readonly AuditSubmetric[],
  fixes: readonly string[],
): readonly SpriteAuditDeduction[] =>
  metrics.flatMap((m, i) => {
    const lost = round2(m.maxScore - m.score);
    return lost < 0.5
      ? []
      : [
          {
            metricId: m.id,
            pillar,
            lostPoints: lost,
            summary: `${m.label} (${m.detail})`,
            fix: fixes[i]!,
          },
        ];
  });

/** Evaluate pure-CPU visual craft quality for a compiled Sprite v2 product. */
export const evaluateSpriteQuality = (
  sprite: SpriteProduct,
  options: SpriteAuditOptions = {},
): SpriteAuditReport => {
  const profile = options.profile ?? sprite.profile;
  const profileSource = options.profile !== undefined ? 'override' : 'authored';
  const threshold = options.threshold ?? DEFAULT_SPRITE_THRESHOLD;
  const stats = analyzeSpriteRaster(sprite);
  const hardGates = evaluateGates(profile, stats);
  const sil = evaluateSilhouettePillar(profile, sprite, stats);
  const col = evaluateColorPillar(sprite, stats);
  const surf = evaluateSurfacePillar(sprite, stats);
  const score = Math.max(
    0,
    Math.min(100, Math.round(sil.pillar.score + col.pillar.score + surf.pillar.score)),
  );
  const allGates = hardGates.every((g) => g.passed);
  const passed = allGates && score >= threshold;
  const gateDeductions: SpriteAuditDeduction[] = hardGates
    .filter((g) => !g.passed)
    .map((g) => ({
      metricId: `gate.${g.id}`,
      pillar: 'gate',
      lostPoints: 100,
      summary: g.message,
      fix: g.fix,
    }));
  const sorted = [...sil.deductions, ...col.deductions, ...surf.deductions].sort(
    (a, b) => b.lostPoints - a.lostPoints || a.metricId.localeCompare(b.metricId),
  );
  return Object.freeze({
    schemaVersion: 1 as const,
    profile,
    profileSource,
    threshold,
    passed,
    score,
    grade: gradeFor(allGates, score, passed),
    hardGates,
    pillars: [sil.pillar, col.pillar, surf.pillar],
    topDeductions: [...gateDeductions, ...sorted].slice(0, 5),
  });
};

export const formatSpriteGateFailure = (name: string, report: SpriteAuditReport): string => {
  const failedGates = report.hardGates.filter((g) => !g.passed).map((g) => g.id);
  const topFixes = report.topDeductions
    .slice(0, 3)
    .map((d) => `${d.metricId}: ${d.summary} -> ${d.fix}`)
    .join(' | ');
  const gateText = failedGates.length > 0 ? ` failedGates=[${failedGates.join(', ')}]` : '';
  return `Sprite "${name}" failed quality gate (${report.score}/${report.threshold}, ${report.grade})${gateText}. ${topFixes}`;
};
