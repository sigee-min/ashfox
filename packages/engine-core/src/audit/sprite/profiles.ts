import { auditSubmetric, ramp } from '@ashfox/internal-contracts';
import type { SpriteNineSlice, SpriteProfile } from '../../project/sprite/contract';
import {
  canonicalRgbaBackingBuffer,
  type CanonicalTextureRaster,
} from '../../textures/textureRecipe/raster';
import type { AuditSubmetric } from '../contract';
import type { SpriteAuditGateResult, SpriteAuditInput } from './contract';
import type { SpriteRasterStats } from './stats';

const coverageBounds = (profile: SpriteProfile): readonly [number, number] => {
  if (profile === 'tile') return [0.99, 1.0];
  if (profile === 'ui_9slice') return [0.4, 1.0];
  if (profile === 'crosshair') return [0.04, 0.65];
  if (profile === 'decal') return [0.06, 0.9];
  return [0.14, 0.96];
};

export const isCoverageValid = (profile: SpriteProfile, ratio: number): boolean => {
  const [min, max] = coverageBounds(profile);
  return ratio >= min && ratio <= max;
};

export const computeNineSliceCenterStats = (
  raster: CanonicalTextureRaster,
  slice?: SpriteNineSlice,
): { readonly valid: boolean; readonly uniformity: number } => {
  const w = raster.width;
  const h = raster.height;
  const s = slice ?? {
    left: Math.max(2, Math.floor(w / 6)),
    right: Math.max(2, Math.floor(w / 6)),
    top: Math.max(2, Math.floor(h / 6)),
    bottom: Math.max(2, Math.floor(h / 6)),
  };
  if (s.left + s.right >= w || s.top + s.bottom >= h) return { valid: false, uniformity: 0 };
  const rgba = canonicalRgbaBackingBuffer(raster.rgba) ?? raster.rgba.copy();
  const colors = new Set<number>();
  let total = 0;
  let opaque = 0;
  for (let y = s.top; y < h - s.bottom; y += 1) {
    for (let x = s.left; x < w - s.right; x += 1) {
      total += 1;
      const o = (y * w + x) * 4;
      if (rgba[o + 3] === 0) continue;
      opaque += 1;
      colors.add((rgba[o]! << 16) | (rgba[o + 1]! << 8) | rgba[o + 2]!);
    }
  }
  const fillOk = opaque / Math.max(1, total) >= 0.8;
  const uniformity = fillOk ? 1 - ramp(colors.size, 6, 20) : 0;
  return { valid: fillOk && uniformity >= 0.45, uniformity };
};

const evaluateDecalGates = (s: SpriteRasterStats): readonly SpriteAuditGateResult[] => {
  const borderOk = s.borderAlphaCount === 0;
  const alphaOk = s.softAlphaCount > 0;
  return [
    {
      id: 'decal_no_border_clip',
      passed: borderOk,
      message: borderOk
        ? 'Decal border transparent (0 clipped edge pixels).'
        : `${s.borderAlphaCount} non-transparent pixels touch canvas border.`,
      fix: 'Keep decal silhouette >= 1px inside canvas bounds so edges never clip.',
    },
    {
      id: 'decal_soft_alpha',
      passed: alphaOk,
      message: alphaOk
        ? `Decal uses 8-bit soft alpha (${s.softAlphaCount} translucent pixels).`
        : 'Decal lacks 8-bit soft alpha falloff.',
      fix: 'Use feather or #rrggbbaa soft alpha falloff on decal edges.',
    },
  ];
};

const evaluateCrosshairGate = (s: SpriteRasterStats): readonly SpriteAuditGateResult[] => {
  const symOk = s.symmetryScore >= 0.78 && s.centerOffset <= 0.16 && s.lumP90 >= 0.5;
  return [
    {
      id: 'crosshair_symmetry',
      passed: symOk,
      message: symOk
        ? `Crosshair centered symmetry ${(s.symmetryScore * 100).toFixed(0)}%, peak lum ${s.lumP90.toFixed(2)}.`
        : `Crosshair failed symmetry/contrast (sym=${s.symmetryScore.toFixed(2)}, offset=${s.centerOffset.toFixed(2)}, peak=${s.lumP90.toFixed(2)}).`,
      fix: 'Use symmetric mirrored reticle arms around canvas center with high-contrast core.',
    },
  ];
};

export const evaluateProfileGates = (
  profile: SpriteProfile,
  sprite: SpriteAuditInput,
  s: SpriteRasterStats,
): readonly SpriteAuditGateResult[] => {
  if (profile === 'ui_9slice') {
    const ns = computeNineSliceCenterStats(sprite.raster, sprite.nineSlice);
    return [
      {
        id: 'nine_slice_margins',
        passed: ns.valid,
        message: ns.valid
          ? `Nine-slice center stretch clean (uniformity ${(ns.uniformity * 100).toFixed(0)}%).`
          : 'Nine-slice margins overlap or center stretch region is noisy/empty.',
        fix: 'Keep slice margins inside canvas with a clean uniform stretch center.',
      },
    ];
  }
  if (profile === 'crosshair') return evaluateCrosshairGate(s);
  if (profile === 'hud_bar') {
    const sepOk = s.frameFillSeparation >= 0.1;
    return [
      {
        id: 'hud_bar_separation',
        passed: sepOk,
        message: sepOk
          ? `HUD bar frame/fill separation ${s.frameFillSeparation.toFixed(3)} >= 0.100.`
          : `HUD bar frame/fill separation ${s.frameFillSeparation.toFixed(3)} below 0.100.`,
        fix: 'Separate outer frame material from inner fill bar with clear value/hue contrast.',
      },
    ];
  }
  return profile === 'decal' ? evaluateDecalGates(s) : [];
};

const edgeDefScore = (sprite: SpriteAuditInput, s: SpriteRasterStats): number => {
  const outline = sprite.telemetry.outlinePixels > 0 ? 0.65 : 0.25;
  const rim = sprite.telemetry.hasRimHighlight ? 0.2 : 0;
  return Math.min(1, outline + rim + 0.15 * (1 - ramp(s.strayPixelCount, 0, 3)));
};

const uiNineSliceMetrics = (
  sprite: SpriteAuditInput,
  s: SpriteRasterStats,
): readonly AuditSubmetric[] => {
  const ns = computeNineSliceCenterStats(sprite.raster, sprite.nineSlice);
  return [
    auditSubmetric(
      'sprite.coverage',
      'Panel Fill Mass',
      ramp(s.opaqueRatio, 0.4, 0.72),
      12,
      s.opaqueRatio,
      0.85,
      `opaque=${(s.opaqueRatio * 100).toFixed(0)}%`,
    ),
    auditSubmetric(
      'sprite.balance',
      'Nine-Slice Stretch Center',
      ns.uniformity,
      11,
      ns.uniformity,
      0.9,
      `uniformity=${ns.uniformity.toFixed(2)}`,
    ),
    auditSubmetric(
      'sprite.definition',
      'Frame & Rim Definition',
      Math.max(edgeDefScore(sprite, s), ramp(s.frameFillSeparation, 0.08, 0.25)),
      12,
      s.frameFillSeparation,
      0.2,
      `frameSep=${s.frameFillSeparation.toFixed(2)}`,
    ),
  ];
};

const crosshairMetrics = (
  sprite: SpriteAuditInput,
  s: SpriteRasterStats,
): readonly AuditSubmetric[] => [
  auditSubmetric(
    'sprite.coverage',
    'Reticle Mass',
    ramp(s.opaqueRatio, 0.04, 0.14) * (1 - 0.5 * ramp(s.opaqueRatio, 0.45, 0.7)),
    12,
    s.opaqueRatio,
    0.22,
    `opaque=${(s.opaqueRatio * 100).toFixed(0)}%`,
  ),
  auditSubmetric(
    'sprite.balance',
    'Centered Symmetry',
    s.symmetryScore * (1 - ramp(s.centerOffset, 0.05, 0.25)),
    11,
    s.symmetryScore,
    1.0,
    `sym=${s.symmetryScore.toFixed(2)}`,
  ),
  auditSubmetric(
    'sprite.definition',
    'Reticle Contrast & Rim',
    Math.max(edgeDefScore(sprite, s), ramp(s.lumRange, 0.22, 0.55)),
    12,
    sprite.telemetry.outlinePixels,
    12,
    `outline=${sprite.telemetry.outlinePixels}px`,
  ),
];

const hudBarMetrics = (
  sprite: SpriteAuditInput,
  s: SpriteRasterStats,
): readonly AuditSubmetric[] => [
  auditSubmetric(
    'sprite.coverage',
    'Bar Footprint',
    ramp(s.opaqueRatio, 0.16, 0.4) * (1 - 0.4 * ramp(s.opaqueRatio, 0.82, 0.98)),
    12,
    s.opaqueRatio,
    0.55,
    `opaque=${(s.opaqueRatio * 100).toFixed(0)}%`,
  ),
  auditSubmetric(
    'sprite.balance',
    'Frame/Fill Separation',
    ramp(s.frameFillSeparation, 0.08, 0.28) * (1 - ramp(s.centerOffset, 0.25, 0.75)),
    11,
    s.frameFillSeparation,
    0.25,
    `sep=${s.frameFillSeparation.toFixed(2)}`,
  ),
  auditSubmetric(
    'sprite.definition',
    'Bevel & Outline Read',
    edgeDefScore(sprite, s),
    12,
    sprite.telemetry.outlinePixels,
    12,
    `outline=${sprite.telemetry.outlinePixels}px`,
  ),
];

const decalMetrics = (s: SpriteRasterStats): readonly AuditSubmetric[] => {
  const softRatio = s.softAlphaCount / Math.max(1, s.opaqueCount);
  return [
    auditSubmetric(
      'sprite.coverage',
      'Decal Footprint',
      ramp(s.opaqueRatio, 0.08, 0.25) * (1 - 0.4 * ramp(s.opaqueRatio, 0.72, 0.92)),
      12,
      s.opaqueRatio,
      0.42,
      `opaque=${(s.opaqueRatio * 100).toFixed(0)}%`,
    ),
    auditSubmetric(
      'sprite.balance',
      'Zero-Clip Centering',
      (s.borderAlphaCount === 0 ? 1 : 0) * (1 - ramp(s.centerOffset, 0.25, 0.75)),
      11,
      s.borderAlphaCount,
      0,
      `borderClip=${s.borderAlphaCount}`,
    ),
    auditSubmetric(
      'sprite.definition',
      '8-Bit Soft Alpha Falloff',
      ramp(softRatio, 0.05, 0.35),
      12,
      softRatio,
      0.3,
      `soft=${(softRatio * 100).toFixed(0)}%`,
    ),
  ];
};

export const specialSilhouetteMetrics = (
  profile: SpriteProfile,
  sprite: SpriteAuditInput,
  s: SpriteRasterStats,
): readonly AuditSubmetric[] | null => {
  if (profile === 'ui_9slice') return uiNineSliceMetrics(sprite, s);
  if (profile === 'crosshair') return crosshairMetrics(sprite, s);
  if (profile === 'hud_bar') return hudBarMetrics(sprite, s);
  if (profile === 'decal') return decalMetrics(s);
  return null;
};
