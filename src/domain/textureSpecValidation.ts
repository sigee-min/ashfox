import type { Limits } from './model';
import type { DomainResult } from './result';
import { fail, ok } from './result';
import { checkDimensions, mapDimensionError } from './dimensions';
import type { UvPaintMessages } from './uv/paintTypes';
import { validateUvPaintSpec } from './uv/paintValidation';
import { isTextureOp, MAX_TEXTURE_OPS } from './textureOps';

export type TextureSpecSizeMessages = {
  dimensionPositive: (axis: string, label: string) => string;
};

export type TextureSpecMessages = TextureSpecSizeMessages & {
  specsRequired: string;
  modeUnsupported: (mode: string, label: string) => string;
  nameRequired: (label: string) => string;
  targetRequired: (label: string) => string;
  detectNoChangeUpdateOnly: (label: string) => string;
  detectNoChangeRequiresExisting: (label: string) => string;
  sizeExceedsMax: (maxSize: number, label: string) => string;
  opsTooMany: (maxOps: number, label: string) => string;
  opInvalid: (label: string) => string;
  uvPaint: UvPaintMessages;
};

export type TextureSpecLike = {
  mode?: 'create' | 'update';
  id?: string;
  targetId?: string;
  targetName?: string;
  name?: string;
  width?: number;
  height?: number;
  useExisting?: boolean;
  uvPaint?: unknown;
  ops?: unknown[];
  detectNoChange?: boolean;
};

export type TextureSpecWithSize = TextureSpecLike & {
  width: number;
  height: number;
};

export const normalizeTextureSpecSize = (
  spec: TextureSpecLike,
  fallback: { width?: number; height?: number } | undefined,
  messages: TextureSpecSizeMessages
): DomainResult<TextureSpecWithSize> => {
  const width = pickFinite(spec.width, fallback?.width);
  const height = pickFinite(spec.height, fallback?.height);
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
    return fail('invalid_payload', messages.dimensionPositive('width', specLabel(spec)));
  }
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    return fail('invalid_payload', messages.dimensionPositive('height', specLabel(spec)));
  }
  return ok({ ...spec, width, height });
};

export const validateTextureSpecs = (
  textures: TextureSpecLike[],
  limits: Limits,
  messages: TextureSpecMessages
): DomainResult<{ valid: true }> => {
  if (!Array.isArray(textures) || textures.length === 0) {
    return fail('invalid_payload', messages.specsRequired);
  }
  for (const tex of textures) {
    const label = tex?.name ?? tex?.targetName ?? tex?.targetId ?? 'texture';
    const mode = tex?.mode ?? 'create';
    if (mode !== 'create' && mode !== 'update') {
      return fail('invalid_payload', messages.modeUnsupported(mode, label));
    }
    if (mode === 'create' && !tex?.name) {
      return fail('invalid_payload', messages.nameRequired(label));
    }
    if (mode === 'update' && !tex?.targetId && !tex?.targetName) {
      return fail('invalid_payload', messages.targetRequired(label));
    }
    if (mode === 'create' && tex?.detectNoChange) {
      return fail('invalid_payload', messages.detectNoChangeUpdateOnly(label));
    }
    if (tex?.detectNoChange && !tex?.useExisting) {
      return fail('invalid_payload', messages.detectNoChangeRequiresExisting(label));
    }
    const sizeRes = normalizeTextureSpecSize(tex, undefined, messages);
    if (!sizeRes.ok) return sizeRes;
    const width = Number(sizeRes.data.width);
    const height = Number(sizeRes.data.height);
    const sizeCheck = checkDimensions(width, height, { requireInteger: false, maxSize: limits.maxTextureSize });
    const sizeMessage = mapDimensionError(sizeCheck, {
      nonPositive: (axis) => messages.dimensionPositive(axis, label),
      nonInteger: (axis) => messages.dimensionPositive(axis, label),
      exceedsMax: (maxSize) => messages.sizeExceedsMax(maxSize || limits.maxTextureSize, label)
    });
    if (sizeMessage) {
      return fail('invalid_payload', sizeMessage);
    }
    const ops = Array.isArray(tex?.ops) ? tex.ops : [];
    if (ops.length > MAX_TEXTURE_OPS) {
      return fail('invalid_payload', messages.opsTooMany(MAX_TEXTURE_OPS, label));
    }
    for (const op of ops) {
      if (!isTextureOp(op)) {
        return fail('invalid_payload', messages.opInvalid(label));
      }
    }
    if (tex?.uvPaint !== undefined) {
      const uvPaintRes = validateUvPaintSpec(tex.uvPaint, limits, label, messages.uvPaint);
      if (!uvPaintRes.ok) return uvPaintRes as DomainResult<{ valid: true }>;
    }
  }
  return ok({ valid: true });
};

const specLabel = (spec: TextureSpecLike): string =>
  spec?.name ?? spec?.targetName ?? spec?.targetId ?? 'texture';

const pickFinite = (...values: Array<number | undefined>) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
};



