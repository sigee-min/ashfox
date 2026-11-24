import type { PaintMeshFacePayload } from '@ashfox/blockbench-contracts/types/internal';
import { checkDimensions, mapDimensionError } from '../../../domain/dimensions';
import type { TextureOpLike } from '../../../domain/textureOps';
import {
  DIMENSION_INTEGER_MESSAGE,
  DIMENSION_POSITIVE_MESSAGE,
  TEXTURE_MESH_FACE_OP_OUTSIDE_SOURCE,
  TEXTURE_MESH_FACE_OP_OUTSIDE_TARGET,
  TEXTURE_MESH_FACE_TEXTURE_COORDS_SIZE_MISMATCH,
  TEXTURE_MESH_FACE_TEXTURE_COORDS_SIZE_REQUIRED,
  TEXTURE_PAINT_SIZE_EXCEEDS_MAX,
  TEXTURE_PAINT_SIZE_EXCEEDS_MAX_FIX,
} from '../../../shared/messages';
import { fail, ok, type UsecaseResult } from '../../result';
import type { TextureToolContext } from '../context';
import {
  doesBoundsIntersectCanvas,
  doesBoundsIntersectRects,
  getRectSpan,
  getTextureOpBounds,
  type Rect,
} from '../paintFacesPixels';
import type { SourceSize, TextureReadSource } from './contract';

export const resolveMeshPaintSourceSize = (
  ctx: TextureToolContext,
  payload: PaintMeshFacePayload,
  coordSpace: 'face' | 'texture',
  texture: TextureReadSource,
  faceBounds: Rect,
): UsecaseResult<SourceSize> => {
  if (coordSpace === 'texture' && (payload.width === undefined || payload.height === undefined)) {
    return fail({
      code: 'invalid_payload',
      message: TEXTURE_MESH_FACE_TEXTURE_COORDS_SIZE_REQUIRED,
    });
  }
  const width = Number(payload.width ?? getRectSpan(faceBounds.x1, faceBounds.x2));
  const height = Number(payload.height ?? getRectSpan(faceBounds.y1, faceBounds.y2));
  const maxSize = ctx.capabilities.limits.maxTextureSize;
  const dimensions = checkDimensions(width, height, {
    requireInteger: true,
    maxSize,
  });
  if (!dimensions.ok) {
    const message = mapDimensionError(dimensions, {
      nonPositive: (axis) => DIMENSION_POSITIVE_MESSAGE(axis, axis),
      nonInteger: (axis) => DIMENSION_INTEGER_MESSAGE(axis, axis),
      exceedsMax: (limit) => TEXTURE_PAINT_SIZE_EXCEEDS_MAX(limit || maxSize),
    });
    return dimensions.reason === 'exceeds_max'
      ? fail({
          code: 'invalid_payload',
          message: message ?? TEXTURE_PAINT_SIZE_EXCEEDS_MAX(maxSize),
          fix: TEXTURE_PAINT_SIZE_EXCEEDS_MAX_FIX(maxSize),
          details: { width, height, maxSize },
        })
      : fail({
          code: 'invalid_payload',
          message: message ?? DIMENSION_POSITIVE_MESSAGE('width/height'),
        });
  }
  const sourceWidth = Math.trunc(width);
  const sourceHeight = Math.trunc(height);
  if (
    coordSpace === 'texture' &&
    (sourceWidth !== texture.textureWidth || sourceHeight !== texture.textureHeight)
  ) {
    return fail({
      code: 'invalid_payload',
      message: TEXTURE_MESH_FACE_TEXTURE_COORDS_SIZE_MISMATCH(
        texture.textureWidth,
        texture.textureHeight,
        sourceWidth,
        sourceHeight,
      ),
    });
  }
  return ok({ sourceWidth, sourceHeight });
};

export const validateMeshPaintGeometry = (
  coordSpace: 'face' | 'texture',
  op: TextureOpLike,
  rects: readonly Rect[],
  faceBounds: Rect,
  source: SourceSize,
): UsecaseResult<void> => {
  const opBounds = getTextureOpBounds(op);
  if (!doesBoundsIntersectCanvas(opBounds, source.sourceWidth, source.sourceHeight)) {
    return fail({
      code: 'invalid_payload',
      message: TEXTURE_MESH_FACE_OP_OUTSIDE_SOURCE(
        coordSpace,
        source.sourceWidth,
        source.sourceHeight,
      ),
      details: { coordSpace, ...source, opBounds },
    });
  }
  if (coordSpace === 'texture' && !doesBoundsIntersectRects(opBounds, [...rects])) {
    return fail({
      code: 'invalid_payload',
      message: TEXTURE_MESH_FACE_OP_OUTSIDE_TARGET,
      details: {
        coordSpace,
        opBounds,
        faceUv: [faceBounds.x1, faceBounds.y1, faceBounds.x2, faceBounds.y2],
      },
    });
  }
  return ok(undefined);
};
