import type { ToolResponse } from '../../types';
import type { ModelSpec } from '../../spec';
import { errWithCode, err, errFromDomain } from '../response';
import { PAYLOAD_REQUIRED } from '../../shared/messages';
import {
  CUBE_FACE_DIRECTIONS,
  ENTITY_ANIMATION_CHANNELS,
  ENTITY_ANIMATION_TRIGGER_TYPES,
  ENTITY_FORMATS,
  GECKOLIB_TARGET_VERSIONS,
  PREVIEW_MODES
} from '../../shared/toolConstants';
import { TEXTURE_PRESET_NAME_SET } from '../../shared/texturePolicy';
import { buildModelSpecMessages, buildTextureSpecMessages, buildUvAssignmentMessages } from '../../shared/messages';
import { isRecord } from '../../domain/guards';
import { validateModelSpec } from '../../domain/modelSpecValidation';
import { validateSchema } from '../../shared/mcpSchemas/validation';
import { isSchemaValidated } from '../../shared/mcpSchemas/validationFlag';
import type { JsonSchema } from '../../shared/mcpSchemas/types';

export const ENTITY_FORMAT_SET = new Set<string>(ENTITY_FORMATS);
export const GECKOLIB_TARGET_VERSION_SET = new Set<string>(GECKOLIB_TARGET_VERSIONS);
export const ENTITY_ANIMATION_CHANNEL_SET = new Set<string>(ENTITY_ANIMATION_CHANNELS);
export const ENTITY_ANIMATION_TRIGGER_TYPE_SET = new Set<string>(ENTITY_ANIMATION_TRIGGER_TYPES);
export { TEXTURE_PRESET_NAME_SET };
export const PREVIEW_MODE_SET = new Set<string>(PREVIEW_MODES);
export const FACE_DIRECTION_SET = new Set<string>(CUBE_FACE_DIRECTIONS);

export const modelSpecMessages = buildModelSpecMessages();
export const textureSpecMessages = buildTextureSpecMessages();
export const uvAssignmentMessages = buildUvAssignmentMessages();

export const validationOk = (): ToolResponse<void> => ({ ok: true, data: undefined });

export const requirePayloadObject = (payload: unknown): ToolResponse<void> | null => {
  if (!payload || typeof payload !== 'object') return errWithCode('invalid_payload', PAYLOAD_REQUIRED);
  return null;
};

export const validatePayloadSchema = (
  tool: string,
  payload: unknown,
  schema: JsonSchema | null | undefined
): ToolResponse<void> | null => {
  if (!schema) return null;
  if (isSchemaValidated(payload)) return null;
  const result = validateSchema(schema, payload);
  if (result.ok) return null;
  return err('invalid_payload', result.message, {
    reason: 'schema_validation',
    path: result.path,
    rule: result.reason,
    ...(result.details ?? {}),
    tool
  });
};

export const isTriggerValue = (value: unknown): boolean => {
  if (typeof value === 'string') return true;
  if (Array.isArray(value)) return value.every((item) => typeof item === 'string');
  return isRecord(value);
};


export const validateModelSpecs = (
  models: ModelSpec[]
): ToolResponse<void> | null => {
  for (const model of models) {
    const modelRes = validateModelSpec(model, modelSpecMessages);
    if (!modelRes.ok) return errFromDomain(modelRes.error);
  }
  return null;
};

export const validatePlanOnlyConstraints = (
  payload: {
    planOnly?: boolean;
    ensureProject?: unknown;
    preview?: unknown;
    validate?: unknown;
    export?: unknown;
  },
  messages: { noEnsure: string; noExtras: string },
  options?: { includeExport?: boolean }
): ToolResponse<void> | null => {
  if (!payload.planOnly) return null;
  if (payload.ensureProject) {
    return errWithCode('invalid_payload', messages.noEnsure);
  }
  const hasExtras =
    Boolean(payload.preview) || Boolean(payload.validate) || (options?.includeExport ? Boolean(payload.export) : false);
  if (hasExtras) {
    return errWithCode('invalid_payload', messages.noExtras);
  }
  return null;
};
