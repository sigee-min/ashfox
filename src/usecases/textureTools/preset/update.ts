import type { GenerateTexturePresetPayload } from '../../../types';
import type { UsecaseResult } from '../../result';
import type { TextureToolContext } from '../context';
import type { TexturePresetContext } from './types';

export const upsertTextureFromPreset = (
  ctx: TextureToolContext,
  payload: GenerateTexturePresetPayload,
  context: TexturePresetContext,
  image: CanvasImageSource
): UsecaseResult<{ id: string; name: string }> => {
  return context.mode === 'update'
    ? ctx.updateTexture({
        id: context.target?.id,
        name: context.target?.name,
        newName: payload.name,
        image,
        width: context.width,
        height: context.height,
        ifRevision: payload.ifRevision
      })
    : ctx.importTexture({
        name: payload.name!,
        image,
        width: context.width,
        height: context.height,
        ifRevision: payload.ifRevision
      });
};
