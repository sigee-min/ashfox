import type { ToolError } from '../../types';
import type { ToolService } from '../../usecases/ToolService';
import type { TextureSpec } from '../../spec';
import { resolveTextureSpecSize } from './specSize';
import {
  TEXTURE_SIZE_MISMATCH_FIX,
  TEXTURE_SIZE_MISMATCH_MESSAGE
} from '../../shared/messages';

export const checkTextureSize = (args: {
  service: ToolService;
  texture: TextureSpec;
  label: string;
  expected?: { width?: number; height?: number };
}): ToolError | null => {
  const expected = args.expected ?? resolveTextureSpecSize(args.texture);
  const expectedWidth = Number(expected.width);
  const expectedHeight = Number(expected.height);
  if (!Number.isFinite(expectedWidth) || !Number.isFinite(expectedHeight) || expectedWidth <= 0 || expectedHeight <= 0) {
    return null;
  }
  const id = args.texture.id ?? args.texture.targetId;
  const name = args.texture.name ?? args.texture.targetName ?? args.label;
  const readRes = args.service.readTexture({ id, name });
  if (!readRes.ok) {
    return null;
  }
  const actualWidth = Number(readRes.value.width ?? 0);
  const actualHeight = Number(readRes.value.height ?? 0);
  if (!Number.isFinite(actualWidth) || !Number.isFinite(actualHeight) || actualWidth <= 0 || actualHeight <= 0) {
    return null;
  }
  if (actualWidth !== expectedWidth || actualHeight !== expectedHeight) {
    const resolution = args.service.getProjectTextureResolution();
    return {
      code: 'invalid_state',
      message: TEXTURE_SIZE_MISMATCH_MESSAGE(name, expectedWidth, expectedHeight, actualWidth, actualHeight),
      fix: TEXTURE_SIZE_MISMATCH_FIX,
      details: {
        expected: { width: expectedWidth, height: expectedHeight },
        actual: { width: actualWidth, height: actualHeight },
        textureResolution: resolution ?? undefined
      }
    };
  }
  return null;
};
