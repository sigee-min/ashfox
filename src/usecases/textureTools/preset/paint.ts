import { applyUvPaintPixels } from '../../../domain/uv/paintPixels';
import { computeCoverage } from '../../../domain/texturePresets';
import { TEXTURE_RENDERER_NO_IMAGE } from '../../../shared/messages';
import { fail, ok, type UsecaseResult } from '../../result';
import type { TextureToolContext } from '../context';
import { uvPaintPixelMessages } from '../context';
import type { TexturePresetContext } from './types';

export const buildPaintedTexture = (
  ctx: TextureToolContext,
  context: TexturePresetContext
): UsecaseResult<{ image: CanvasImageSource; coverage: ReturnType<typeof computeCoverage> }> => {
  const padding = context.uvPaintSpec.padding ?? 0;
  const anchor = context.uvPaintSpec.anchor ?? [0, 0];
  const paintRes = applyUvPaintPixels({
    source: { width: context.preset.width, height: context.preset.height, data: context.preset.data },
    target: { width: context.width, height: context.height },
    config: {
      rects: context.rects,
      mapping: context.uvPaintSpec.mapping ?? 'stretch',
      padding,
      anchor
    },
    label: context.label,
    messages: uvPaintPixelMessages
  });
  if (!paintRes.ok) return fail(paintRes.error);
  const coverage = computeCoverage(paintRes.data.data, context.width, context.height);
  const renderRes = ctx.textureRenderer?.renderPixels({
    width: context.width,
    height: context.height,
    data: paintRes.data.data
  });
  if (renderRes?.error) return fail(renderRes.error);
  if (!renderRes?.result) {
    return fail({ code: 'not_implemented', message: TEXTURE_RENDERER_NO_IMAGE });
  }
  return ok({ image: renderRes.result.image, coverage });
};

