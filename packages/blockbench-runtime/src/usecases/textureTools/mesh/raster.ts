import type { TextureOpLike, TextureRasterFailureReason } from '../../../domain/textureOps';
import { applyTextureOps, parseHexColor } from '../../../domain/texturePaint';
import { applyUvPaintPixels } from '../../../domain/uv/paintPixels';
import {
  TEXTURE_OP_COLOR_INVALID,
  TEXTURE_OP_INVALID,
  TEXTURE_OP_LINEWIDTH_INVALID,
  UV_PAINT_SOURCE_DATA_MISMATCH,
  UV_PAINT_SOURCE_TARGET_POSITIVE,
} from '../../../shared/messages';
import { fail, ok, type UsecaseResult } from '../../result';
import { uvPaintPixelMessages } from '../context';
import {
  countChangedPixels,
  overlayPatchRectsPreserveTransparent,
  overlayTextureSpaceRects,
  type Rect,
} from '../paintFacesPixels';
import type { RasterizedMeshFacePaint } from './contract';

export interface MeshFaceRasterRequest {
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly currentPixels: Uint8ClampedArray;
  readonly rects: readonly Rect[];
  readonly op: TextureOpLike;
  readonly coordSpace: 'face' | 'texture';
  readonly mapping: 'stretch' | 'tile';
  readonly textureLabel: string;
}

const textureOpMessage = (
  reason: 'invalid_color' | 'invalid_line_width' | TextureRasterFailureReason,
  label: string,
): string => {
  switch (reason) {
    case 'invalid_line_width':
      return TEXTURE_OP_LINEWIDTH_INVALID(label);
    case 'invalid_op':
    case 'raster_work_exceeded':
      return TEXTURE_OP_INVALID(label);
    default:
      return TEXTURE_OP_COLOR_INVALID(label);
  }
};

const applySingleOp = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  op: TextureOpLike,
  label: string,
): UsecaseResult<void> => {
  const applied = applyTextureOps(pixels, width, height, [op], parseHexColor);
  return applied.ok
    ? ok(undefined)
    : fail({
        code: 'invalid_payload',
        message: textureOpMessage(applied.reason, label),
        details: { opIndex: applied.opIndex, reason: applied.reason },
      });
};

export const rasterizeMeshFacePaint = (
  request: MeshFaceRasterRequest,
): UsecaseResult<RasterizedMeshFacePaint> => {
  const expectedLength = request.textureWidth * request.textureHeight * 4;
  if (request.currentPixels.length !== expectedLength) {
    return fail({
      code: 'invalid_payload',
      message: UV_PAINT_SOURCE_DATA_MISMATCH(request.textureLabel),
    });
  }
  if (
    request.sourceWidth <= 0 ||
    request.sourceHeight <= 0 ||
    request.textureWidth <= 0 ||
    request.textureHeight <= 0
  ) {
    return fail({
      code: 'invalid_payload',
      message: UV_PAINT_SOURCE_TARGET_POSITIVE(request.textureLabel),
    });
  }
  const pixels = new Uint8ClampedArray(request.currentPixels);
  const before = new Uint8ClampedArray(request.currentPixels);
  const rects = [...request.rects];
  if (request.coordSpace === 'texture') {
    const textureSpace = new Uint8ClampedArray(pixels);
    const applied = applySingleOp(
      textureSpace,
      request.sourceWidth,
      request.sourceHeight,
      request.op,
      request.textureLabel,
    );
    if (!applied.ok) return applied;
    overlayTextureSpaceRects(
      pixels,
      textureSpace,
      rects,
      request.textureWidth,
      request.textureHeight,
    );
    return ok({ pixels, changedPixels: countChangedPixels(before, pixels) });
  }
  const sourceData = new Uint8ClampedArray(request.sourceWidth * request.sourceHeight * 4);
  const applied = applySingleOp(
    sourceData,
    request.sourceWidth,
    request.sourceHeight,
    request.op,
    request.textureLabel,
  );
  if (!applied.ok) return applied;
  const patch = applyUvPaintPixels({
    source: {
      width: request.sourceWidth,
      height: request.sourceHeight,
      data: sourceData,
    },
    target: { width: request.textureWidth, height: request.textureHeight },
    config: {
      rects,
      mapping: request.mapping,
      padding: 0,
      anchor: [0, 0],
    },
    label: request.textureLabel,
    messages: uvPaintPixelMessages,
  });
  if (!patch.ok) return fail(patch.error);
  overlayPatchRectsPreserveTransparent(
    pixels,
    patch.data.data,
    rects,
    request.textureWidth,
    request.textureHeight,
  );
  return ok({ pixels, changedPixels: countChangedPixels(before, pixels) });
};
