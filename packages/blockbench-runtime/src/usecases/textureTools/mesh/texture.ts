import type { PaintMeshFacePayload } from '@ashfox/blockbench-contracts/types/internal';
import { checkDimensions, mapDimensionError } from '../../../domain/dimensions';
import {
  DIMENSION_INTEGER_MESSAGE,
  DIMENSION_POSITIVE_MESSAGE,
  TEXTURE_MESH_FACE_TEXTURE_REQUIRED,
  TEXTURE_PAINT_SIZE_EXCEEDS_MAX,
  TEXTURE_PAINT_SIZE_EXCEEDS_MAX_FIX,
  TEXTURE_RENDERER_UNAVAILABLE,
} from '../../../shared/messages';
import { buildIdNameMismatchMessage } from '../../../shared/targetMessages';
import { fail, ok, type UsecaseResult } from '../../result';
import type { TextureToolContext } from '../context';
import type { SnapshotTexture } from './contract';

export const resolveMeshPaintTexture = (
  ctx: TextureToolContext,
  payload: PaintMeshFacePayload,
  snapshot: ReturnType<TextureToolContext['getSnapshot']>,
  textureId: string | undefined,
  textureName: string | undefined,
): UsecaseResult<SnapshotTexture> => {
  const byId = textureId
    ? snapshot.textures.find((texture) => texture.id === textureId)
    : undefined;
  const byName = textureName
    ? snapshot.textures.find((texture) => texture.name === textureName)
    : undefined;
  if (byId && byName && byId.name !== byName.name) {
    return fail({
      code: 'invalid_payload',
      message: buildIdNameMismatchMessage({
        kind: 'Texture',
        plural: 'textures',
        idLabel: 'textureId',
        nameLabel: 'textureName',
        id: textureId as string,
        name: textureName as string,
      }),
    });
  }
  let texture = byId ?? byName ?? null;
  if (!texture) {
    if (!ctx.createBlankTexture) {
      return fail({ code: 'not_implemented', message: TEXTURE_RENDERER_UNAVAILABLE });
    }
    const fallback = ctx.editor.getProjectTextureResolution() ?? {
      width: 16,
      height: 16,
    };
    const width = Number(payload.width ?? fallback.width);
    const height = Number(payload.height ?? fallback.height);
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
      if (dimensions.reason === 'exceeds_max') {
        return fail({
          code: 'invalid_payload',
          message: message ?? TEXTURE_PAINT_SIZE_EXCEEDS_MAX(maxSize),
          fix: TEXTURE_PAINT_SIZE_EXCEEDS_MAX_FIX(maxSize),
          details: { width, height, maxSize },
        });
      }
      return fail({
        code: 'invalid_payload',
        message: message ?? DIMENSION_POSITIVE_MESSAGE('width/height'),
      });
    }
    const created = ctx.createBlankTexture({
      name: textureName ?? 'texture',
      width,
      height,
      allowExisting: true,
    });
    if (!created.ok) return fail(created.error);
    const refreshed = ctx.getSnapshot().textures;
    texture =
      (textureId ? refreshed.find((candidate) => candidate.id === textureId) : undefined) ??
      (textureName ? refreshed.find((candidate) => candidate.name === textureName) : undefined) ??
      null;
  }
  return texture
    ? ok(texture)
    : fail({ code: 'invalid_payload', message: TEXTURE_MESH_FACE_TEXTURE_REQUIRED });
};
