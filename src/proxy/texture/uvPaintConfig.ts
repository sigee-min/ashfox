import type { Limits, ToolError } from '../../types';
import type { TextureSpec } from '../../spec';
import type { TextureUsage } from '../../domain/model';
import { resolveUvPaintRects } from '../../domain/uv/paint';
import { validateUvPaintSourceSize } from '../../domain/uv/paintSource';
import { buildUvPaintMessages, buildUvPaintSourceMessages } from '../../shared/messages';
import { UV_PAINT_MAPPING_REQUIRED } from '../../shared/messages';
import type { UvPaintRenderConfig } from './textureRender';

const uvPaintMessages = buildUvPaintMessages();
const uvPaintSourceMessages = buildUvPaintSourceMessages();

export const buildUvPaintConfig = (args: {
  texture: TextureSpec;
  limits: Limits;
  usage?: TextureUsage;
  size: { width?: number; height?: number };
}): { ok: true; config?: UvPaintRenderConfig; uvPaintApplied: boolean } | { ok: false; error: ToolError } => {
  const ops = Array.isArray(args.texture.ops) ? args.texture.ops : [];
  const hasPaint = ops.length > 0 || Boolean(args.texture.background);
  const uvPaintSpec = hasPaint
    ? (args.texture.uvPaint ?? { scope: 'rects', mapping: 'stretch' })
    : args.texture.uvPaint;
  if (!uvPaintSpec || !hasPaint) {
    return { ok: true, config: undefined, uvPaintApplied: false };
  }
  if (!args.usage) {
    return { ok: false, error: { code: 'invalid_state', message: UV_PAINT_MAPPING_REQUIRED } };
  }
  const rectRes = resolveUvPaintRects({ ...args.texture, uvPaint: uvPaintSpec }, args.usage, uvPaintMessages);
  if (!rectRes.ok) return { ok: false, error: rectRes.error };
  const sourceRes = validateUvPaintSourceSize(
    Number(uvPaintSpec.source?.width ?? args.size.width),
    Number(uvPaintSpec.source?.height ?? args.size.height),
    args.limits,
    args.texture.name ?? args.texture.targetName ?? args.texture.targetId ?? 'texture',
    { requireInteger: false },
    uvPaintSourceMessages
  );
  if (!sourceRes.ok) return { ok: false, error: sourceRes.error };
  const sourceWidth = sourceRes.data.width;
  const sourceHeight = sourceRes.data.height;
  const anchor =
    Array.isArray(uvPaintSpec.anchor) && uvPaintSpec.anchor.length === 2
      ? ([uvPaintSpec.anchor[0], uvPaintSpec.anchor[1]] as [number, number])
      : ([0, 0] as [number, number]);
  const padding =
    typeof uvPaintSpec.padding === 'number' && Number.isFinite(uvPaintSpec.padding)
      ? Math.max(0, uvPaintSpec.padding)
      : 0;
  return {
    ok: true,
    uvPaintApplied: true,
    config: {
      rects: rectRes.data.rects,
      mapping: uvPaintSpec.mapping ?? 'stretch',
      padding,
      anchor,
      source: { width: Math.trunc(sourceWidth), height: Math.trunc(sourceHeight) }
    }
  };
};
