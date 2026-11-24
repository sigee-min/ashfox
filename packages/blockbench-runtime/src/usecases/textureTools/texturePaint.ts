import type {
  PaintTexturePayload,
  PaintTextureResult,
} from '@ashfox/blockbench-contracts/types/internal';
import { applyTextureOps, fillPixels, parseHexColor } from '../../domain/texturePaint';
import { resolveUvPaintRects } from '../../domain/uv/paint';
import { guardUvUsage } from '../../domain/uv/guards';
import { collectSingleTarget } from '../../domain/uv/targets';
import { requireUvUsageId } from '../../domain/uv/usageId';
import { validateUvPaintSourceSize } from '../../domain/uv/paintSource';
import { toDomainSnapshot, toDomainTextureUsage } from '../domainMappers';
import { resolveTextureTarget } from '../targetResolvers';
import {
  TEXTURE_ALREADY_EXISTS,
  TEXTURE_OP_INVALID,
  TEXTURE_PAINT_TARGET_REQUIRED,
  TEXTURE_PAINT_UV_USAGE_REQUIRED,
  TEXTURE_RENDERER_UNAVAILABLE,
  TEXTURE_RENDERER_NO_IMAGE,
  TEXTURE_OP_COLOR_INVALID,
  TEXTURE_OP_LINEWIDTH_INVALID,
} from '../../shared/messages';
import { fail, ok, type UsecaseResult } from '../result';
import type { TextureToolContext } from './context';
import {
  uvGuardMessages,
  uvPaintMessages,
  uvPaintPixelMessages,
  uvPaintSourceMessages,
} from './context';
import { applyUvPaintPixels } from '../../domain/uv/paintPixels';
import type { UvPaintRect } from '../../domain/uv/paintTypes';
import { normalizeTexturePaintRequest } from './texturePaintRequest';

export const runPaintTexture = (
  ctx: TextureToolContext,
  payload: PaintTexturePayload,
): UsecaseResult<PaintTextureResult> => {
  if (!ctx.textureRenderer) {
    return fail({ code: 'not_implemented', message: TEXTURE_RENDERER_UNAVAILABLE });
  }
  const request = normalizeTexturePaintRequest(ctx, payload);
  if (!request.ok) return fail(request.error);
  const { mode, label, width, height, maxSize, uvPaintSpec, ops } = request.value;

  const snapshot = ctx.getSnapshot();
  let target: { id?: string; name: string } | null = null;
  if (mode === 'update') {
    const resolved = resolveTextureTarget(snapshot.textures, payload.targetId, payload.targetName, {
      required: { message: TEXTURE_PAINT_TARGET_REQUIRED },
    });
    if (resolved.error) return fail(resolved.error);
    target = resolved.target!;
  }
  if (mode === 'update' && payload.name && payload.name !== target?.name) {
    const conflict = snapshot.textures.some(
      (texture) => texture.name === payload.name && texture.id !== target?.id,
    );
    if (conflict)
      return fail({ code: 'invalid_payload', message: TEXTURE_ALREADY_EXISTS(payload.name) });
  }
  if (mode === 'create' && payload.name) {
    const conflict = snapshot.textures.some((texture) => texture.name === payload.name);
    if (conflict)
      return fail({ code: 'invalid_payload', message: TEXTURE_ALREADY_EXISTS(payload.name) });
  }

  const resolvedLabel =
    target?.name ?? payload.name ?? payload.targetName ?? payload.targetId ?? label;
  const sourceWidth = Number(uvPaintSpec?.source?.width ?? width);
  const sourceHeight = Number(uvPaintSpec?.source?.height ?? height);
  const sourceRes = validateUvPaintSourceSize(
    sourceWidth,
    sourceHeight,
    ctx.capabilities.limits,
    resolvedLabel,
    { requireInteger: true },
    uvPaintSourceMessages,
  );
  if (!sourceRes.ok) {
    const reason = sourceRes.error.details?.reason;
    if (reason === 'exceeds_max') {
      return fail({
        ...sourceRes.error,
        fix: `Use width/height <= ${maxSize}.`,
        details: { ...(sourceRes.error.details ?? {}), maxSize },
      });
    }
    return fail(sourceRes.error);
  }

  let rects: UvPaintRect[] | null = null;
  if (uvPaintSpec) {
    const usageIdRes = requireUvUsageId(payload.uvUsageId, {
      required: TEXTURE_PAINT_UV_USAGE_REQUIRED,
    });
    if (!usageIdRes.ok) return fail(usageIdRes.error);
    const usageRes = ctx.editor.getTextureUsage({});
    if (usageRes.error) return fail(usageRes.error);
    const usageRaw = usageRes.result ?? { textures: [] };
    const usage = toDomainTextureUsage(usageRaw);
    const domainSnapshot = toDomainSnapshot(snapshot);
    const targets = collectSingleTarget({
      id: target?.id,
      name: target?.name ?? payload.name,
      targetId: payload.targetId,
      targetName: payload.targetName,
    });
    const resolution = ctx.editor.getProjectTextureResolution() ?? { width, height };
    const guardError = guardUvUsage({
      usage,
      cubes: domainSnapshot.cubes,
      expectedUsageId: usageIdRes.data,
      resolution,
      policy: ctx.getUvPolicyConfig(),
      targets,
      messages: uvGuardMessages,
    });
    if (guardError) return fail(guardError);
    const rectRes = resolveUvPaintRects(
      {
        id: target?.id,
        name: target?.name ?? payload.name,
        targetId: payload.targetId,
        targetName: payload.targetName,
        uvPaint: uvPaintSpec,
      },
      usage,
      uvPaintMessages,
    );
    if (!rectRes.ok) return fail(rectRes.error);
    rects = rectRes.data.rects;
  }

  const sourceData = new Uint8ClampedArray(sourceWidth * sourceHeight * 4);
  if (payload.background) {
    const bgColor = parseHexColor(payload.background);
    if (!bgColor) {
      return fail({ code: 'invalid_payload', message: TEXTURE_OP_COLOR_INVALID(resolvedLabel) });
    }
    fillPixels(sourceData, sourceWidth, sourceHeight, bgColor);
  }
  if (ops.length > 0) {
    const res = applyTextureOps(sourceData, sourceWidth, sourceHeight, ops, parseHexColor);
    if (!res.ok) {
      const reason =
        res.reason === 'invalid_line_width'
          ? TEXTURE_OP_LINEWIDTH_INVALID(resolvedLabel)
          : res.reason === 'invalid_op' || res.reason === 'raster_work_exceeded'
            ? TEXTURE_OP_INVALID(resolvedLabel)
            : TEXTURE_OP_COLOR_INVALID(resolvedLabel);
      return fail({
        code: 'invalid_payload',
        message: reason,
        details: { opIndex: res.opIndex, reason: res.reason },
      });
    }
  }

  let targetPixels: Uint8ClampedArray = sourceData;
  if (uvPaintSpec) {
    const padding = uvPaintSpec.padding ?? 0;
    const anchor = uvPaintSpec.anchor ?? [0, 0];
    const paintRes = applyUvPaintPixels({
      source: { width: sourceWidth, height: sourceHeight, data: sourceData },
      target: { width, height },
      config: {
        rects: rects ?? [],
        mapping: uvPaintSpec.mapping ?? 'stretch',
        padding,
        anchor,
      },
      label: resolvedLabel,
      messages: uvPaintPixelMessages,
    });
    if (!paintRes.ok) return fail(paintRes.error);
    targetPixels = paintRes.data.data;
  }

  const renderRes = ctx.textureRenderer.renderPixels({ width, height, data: targetPixels });
  if (renderRes.error) return fail(renderRes.error);
  if (!renderRes.result) {
    return fail({ code: 'not_implemented', message: TEXTURE_RENDERER_NO_IMAGE });
  }
  const upsert =
    mode === 'update'
      ? ctx.updateTexture({
          id: target?.id,
          name: target?.name,
          newName: payload.name,
          image: renderRes.result.image,
          width,
          height,
          ifRevision: payload.ifRevision,
        })
      : ctx.importTexture({
          name: payload.name!,
          image: renderRes.result.image,
          width,
          height,
          ifRevision: payload.ifRevision,
        });
  if (!upsert.ok) return fail(upsert.error);
  return ok({ width, height, uvUsageId: payload.uvUsageId, opsApplied: ops.length });
};
