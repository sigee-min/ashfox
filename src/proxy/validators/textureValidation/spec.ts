import type { ApplyTextureSpecPayload, TextureSpec } from '../../../spec';
import type { Limits, ToolResponse } from '../../../types';
import { validateTextureSpecs } from '../../../domain/textureSpecValidation';
import { textureSpecMessages, validationOk, validatePayloadSchema } from '../common';
import { errFromDomain } from '../../response';
import { toolSchemas } from '../../../shared/mcpSchemas/toolSchemas';

export const validateTextureSpec = (
  payload: ApplyTextureSpecPayload,
  limits: Limits
): ToolResponse<void> => {
  const schemaErr = validatePayloadSchema('apply_texture_spec', payload, toolSchemas.apply_texture_spec);
  if (schemaErr) return schemaErr;
  const textureRes = validateTextureSpecs(payload.textures, limits, textureSpecMessages);
  if (!textureRes.ok) return errFromDomain(textureRes.error);
  return validationOk();
};

export const validateTextureSpecList = (
  textures: TextureSpec[],
  limits: Limits
): ToolResponse<void> => {
  const textureRes = validateTextureSpecs(textures, limits, textureSpecMessages);
  if (!textureRes.ok) return errFromDomain(textureRes.error);
  return validationOk();
};
