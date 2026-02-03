import type { TexturePlanDetail } from '../../../spec';
import type { CubeStat, PlanLayout } from './types';
import { AUTO_PLAN_MAX_TEXTURES, MIN_RESOLUTION, PACK_EFFICIENCY, formatPpu } from './constants';
import { parseSquareResolution } from '../../../domain/textureResolution';

export const resolveDetail = (detail?: TexturePlanDetail): TexturePlanDetail => detail ?? 'medium';

export const resolvePadding = (padding?: number): number => {
  if (!Number.isFinite(padding)) return 0;
  return Math.max(0, Math.trunc(padding as number));
};

export const resolveAllowSplit = (
  allowSplit: boolean | undefined,
  flags: { singleTexture?: boolean; perTextureUvSize?: boolean },
  notes: string[]
): boolean => {
  if (flags.singleTexture) {
    notes.push('Active format requires a single texture; split disabled.');
    return false;
  }
  if (flags.perTextureUvSize) {
    notes.push('Active format uses per-texture UV sizes; split disabled.');
    return false;
  }
  return allowSplit !== false;
};

export const resolveMaxTextures = (
  maxTextures: number | undefined,
  allowSplit: boolean,
  notes: string[],
  defaultMaxTextures: number
): number => {
  const requested = Number.isFinite(maxTextures)
    ? Math.max(1, Math.trunc(maxTextures as number))
    : allowSplit
      ? Math.max(1, Math.trunc(defaultMaxTextures))
      : 1;
  if (!allowSplit) {
    if (requested > 1) {
      notes.push('maxTextures ignored because split is disabled.');
    }
    return 1;
  }
  if (requested > AUTO_PLAN_MAX_TEXTURES) {
    notes.push(`maxTextures capped at ${AUTO_PLAN_MAX_TEXTURES}.`);
    return AUTO_PLAN_MAX_TEXTURES;
  }
  return requested;
};

export const resolveFormatFlags = (
  formats: Array<{ format: string; flags?: { singleTexture?: boolean; perTextureUvSize?: boolean } }>,
  activeFormat?: string
): { singleTexture?: boolean; perTextureUvSize?: boolean } => {
  if (!activeFormat) return {};
  const entry = formats.find((format) => format.format === activeFormat);
  return entry?.flags ?? {};
};

export const resolveResolutionOverride = (
  resolution: { width?: number; height?: number } | undefined,
  maxSize: number,
  notes: string[]
): { width: number; height: number } | null => {
  const parsed = parseSquareResolution(resolution);
  if (!parsed) return null;
  const size = parsed.size;
  if (!parsed.isSquare) {
    notes.push(`Non-square resolution requested; using ${size}x${size}.`);
  }
  let clamped = Math.min(size, maxSize);
  if (clamped !== size) {
    notes.push(`Resolution clamped to max ${maxSize}.`);
  }
  if (clamped < MIN_RESOLUTION) {
    clamped = MIN_RESOLUTION;
    notes.push(`Resolution raised to minimum ${MIN_RESOLUTION}.`);
  }
  return { width: clamped, height: clamped };
};

export const resolveLayout = (args: {
  ppuTarget: number;
  stats: { totalArea: number; maxFaceWidth: number; maxFaceHeight: number; cubes: CubeStat[] };
  maxTextures: number;
  allowSplit: boolean;
  maxSize: number;
  override: { width: number; height: number } | null;
  notes: string[];
  cubeCount: number;
}): PlanLayout => {
  const { ppuTarget, stats, maxTextures, allowSplit, maxSize, override, notes, cubeCount } = args;
  let textureCount = 1;
  let resolution = override ? { ...override } : { width: MIN_RESOLUTION, height: MIN_RESOLUTION };

  if (override) {
    textureCount = allowSplit ? pickTextureCount(override, ppuTarget, stats, maxTextures) : 1;
  } else {
    textureCount = 1;
    for (let count = 1; count <= maxTextures; count += 1) {
      const required = computeRequiredResolution(ppuTarget, stats, count);
      const rounded = roundUpResolution(required);
      if (rounded <= maxSize) {
        textureCount = count;
        resolution = { width: rounded, height: rounded };
        break;
      }
    }
    if (resolution.width < MIN_RESOLUTION || resolution.height < MIN_RESOLUTION) {
      resolution = { width: MIN_RESOLUTION, height: MIN_RESOLUTION };
    }
    if (resolution.width > maxSize || resolution.height > maxSize) {
      resolution = { width: maxSize, height: maxSize };
      notes.push(`Resolution limited to max ${maxSize}.`);
      textureCount = maxTextures;
    }
  }

  if (textureCount > cubeCount) {
    const reduced = Math.max(1, cubeCount);
    if (reduced !== textureCount) {
      notes.push(`Texture count reduced to ${reduced} (not enough cubes to split).`);
      textureCount = reduced;
    }
  }

  if (textureCount > 1) {
    notes.push(`Split across ${textureCount} textures to preserve texel density.`);
  }

  const ppuMax = computePpuMax(resolution, stats, textureCount);
  const ppuUsed = Math.min(ppuTarget, ppuMax);
  if (ppuUsed + 1e-6 < ppuTarget) {
    notes.push(
      `Texel density reduced (target ${formatPpu(ppuTarget)}px/unit, used ${formatPpu(ppuUsed)}px/unit).`
    );
  }

  return { resolution, textureCount, ppuTarget, ppuUsed };
};

const pickTextureCount = (
  resolution: { width: number; height: number },
  ppuTarget: number,
  stats: { totalArea: number; maxFaceWidth: number; maxFaceHeight: number },
  maxTextures: number
): number => {
  for (let count = 1; count <= maxTextures; count += 1) {
    const ppuMax = computePpuMax(resolution, stats, count);
    if (ppuTarget <= ppuMax + 1e-6) {
      return count;
    }
  }
  return maxTextures;
};

const computeRequiredResolution = (
  ppuTarget: number,
  stats: { totalArea: number; maxFaceWidth: number; maxFaceHeight: number },
  textureCount: number
): number => {
  const area = stats.totalArea > 0 ? stats.totalArea * ppuTarget * ppuTarget : 0;
  const perTexture = textureCount > 0 ? area / textureCount : area;
  const areaSize = perTexture > 0 ? Math.sqrt(perTexture / PACK_EFFICIENCY) : MIN_RESOLUTION;
  const faceSize = Math.max(stats.maxFaceWidth * ppuTarget, stats.maxFaceHeight * ppuTarget, MIN_RESOLUTION);
  return Math.max(areaSize, faceSize);
};

const computePpuMax = (
  resolution: { width: number; height: number },
  stats: { totalArea: number; maxFaceWidth: number; maxFaceHeight: number },
  textureCount: number
): number => {
  const areaBound =
    stats.totalArea > 0
      ? Math.sqrt((resolution.width * resolution.height * textureCount * PACK_EFFICIENCY) / stats.totalArea)
      : Infinity;
  const widthBound = stats.maxFaceWidth > 0 ? resolution.width / stats.maxFaceWidth : Infinity;
  const heightBound = stats.maxFaceHeight > 0 ? resolution.height / stats.maxFaceHeight : Infinity;
  return Math.min(areaBound, widthBound, heightBound);
};

const roundUpResolution = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return MIN_RESOLUTION;
  if (value <= MIN_RESOLUTION) return MIN_RESOLUTION;
  return Math.ceil(value / 32) * 32;
};
