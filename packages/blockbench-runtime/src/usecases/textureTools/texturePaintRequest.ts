import type { PaintTexturePayload } from '@ashfox/blockbench-contracts/types/internal';
import { checkDimensions, mapDimensionError } from '../../domain/dimensions';
import { MAX_TEXTURE_OPS, isTextureOp, type TextureOpLike } from '../../domain/textureOps';
import type { UvPaintSpec } from '../../domain/uv/paintSpec';
import {
  DIMENSION_INTEGER_MESSAGE,
  DIMENSION_POSITIVE_MESSAGE,
  TEXTURE_OP_INVALID,
  TEXTURE_OPS_TOO_MANY,
  TEXTURE_PAINT_MODE_INVALID,
  TEXTURE_PAINT_NAME_REQUIRED,
  TEXTURE_PAINT_SIZE_EXCEEDS_MAX,
  TEXTURE_PAINT_SIZE_EXCEEDS_MAX_FIX,
  TEXTURE_PAINT_TARGET_REQUIRED,
} from '../../shared/messages';
import { ensureNonBlankString } from '../../shared/payloadValidation';
import { fail, ok, type UsecaseResult } from '../result';
import type { TextureToolContext } from './context';
import { uvPaintMessages } from './context';
import { validateUvPaintSpec } from '../../domain/uv/paintValidation';

export interface NormalizedTexturePaintRequest {
  readonly mode: 'create' | 'update';
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly maxSize: number;
  readonly uvPaintSpec?: UvPaintSpec;
  readonly ops: readonly TextureOpLike[];
}

export const normalizeTexturePaintRequest = (
  ctx: TextureToolContext,
  payload: PaintTexturePayload,
): UsecaseResult<NormalizedTexturePaintRequest> => {
  if (payload.mode && payload.mode !== 'create' && payload.mode !== 'update') {
    return fail({ code: 'invalid_payload', message: TEXTURE_PAINT_MODE_INVALID(payload.mode) });
  }
  const textError = [
    ensureNonBlankString(payload.name, 'name'),
    ensureNonBlankString(payload.targetId, 'targetId'),
    ensureNonBlankString(payload.targetName, 'targetName'),
  ].find((error) => error !== null);
  if (textError) return fail(textError);
  const mode = payload.mode ?? (payload.targetId || payload.targetName ? 'update' : 'create');
  if (mode === 'create' && !payload.name) {
    return fail({ code: 'invalid_payload', message: TEXTURE_PAINT_NAME_REQUIRED });
  }
  if (mode === 'update' && !payload.targetId && !payload.targetName) {
    return fail({ code: 'invalid_payload', message: TEXTURE_PAINT_TARGET_REQUIRED });
  }
  const label = payload.targetName ?? payload.targetId ?? payload.name ?? 'texture';
  const width = Number(payload.width);
  const height = Number(payload.height);
  const maxSize = ctx.capabilities.limits.maxTextureSize;
  const dimensions = checkDimensions(width, height, {
    requireInteger: true,
    maxSize,
  });
  if (!dimensions.ok) {
    const message = mapDimensionError(dimensions, {
      nonPositive: (axis) => DIMENSION_POSITIVE_MESSAGE(axis, axis),
      nonInteger: (axis) => DIMENSION_INTEGER_MESSAGE(axis, axis),
      exceedsMax: (limit) => TEXTURE_PAINT_SIZE_EXCEEDS_MAX(limit || maxSize),
    });
    return dimensions.reason === 'exceeds_max'
      ? fail({
          code: 'invalid_payload',
          message: message ?? TEXTURE_PAINT_SIZE_EXCEEDS_MAX(maxSize),
          fix: TEXTURE_PAINT_SIZE_EXCEEDS_MAX_FIX(maxSize),
          details: { width, height, maxSize },
        })
      : fail({
          code: 'invalid_payload',
          message: message ?? DIMENSION_POSITIVE_MESSAGE('width/height'),
        });
  }
  const uvPaintSpec = payload.uvPaint;
  if (uvPaintSpec) {
    const validation = validateUvPaintSpec(
      uvPaintSpec,
      ctx.capabilities.limits,
      label,
      uvPaintMessages,
    );
    if (!validation.ok) return fail(validation.error);
  }
  const ops = payload.ops ?? [];
  if (!Array.isArray(ops)) {
    return fail({ code: 'invalid_payload', message: TEXTURE_OP_INVALID(label) });
  }
  if (ops.length > MAX_TEXTURE_OPS) {
    return fail({ code: 'invalid_payload', message: TEXTURE_OPS_TOO_MANY(MAX_TEXTURE_OPS, label) });
  }
  for (let opIndex = 0; opIndex < ops.length; opIndex += 1) {
    if (!isTextureOp(ops[opIndex])) {
      return fail({
        code: 'invalid_payload',
        message: TEXTURE_OP_INVALID(label),
        details: { opIndex },
      });
    }
  }
  return ok({ mode, label, width, height, maxSize, uvPaintSpec, ops });
};
