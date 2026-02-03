import type { TexturePipelinePayload } from '../../../spec';
import type { Limits, ToolResponse } from '../../../types';
import { errFromDomain, errWithCode } from '../../response';
import {
  ASSIGN_ENTRY_REQUIRES_TEXTURE,
  PRESET_SIZE_EXCEEDS_MAX,
  PRESET_SIZE_INTEGER,
  PRESET_SIZE_POSITIVE,
  PRESET_UPDATE_REQUIRES_TARGET,
  TEXTURE_PLAN_ASSIGN_UV_CONFLICT,
  TEXTURE_PLAN_ONLY_FACE_PAINT,
  TEXTURE_PIPELINE_STEP_REQUIRED
} from '../../../shared/messages';
import { checkDimensions, mapDimensionError } from '../../../domain/dimensions';
import { validateUvAssignments } from '../../../domain/uv/assignments';
import { uvAssignmentMessages, validationOk, validatePayloadSchema } from '../common';
import { toolSchemas } from '../../../shared/mcpSchemas/toolSchemas';
import {
  validateFacePaintEntries,
  validateTextureCleanup,
  validateTexturePlan,
  validateTextureSpecList
} from '../textureValidation';

export const validateTexturePipeline = (payload: TexturePipelinePayload, limits: Limits): ToolResponse<void> => {
  const schemaErr = validatePayloadSchema('texture_pipeline', payload, toolSchemas.texture_pipeline);
  if (schemaErr) return schemaErr;
  const hasStep = Boolean(
    payload.plan ||
      (payload.assign && payload.assign.length > 0) ||
      payload.uv ||
      (payload.textures && payload.textures.length > 0) ||
      (payload.presets && payload.presets.length > 0) ||
      (payload.facePaint && payload.facePaint.length > 0) ||
      (payload.cleanup && Array.isArray(payload.cleanup.delete) && payload.cleanup.delete.length > 0) ||
      payload.preflight ||
      payload.preview
  );
  if (!hasStep) {
    return errWithCode('invalid_payload', TEXTURE_PIPELINE_STEP_REQUIRED);
  }

  if (payload.assign) {
    for (const entry of payload.assign) {
      if (!entry?.textureId && !entry?.textureName) {
        return errWithCode('invalid_payload', ASSIGN_ENTRY_REQUIRES_TEXTURE);
      }
    }
  }

  if (payload.plan) {
    const planRes = validateTexturePlan(payload.plan);
    if (!planRes.ok) return planRes;
    if (payload.assign && payload.assign.length > 0) {
      return errWithCode('invalid_payload', TEXTURE_PLAN_ASSIGN_UV_CONFLICT);
    }
    if (payload.uv) {
      return errWithCode('invalid_payload', TEXTURE_PLAN_ASSIGN_UV_CONFLICT);
    }
  }
  if (payload.planOnly && payload.facePaint && payload.facePaint.length > 0) {
    return errWithCode('invalid_payload', TEXTURE_PLAN_ONLY_FACE_PAINT);
  }

  if (payload.cleanup !== undefined) {
    const cleanupRes = validateTextureCleanup(payload.cleanup);
    if (!cleanupRes.ok) return cleanupRes;
  }

  if (payload.uv) {
    const assignmentsRes = validateUvAssignments(payload.uv.assignments, uvAssignmentMessages);
    if (!assignmentsRes.ok) return errFromDomain(assignmentsRes.error);
  }

  if (payload.textures) {
    const textureRes = validateTextureSpecList(payload.textures, limits);
    if (!textureRes.ok) return textureRes;
  }

  if (payload.presets) {
    for (const preset of payload.presets) {
      const width = Number(preset.width);
      const height = Number(preset.height);
      const dimCheck = checkDimensions(width, height, { requireInteger: true, maxSize: limits.maxTextureSize });
      const dimMessage = mapDimensionError(dimCheck, {
        nonPositive: (_axis) => PRESET_SIZE_POSITIVE,
        nonInteger: (_axis) => PRESET_SIZE_INTEGER,
        exceedsMax: (maxSize) => PRESET_SIZE_EXCEEDS_MAX(maxSize || limits.maxTextureSize)
      });
      if (dimMessage) {
        return errWithCode('invalid_payload', dimMessage);
      }
      if ((preset.mode ?? 'create') === 'update' && !preset.targetId && !preset.targetName) {
        return errWithCode('invalid_payload', PRESET_UPDATE_REQUIRES_TARGET(preset.preset));
      }
    }
  }

  if (payload.facePaint !== undefined) {
    const facePaintRes = validateFacePaintEntries(payload.facePaint);
    if (!facePaintRes.ok) return facePaintRes;
  }

  return validationOk();
};

