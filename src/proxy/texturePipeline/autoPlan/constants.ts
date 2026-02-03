import {
  AUTO_PLAN_DEFAULT_MAX_TEXTURES,
  AUTO_PLAN_MAX_RESOLUTION,
  AUTO_PLAN_MAX_TEXTURES
} from '../../../shared/texturePolicy';

export const DETAIL_PIXELS_PER_BLOCK = {
  low: 16,
  medium: 32,
  high: 64
} as const;

export const MIN_RESOLUTION = 16;
export const PACK_EFFICIENCY = 0.75;
export const ATLAS_RETRY_LIMIT = 3;
export { AUTO_PLAN_DEFAULT_MAX_TEXTURES, AUTO_PLAN_MAX_RESOLUTION, AUTO_PLAN_MAX_TEXTURES };

export const resolvePlanMaxSize = (maxSize: number): number => Math.min(maxSize, AUTO_PLAN_MAX_RESOLUTION);

export const formatPpu = (value: number): string => {
  if (!Number.isFinite(value)) return '?';
  return Math.round(value * 100) / 100 + '';
};
