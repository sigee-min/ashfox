import { TextureOp, TextureSpec } from '../../spec';
import type { Limits, ToolResponse } from '../../types';
import type { DomPort } from '../../ports/dom';
import { err } from '../response';
import type { UvPaintRect } from '../../domain/uv/paintTypes';
import { checkDimensions, mapDimensionError } from '../../domain/dimensions';
import { validateUvPaintSourceSize } from '../../domain/uv/paintSource';
import { MAX_TEXTURE_OPS } from '../../domain/textureOps';
import { normalizeTextureSpecSize } from '../../domain/textureSpecValidation';
import { normalizeUvPaintRects } from '../../domain/uv/paintRects';
import { buildUvPaintRectMessages, buildUvPaintSourceMessages } from '../../shared/messages';
import {
  TEXTURE_CANVAS_CONTEXT_UNAVAILABLE,
  TEXTURE_CANVAS_UNAVAILABLE,
  TEXTURE_DIMENSION_POSITIVE,
  TEXTURE_OPS_TOO_MANY,
  TEXTURE_OP_UNSUPPORTED,
  TEXTURE_SIZE_EXCEEDS_MAX,
  UV_PAINT_CANVAS_UNAVAILABLE,
  UV_PAINT_CONTEXT_UNAVAILABLE,
  UV_PAINT_PATTERN_UNAVAILABLE,
  UV_PAINT_RECTS_REQUIRED
} from '../../shared/messages';
import { textureSpecSizeMessages } from './specSize';
import { analyzeTextureCoverage, analyzeTextureCoverageInRects, type TextureCoverage } from './textureCoverage';

export type UvPaintRenderConfig = {
  rects: UvPaintRect[];
  mapping: 'stretch' | 'tile';
  padding: number;
  anchor: [number, number];
  source: { width: number; height: number };
};

type RenderTextureResult = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  coverage?: TextureCoverage;
  paintCoverage?: TextureCoverage;
};

const uvPaintRectMessages = buildUvPaintRectMessages();
const uvPaintSourceMessages = buildUvPaintSourceMessages();

export const renderTextureSpec = (
  dom: DomPort,
  spec: TextureSpec,
  limits: Limits,
  base?: { image: CanvasImageSource; width: number; height: number },
  uvPaint?: UvPaintRenderConfig
): ToolResponse<RenderTextureResult> => {
  const label = spec?.name ?? spec?.targetName ?? spec?.targetId ?? 'texture';
  const sizeRes = normalizeTextureSpecSize(spec, base, textureSpecSizeMessages);
  if (!sizeRes.ok) {
    return err('invalid_payload', sizeRes.error.message);
  }
  const width = Number(sizeRes.data.width);
  const height = Number(sizeRes.data.height);
  const sizeCheck = checkDimensions(width, height, { requireInteger: false, maxSize: limits.maxTextureSize });
  const sizeMessage = mapDimensionError(sizeCheck, {
    nonPositive: (axis) => TEXTURE_DIMENSION_POSITIVE(axis, label),
    nonInteger: (axis) => TEXTURE_DIMENSION_POSITIVE(axis, label),
    exceedsMax: (maxSize) => TEXTURE_SIZE_EXCEEDS_MAX(maxSize || limits.maxTextureSize, label)
  });
  if (sizeMessage) {
    return err('invalid_payload', sizeMessage);
  }
  const canvas = dom.createCanvas();
  if (!canvas) return err('not_implemented', TEXTURE_CANVAS_UNAVAILABLE);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return err('not_implemented', TEXTURE_CANVAS_CONTEXT_UNAVAILABLE);
  ctx.imageSmoothingEnabled = false;
  const hasUvPaint = Boolean(uvPaint);
  if (!hasUvPaint && spec.background) {
    ctx.fillStyle = spec.background;
    ctx.fillRect(0, 0, width, height);
  }
  if (base?.image) {
    ctx.drawImage(base.image, 0, 0, width, height);
  }
  const ops = Array.isArray(spec.ops) ? spec.ops : [];
  if (ops.length > MAX_TEXTURE_OPS) {
    return err('invalid_payload', TEXTURE_OPS_TOO_MANY(MAX_TEXTURE_OPS, label));
  }
  let paintCoverage: TextureCoverage | undefined;
  if (uvPaint) {
    const sourceRes = validateUvPaintSourceSize(
      Number(uvPaint.source.width),
      Number(uvPaint.source.height),
      limits,
      label,
      { requireInteger: false },
      uvPaintSourceMessages
    );
    if (!sourceRes.ok) {
      return err(sourceRes.error.code, sourceRes.error.message);
    }
    const sourceWidth = sourceRes.data.width;
    const sourceHeight = sourceRes.data.height;
    const patternCanvas = dom.createCanvas();
    if (!patternCanvas) return err('not_implemented', UV_PAINT_CANVAS_UNAVAILABLE);
    patternCanvas.width = sourceWidth;
    patternCanvas.height = sourceHeight;
    const patternCtx = patternCanvas.getContext('2d');
    if (!patternCtx) return err('not_implemented', UV_PAINT_CONTEXT_UNAVAILABLE);
    patternCtx.imageSmoothingEnabled = false;
    if (spec.background) {
      patternCtx.fillStyle = spec.background;
      patternCtx.fillRect(0, 0, sourceWidth, sourceHeight);
    }
    for (const op of ops) {
      const res = applyTextureOp(patternCtx, op);
      if (!res.ok) return res;
    }
    const paintRes = applyUvPaint(ctx, patternCanvas, uvPaint, width, height, label);
    if (!paintRes.ok) return paintRes;
    paintCoverage = analyzeTextureCoverageInRects(ctx, width, height, paintRes.data.rects) ?? undefined;
  } else {
    for (const op of ops) {
      const res = applyTextureOp(ctx, op);
      if (!res.ok) return res;
    }
  }
  const coverage = analyzeTextureCoverage(ctx, width, height);
  return {
    ok: true,
    data: {
      canvas,
      width,
      height,
      coverage: coverage ?? undefined,
      paintCoverage
    }
  };
};

const applyTextureOp = (ctx: CanvasRenderingContext2D, op: TextureOp): ToolResponse<void> => {
  switch (op.op) {
    case 'set_pixel': {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, 1, 1);
      return { ok: true, data: undefined };
    }
    case 'fill_rect': {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, op.width, op.height);
      return { ok: true, data: undefined };
    }
    case 'draw_rect': {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = isFiniteNumber(op.lineWidth) && op.lineWidth > 0 ? op.lineWidth : 1;
      ctx.strokeRect(op.x, op.y, op.width, op.height);
      return { ok: true, data: undefined };
    }
    case 'draw_line': {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = isFiniteNumber(op.lineWidth) && op.lineWidth > 0 ? op.lineWidth : 1;
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.stroke();
      return { ok: true, data: undefined };
    }
    default:
      return err('invalid_payload', TEXTURE_OP_UNSUPPORTED);
  }
};

const applyUvPaint = (
  ctx: CanvasRenderingContext2D,
  patternCanvas: HTMLCanvasElement,
  config: UvPaintRenderConfig,
  width: number,
  height: number,
  label: string
): ToolResponse<{ rects: UvPaintRect[] }> => {
  if (!Array.isArray(config.rects) || config.rects.length === 0) {
    return err('invalid_payload', UV_PAINT_RECTS_REQUIRED(label));
  }
  const normalizedRes = normalizeUvPaintRects(
    config.rects,
    config.padding,
    width,
    height,
    label,
    uvPaintRectMessages
  );
  if (!normalizedRes.ok) return err(normalizedRes.error.code, normalizedRes.error.message);
  const rects = normalizedRes.data;
  const mapping = config.mapping ?? 'stretch';
  if (mapping === 'tile') {
    const pattern = ctx.createPattern(patternCanvas, 'repeat');
    if (!pattern) return err('not_implemented', UV_PAINT_PATTERN_UNAVAILABLE(label));
    const [anchorX, anchorY] = config.anchor ?? [0, 0];
    rects.forEach((rect) => {
      const rectWidth = rect.x2 - rect.x1;
      const rectHeight = rect.y2 - rect.y1;
      if (rectWidth <= 0 || rectHeight <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x1, rect.y1, rectWidth, rectHeight);
      ctx.clip();
      ctx.translate(anchorX, anchorY);
      ctx.fillStyle = pattern;
      ctx.fillRect(rect.x1 - anchorX, rect.y1 - anchorY, rectWidth, rectHeight);
      ctx.restore();
    });
    return { ok: true, data: { rects } };
  }
  rects.forEach((rect) => {
    const rectWidth = rect.x2 - rect.x1;
    const rectHeight = rect.y2 - rect.y1;
    if (rectWidth <= 0 || rectHeight <= 0) return;
    ctx.drawImage(
      patternCanvas,
      0,
      0,
      patternCanvas.width,
      patternCanvas.height,
      rect.x1,
      rect.y1,
      rectWidth,
      rectHeight
    );
  });
  return { ok: true, data: { rects } };
};

const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);


