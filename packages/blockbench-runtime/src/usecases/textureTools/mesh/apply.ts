import type { ToolError } from '@ashfox/blockbench-contracts/types/internal';
import {
  TEXTURE_MESH_FACE_GUARD_ROLLBACK,
  TEXTURE_MESH_FACE_SIZE_REQUIRED,
  TEXTURE_RENDERER_NO_IMAGE,
  TEXTURE_RENDERER_UNAVAILABLE,
} from '../../../shared/messages';
import { fail, ok, type UsecaseResult } from '../../result';
import type { TextureToolContext } from '../context';
import { countChangedPixels } from '../paintFacesPixels';
import type { PixelStats, SnapshotTexture, TextureReadSource } from './contract';

export interface MeshFacePaintApplicationPort {
  readonly read: (texture: SnapshotTexture) => UsecaseResult<TextureReadSource>;
  readonly commit: (
    texture: SnapshotTexture,
    source: TextureReadSource,
    nextPixels: Uint8ClampedArray,
    expectedChangedPixels: number,
    beforeStats: PixelStats,
  ) => UsecaseResult<void>;
}

export const summarizeMeshPaintPixels = (pixels: Uint8ClampedArray): PixelStats => {
  let opaquePixels = 0;
  let checksum = 2166136261;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] > 0) opaquePixels += 1;
    for (let channel = 0; channel < 4; channel += 1) {
      checksum ^= pixels[index + channel];
      checksum = Math.imul(checksum, 16777619);
    }
  }
  return { opaquePixels, checksum: checksum >>> 0 };
};

export const createMeshFacePaintApplicationPort = (
  ctx: TextureToolContext,
  ifRevision: string | undefined,
): MeshFacePaintApplicationPort | null => {
  const renderer = ctx.textureRenderer;
  if (!renderer) return null;

  const readPixels = (
    texture: SnapshotTexture,
    expectedWidth?: number,
    expectedHeight?: number,
    useTextureMetadata = true,
  ): UsecaseResult<TextureReadSource> => {
    const read = ctx.editor.readTexture({ id: texture.id, name: texture.name });
    if (read.error || !read.result?.image) {
      return fail(read.error ?? { code: 'invalid_state', message: TEXTURE_RENDERER_NO_IMAGE });
    }
    const resolution = ctx.editor.getProjectTextureResolution();
    const width =
      read.result.width ??
      (useTextureMetadata ? texture.width : expectedWidth) ??
      resolution?.width;
    const height =
      read.result.height ??
      (useTextureMetadata ? texture.height : expectedHeight) ??
      resolution?.height;
    if (!width || !height) {
      return fail({ code: 'invalid_payload', message: TEXTURE_MESH_FACE_SIZE_REQUIRED });
    }
    const pixels = renderer.readPixels?.({ image: read.result.image, width, height });
    if (!pixels || pixels.error || !pixels.result) {
      return fail(
        pixels?.error ?? {
          code: 'not_implemented',
          message: TEXTURE_RENDERER_UNAVAILABLE,
        },
      );
    }
    return ok({
      textureWidth: width,
      textureHeight: height,
      pixels: pixels.result.data,
    });
  };

  const writePixels = (
    texture: SnapshotTexture,
    width: number,
    height: number,
    pixels: Uint8ClampedArray,
    missingImageCode: 'not_implemented' | 'invalid_state',
  ): ToolError | null => {
    const rendered = renderer.renderPixels({ width, height, data: pixels });
    if (rendered.error || !rendered.result?.image) {
      return rendered.error ?? { code: missingImageCode, message: TEXTURE_RENDERER_NO_IMAGE };
    }
    const updated = ctx.updateTexture({
      id: texture.id,
      name: texture.name,
      image: rendered.result.image,
      width,
      height,
      ifRevision,
    });
    return !updated.ok && updated.error.code !== 'no_change' ? updated.error : null;
  };

  return {
    read: (texture) => readPixels(texture),
    commit: (texture, source, nextPixels, changedPixels, beforeStats) => {
      const updateError = writePixels(
        texture,
        source.textureWidth,
        source.textureHeight,
        nextPixels,
        'not_implemented',
      );
      if (updateError) return fail(updateError);
      if (changedPixels === 0) return ok(undefined);
      const committed = readPixels(texture, source.textureWidth, source.textureHeight, false);
      if (!committed.ok) return fail(committed.error);
      if (countChangedPixels(source.pixels, committed.value.pixels) > 0) {
        return ok(undefined);
      }
      const afterStats = summarizeMeshPaintPixels(committed.value.pixels);
      const rollbackError = writePixels(
        texture,
        source.textureWidth,
        source.textureHeight,
        source.pixels,
        'invalid_state',
      );
      return fail({
        code: 'invalid_state',
        message: TEXTURE_MESH_FACE_GUARD_ROLLBACK,
        details: {
          reason: 'no_committed_delta',
          rollbackApplied: !rollbackError,
          rollbackError: rollbackError?.message,
          expectedChangedPixels: changedPixels,
          beforeOpaquePixels: beforeStats.opaquePixels,
          afterOpaquePixels: afterStats.opaquePixels,
          beforeChecksum: beforeStats.checksum,
          afterChecksum: afterStats.checksum,
        },
      });
    },
  };
};
