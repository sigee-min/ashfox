import type { ToolError } from '@ashfox/blockbench-contracts/types/internal';
import { ensureNonBlankString } from '../../shared/payloadValidation';

/** Validate the optional ID/name selector accepted by texture reads. */
export const ensureTextureSelector = (
  textureId?: string,
  textureName?: string,
): ToolError | null => {
  const idBlankErr = ensureNonBlankString(textureId, 'textureId');
  if (idBlankErr) return idBlankErr;
  const nameBlankErr = ensureNonBlankString(textureName, 'textureName');
  if (nameBlankErr) return nameBlankErr;
  return null;
};
