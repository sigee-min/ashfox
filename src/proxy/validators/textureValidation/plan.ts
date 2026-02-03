import { TEXTURE_PLAN_INVALID, TEXTURE_PLAN_MAX_TEXTURES_INVALID, TEXTURE_PLAN_PAINT_INVALID, TEXTURE_PLAN_RESOLUTION_INVALID } from '../../../shared/messages';
import { isRecord } from '../../../domain/guards';
import { validationOk } from '../common';
import { errWithCode } from '../../response';
import type { ToolResponse } from '../../../types';

export const validateTexturePlan = (plan: unknown): ToolResponse<void> => {
  if (!isRecord(plan)) {
    return errWithCode('invalid_payload', TEXTURE_PLAN_INVALID);
  }
  if (plan.maxTextures !== undefined) {
    const maxTextures = Number(plan.maxTextures);
    if (!Number.isFinite(maxTextures) || maxTextures <= 0 || Math.floor(maxTextures) !== maxTextures) {
      return errWithCode('invalid_payload', TEXTURE_PLAN_MAX_TEXTURES_INVALID);
    }
  }
  if (plan.resolution !== undefined) {
    if (!isRecord(plan.resolution)) {
      return errWithCode('invalid_payload', TEXTURE_PLAN_RESOLUTION_INVALID);
    }
    const width = plan.resolution.width;
    const height = plan.resolution.height;
    const widthOk = width === undefined || (typeof width === 'number' && Number.isFinite(width) && width > 0);
    const heightOk = height === undefined || (typeof height === 'number' && Number.isFinite(height) && height > 0);
    if (!widthOk || !heightOk || (width === undefined && height === undefined)) {
      return errWithCode('invalid_payload', TEXTURE_PLAN_RESOLUTION_INVALID);
    }
  }
  if (plan.paint !== undefined) {
    if (!isRecord(plan.paint)) {
      return errWithCode('invalid_payload', TEXTURE_PLAN_PAINT_INVALID);
    }
  }
  return validationOk();
};
