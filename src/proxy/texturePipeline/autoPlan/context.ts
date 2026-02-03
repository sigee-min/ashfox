import type { Cube } from '../../../domain/model';
import type { UvPolicyConfig } from '../../../domain/uv/policy';
import type { TexturePipelinePlan } from '../../../spec';
import { AUTO_PLAN_DEFAULT_MAX_TEXTURES, DETAIL_PIXELS_PER_BLOCK, resolvePlanMaxSize } from './constants';
import {
  resolveAllowSplit,
  resolveDetail,
  resolveFormatFlags,
  resolveLayout,
  resolveMaxTextures,
  resolvePadding,
  resolveResolutionOverride
} from './layout';
import { resolveTextureNames, splitTextureGroups } from './naming';
import { collectCubeStats } from './stats';
import type { AutoPlanContext } from './types';

export const buildAutoPlanContext = (args: {
  plan: TexturePipelinePlan;
  cubes: Cube[];
  textures: Array<{ name: string }>;
  caps: {
    limits: { maxTextureSize: number };
    formats: Array<{ format: string; flags?: { singleTexture?: boolean; perTextureUvSize?: boolean } }>;
  };
  policy: UvPolicyConfig;
  format?: string;
  reuseExistingTextures?: boolean;
  notes: string[];
}): AutoPlanContext => {
  const { plan, cubes, textures, caps, policy, format, reuseExistingTextures, notes } = args;
  const detail = resolveDetail(plan.detail);
  const padding = resolvePadding(plan.padding);
  const maxSize = resolvePlanMaxSize(caps.limits.maxTextureSize);
  const formatFlags = resolveFormatFlags(caps.formats, format);
  const allowSplit = resolveAllowSplit(plan.allowSplit, formatFlags, notes);
  const maxTextures = resolveMaxTextures(plan.maxTextures, allowSplit, notes, AUTO_PLAN_DEFAULT_MAX_TEXTURES);
  const stats = collectCubeStats(cubes);

  const basePixelsPerBlock = DETAIL_PIXELS_PER_BLOCK[detail];
  const ppuTarget = basePixelsPerBlock / Math.max(1, policy.modelUnitsPerBlock);
  const resolutionOverride = resolveResolutionOverride(plan.resolution, maxSize, notes);
  const layout = resolveLayout({
    ppuTarget,
    stats,
    maxTextures,
    allowSplit,
    maxSize,
    override: resolutionOverride,
    notes,
    cubeCount: stats.cubes.length
  });
  const denseCubeThreshold = 20;
  const smallResolution = 32;
  if (layout.resolution.width <= smallResolution && stats.cubes.length >= denseCubeThreshold) {
    notes.push(
      `High cube count (${stats.cubes.length}) with ${layout.resolution.width}x${layout.resolution.height} can trigger uv_scale_mismatch. ` +
        'Consider 64x64+, allowSplit, or fewer cubes.'
    );
  }

  const existingNames = new Set(textures.map((tex) => tex.name));
  const textureNames = resolveTextureNames(plan.name ?? 'texture', layout.textureCount, new Set(existingNames), notes, {
    preferBaseName: reuseExistingTextures === true,
    reuseExisting: reuseExistingTextures === true
  });
  const groups = splitTextureGroups(stats.cubes, textureNames);

  return {
    detail,
    padding,
    maxSize,
    formatFlags,
    allowSplit,
    maxTextures,
    stats,
    ppuTarget,
    resolutionOverride,
    layout,
    existingNames,
    textureNames,
    groups
  };
};

