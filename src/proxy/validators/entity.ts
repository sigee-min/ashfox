import type { EntityPipelinePayload } from '../../spec';
import type { Limits, ToolResponse } from '../../types';
import { errWithCode } from '../response';
import {
  ANIMATION_FPS_INVALID,
  ANIMATION_LENGTH_INVALID,
  ANIMATION_LOOP_INVALID,
  ANIMATION_MODE_INVALID,
  ANIMATION_NAME_REQUIRED,
  ANIMATIONS_MUST_BE_ARRAY,
  CHANNEL_BONE_REQUIRED,
  CHANNEL_KEYS_MUST_BE_ARRAY,
  CHANNEL_TYPE_INVALID,
  CHANNELS_MUST_BE_ARRAY,
  KEYFRAME_TIME_INVALID,
  MODEL_STAGES_CONFLICT,
  KEYFRAME_VALUE_INVALID,
  PLAN_ONLY_NO_ENSURE,
  PLAN_ONLY_NO_EXTRAS,
  TARGET_VERSION_ONLY_GECKOLIB,
  TEXTURE_PLAN_ONLY_FACE_PAINT,
  TRIGGER_KEYS_MUST_BE_ARRAY,
  TRIGGER_TIME_INVALID,
  TRIGGER_TYPE_INVALID,
  TRIGGER_VALUE_INVALID,
  TRIGGERS_MUST_BE_ARRAY
} from '../../shared/messages';
import {
  ENTITY_ANIMATION_CHANNEL_SET,
  ENTITY_ANIMATION_TRIGGER_TYPE_SET,
  isTriggerValue,
  validatePayloadSchema,
  validateModelSpecs,
  validatePlanOnlyConstraints,
  validationOk
} from './common';
import { toolSchemas } from '../../shared/mcpSchemas/toolSchemas';
import {
  validateFacePaintEntries,
  validateTextureCleanup,
  validateTexturePlan,
  validateTextureSpecList
} from './textureValidation';

export const validateEntityPipeline = (payload: EntityPipelinePayload, limits: Limits): ToolResponse<void> => {
  const schemaErr = validatePayloadSchema('entity_pipeline', payload, toolSchemas.entity_pipeline);
  if (schemaErr) return schemaErr;
  if (payload.format !== 'geckolib' && payload.targetVersion) {
    return errWithCode('invalid_payload', TARGET_VERSION_ONLY_GECKOLIB);
  }
  if (payload.model && payload.modelStages && payload.modelStages.length > 0) {
    return errWithCode('invalid_payload', MODEL_STAGES_CONFLICT);
  }
  if (payload.model) {
    const modelErr = validateModelSpecs([payload.model]);
    if (modelErr) return modelErr;
  }
  if (payload.modelStages && payload.modelStages.length > 0) {
    const models = payload.modelStages.map((stage) => stage.model);
    const modelErr = validateModelSpecs(models);
    if (modelErr) return modelErr;
  }
  const planOnlyErr = validatePlanOnlyConstraints(payload, {
    noEnsure: PLAN_ONLY_NO_ENSURE,
    noExtras: PLAN_ONLY_NO_EXTRAS
  });
  if (planOnlyErr) return planOnlyErr;
  if (payload.texturePlan !== undefined) {
    const planRes = validateTexturePlan(payload.texturePlan);
    if (!planRes.ok) return planRes;
  }
  if (payload.textures) {
    const texRes = validateTextureSpecList(payload.textures, limits);
    if (!texRes.ok) return texRes;
  }
  if (payload.cleanup !== undefined) {
    const cleanupRes = validateTextureCleanup(payload.cleanup);
    if (!cleanupRes.ok) return cleanupRes;
  }
  if (payload.planOnly && payload.facePaint && payload.facePaint.length > 0) {
    return errWithCode('invalid_payload', TEXTURE_PLAN_ONLY_FACE_PAINT);
  }
  if (payload.facePaint !== undefined) {
    const facePaintRes = validateFacePaintEntries(payload.facePaint);
    if (!facePaintRes.ok) return facePaintRes;
  }
  if (payload.animations) {
    if (!Array.isArray(payload.animations)) return errWithCode('invalid_payload', ANIMATIONS_MUST_BE_ARRAY);
    for (const anim of payload.animations) {
      if (!anim?.name) return errWithCode('invalid_payload', ANIMATION_NAME_REQUIRED);
      if (!Number.isFinite(anim.length) || anim.length <= 0) {
        return errWithCode('invalid_payload', ANIMATION_LENGTH_INVALID(anim.name));
      }
      if (typeof anim.loop !== 'boolean') {
        return errWithCode('invalid_payload', ANIMATION_LOOP_INVALID(anim.name));
      }
      if (anim.fps !== undefined && (!Number.isFinite(anim.fps) || anim.fps <= 0)) {
        return errWithCode('invalid_payload', ANIMATION_FPS_INVALID(anim.name));
      }
      if (anim.mode && !['create', 'update'].includes(anim.mode)) {
        return errWithCode('invalid_payload', ANIMATION_MODE_INVALID(anim.name));
      }
      if (anim.channels) {
        if (!Array.isArray(anim.channels)) {
          return errWithCode('invalid_payload', CHANNELS_MUST_BE_ARRAY(anim.name));
        }
        for (const channel of anim.channels) {
          if (!channel?.bone) return errWithCode('invalid_payload', CHANNEL_BONE_REQUIRED(anim.name));
          if (!ENTITY_ANIMATION_CHANNEL_SET.has(channel.channel)) {
            return errWithCode('invalid_payload', CHANNEL_TYPE_INVALID(anim.name));
          }
          if (!Array.isArray(channel.keys)) {
            return errWithCode('invalid_payload', CHANNEL_KEYS_MUST_BE_ARRAY(anim.name));
          }
          for (const key of channel.keys) {
            if (!Number.isFinite(key.time)) {
              return errWithCode('invalid_payload', KEYFRAME_TIME_INVALID(anim.name));
            }
            if (!Array.isArray(key.value) || key.value.length !== 3) {
              return errWithCode('invalid_payload', KEYFRAME_VALUE_INVALID(anim.name));
            }
          }
        }
      }
      if (anim.triggers) {
        if (!Array.isArray(anim.triggers)) {
          return errWithCode('invalid_payload', TRIGGERS_MUST_BE_ARRAY(anim.name));
        }
        for (const trigger of anim.triggers) {
          if (!ENTITY_ANIMATION_TRIGGER_TYPE_SET.has(trigger.type)) {
            return errWithCode('invalid_payload', TRIGGER_TYPE_INVALID(anim.name));
          }
          if (!Array.isArray(trigger.keys)) {
            return errWithCode('invalid_payload', TRIGGER_KEYS_MUST_BE_ARRAY(anim.name));
          }
          for (const key of trigger.keys) {
            if (!Number.isFinite(key.time)) {
              return errWithCode('invalid_payload', TRIGGER_TIME_INVALID(anim.name));
            }
            if (!isTriggerValue(key.value)) {
              return errWithCode('invalid_payload', TRIGGER_VALUE_INVALID(anim.name));
            }
          }
        }
      }
    }
  }
  return validationOk();
};
