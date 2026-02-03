import type { ToolError } from '../../types';
import { ensureNonBlankString } from '../../shared/payloadValidation';

export const ensureTextureSelector = (textureId?: string, textureName?: string): ToolError | null => {
  const idBlankErr = ensureNonBlankString(textureId, 'textureId');
  if (idBlankErr) return idBlankErr;
  const nameBlankErr = ensureNonBlankString(textureName, 'textureName');
  if (nameBlankErr) return nameBlankErr;
  return null;
};
