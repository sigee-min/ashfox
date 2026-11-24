import type {
  PaintMeshFacePayload,
  PaintMeshFaceResult,
} from '@ashfox/blockbench-contracts/types/internal';
import {
  TEXTURE_MESH_FACE_NO_PAINTABLE_FACES,
  TEXTURE_MESH_FACE_TARGET_SELECTOR_REQUIRED,
  TEXTURE_MESH_FACE_TEXTURE_REQUIRED,
  TEXTURE_RENDERER_UNAVAILABLE,
} from '../../../shared/messages';
import { fail, ok, type UsecaseResult } from '../../result';
import { resolveMeshTarget } from '../../targetResolvers';
import type { TextureToolContext } from '../context';
import { mergeRects } from '../paintFacesPixels';
import { createMeshFacePaintApplicationPort, summarizeMeshPaintPixels } from './apply';
import { resolveMeshPaintSourceSize, validateMeshPaintGeometry } from './geometry';
import { rasterizeMeshFacePaint } from './raster';
import { normalizePaintMeshFaceRequest, resolvePaintableMeshFaces } from './request';
import { resolveMeshPaintTexture } from './texture';

/**
 * Coordinates immutable request, geometry, raster, and host-application
 * stages. Each stage owns its errors; this boundary only sequences them.
 */
export const runPaintMeshFace = (
  ctx: TextureToolContext,
  payload: PaintMeshFacePayload,
): UsecaseResult<PaintMeshFaceResult> => {
  if (!ctx.textureRenderer) {
    return fail({ code: 'not_implemented', message: TEXTURE_RENDERER_UNAVAILABLE });
  }
  const activeError = ctx.ensureActive();
  if (activeError) return fail(activeError);
  const revisionError = ctx.ensureRevisionMatch(payload.ifRevision);
  if (revisionError) return fail(revisionError);
  const request = normalizePaintMeshFaceRequest(payload);
  if (!request.ok) return fail(request.error);

  const snapshot = ctx.getSnapshot();
  const mesh = resolveMeshTarget(
    snapshot.meshes ?? [],
    request.value.target.meshId,
    request.value.target.meshName,
    {
      required: { message: TEXTURE_MESH_FACE_TARGET_SELECTOR_REQUIRED },
      idLabel: 'meshId',
      nameLabel: 'meshName',
    },
  );
  if (mesh.error || !mesh.target) {
    return fail(
      mesh.error ?? {
        code: 'invalid_payload',
        message: TEXTURE_MESH_FACE_TARGET_SELECTOR_REQUIRED,
      },
    );
  }
  const faces = resolvePaintableMeshFaces(
    mesh.target,
    request.value.target.scope,
    request.value.target.faceId,
  );
  if (!faces.ok) return fail(faces.error);
  const rects = faces.value.rects.map(({ rect }) => rect);
  const faceBounds = mergeRects(rects);
  if (!faceBounds) {
    return fail({ code: 'invalid_state', message: TEXTURE_MESH_FACE_NO_PAINTABLE_FACES });
  }

  const textureName = payload.textureName ?? snapshot.name ?? undefined;
  if (!textureName && !payload.textureId) {
    return fail({ code: 'invalid_payload', message: TEXTURE_MESH_FACE_TEXTURE_REQUIRED });
  }
  const application = createMeshFacePaintApplicationPort(ctx, payload.ifRevision);
  if (!application) {
    return fail({ code: 'not_implemented', message: TEXTURE_RENDERER_UNAVAILABLE });
  }
  const run =
    ctx.runWithoutRevisionGuard ?? ((work: () => UsecaseResult<PaintMeshFaceResult>) => work());
  return run(() => {
    const texture = resolveMeshPaintTexture(ctx, payload, snapshot, payload.textureId, textureName);
    if (!texture.ok) return fail(texture.error);
    const source = application.read(texture.value);
    if (!source.ok) return fail(source.error);
    const sourceSize = resolveMeshPaintSourceSize(
      ctx,
      payload,
      request.value.coordSpace,
      source.value,
      faceBounds,
    );
    if (!sourceSize.ok) return fail(sourceSize.error);
    const geometry = validateMeshPaintGeometry(
      request.value.coordSpace,
      request.value.op,
      rects,
      faceBounds,
      sourceSize.value,
    );
    if (!geometry.ok) return fail(geometry.error);
    const raster = rasterizeMeshFacePaint({
      textureWidth: source.value.textureWidth,
      textureHeight: source.value.textureHeight,
      sourceWidth: sourceSize.value.sourceWidth,
      sourceHeight: sourceSize.value.sourceHeight,
      currentPixels: source.value.pixels,
      rects,
      op: request.value.op,
      coordSpace: request.value.coordSpace,
      mapping: request.value.mapping,
      textureLabel: texture.value.name,
    });
    if (!raster.ok) return fail(raster.error);
    const committed = application.commit(
      texture.value,
      source.value,
      raster.value.pixels,
      raster.value.changedPixels,
      summarizeMeshPaintPixels(source.value.pixels),
    );
    if (!committed.ok) return fail(committed.error);

    const result: PaintMeshFaceResult = {
      textureName: texture.value.name,
      meshId: mesh.target?.id ?? undefined,
      meshName: mesh.target!.name,
      scope: request.value.target.scope,
      width: source.value.textureWidth,
      height: source.value.textureHeight,
      targets: 1,
      facesApplied: faces.value.rects.length,
      opsApplied: 1,
      changedPixels: raster.value.changedPixels,
      resolvedSource: {
        coordSpace: request.value.coordSpace,
        width: sourceSize.value.sourceWidth,
        height: sourceSize.value.sourceHeight,
        faceUv: [faceBounds.x1, faceBounds.y1, faceBounds.x2, faceBounds.y2],
      },
    };
    if (faces.value.skippedFaces.length > 0) {
      result.skippedFaces = [...faces.value.skippedFaces];
    }
    return ok(result);
  });
};

export { createMeshFacePaintApplicationPort, summarizeMeshPaintPixels } from './apply';
export { resolveMeshPaintSourceSize, validateMeshPaintGeometry } from './geometry';
export { rasterizeMeshFacePaint } from './raster';
export { normalizePaintMeshFaceRequest, resolvePaintableMeshFaces } from './request';
export { resolveMeshPaintTexture } from './texture';
