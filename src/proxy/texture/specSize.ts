import type { TextureSpec } from '../../spec';
import { normalizeTextureSpecSize } from '../../domain/textureSpecValidation';
import { buildTextureSpecSizeMessages } from '../../shared/messages';

export const textureSpecSizeMessages = buildTextureSpecSizeMessages();

export const resolveTextureSpecSize = (
  spec: TextureSpec,
  base?: { width?: number; height?: number }
): { width?: number; height?: number } => {
  const resolved = normalizeTextureSpecSize(spec, base, textureSpecSizeMessages);
  if (!resolved.ok) {
    return { width: undefined, height: undefined };
  }
  return { width: resolved.data.width, height: resolved.data.height };
};
