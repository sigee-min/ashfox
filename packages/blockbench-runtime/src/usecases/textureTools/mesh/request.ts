import type { PaintMeshFacePayload } from '@ashfox/blockbench-contracts/types/internal';
import { isTextureOp } from '../../../domain/textureOps';
import {
  TEXTURE_MESH_FACE_COORD_SPACE_INVALID,
  TEXTURE_MESH_FACE_NOT_FOUND,
  TEXTURE_MESH_FACE_NO_PAINTABLE_FACES,
  TEXTURE_MESH_FACE_OP_REQUIRED,
  TEXTURE_MESH_FACE_SCOPE_ALL_FORBIDS_FACE_ID,
  TEXTURE_MESH_FACE_SCOPE_INVALID,
  TEXTURE_MESH_FACE_SCOPE_SINGLE_REQUIRES_FACE_ID,
  TEXTURE_MESH_FACE_TARGET_REQUIRED,
  TEXTURE_MESH_FACE_TARGET_SELECTOR_REQUIRED,
  TEXTURE_MESH_FACE_UV_REQUIRED,
  TEXTURE_OP_INVALID,
} from '../../../shared/messages';
import { ensureNonBlankString } from '../../../shared/payloadValidation';
import { fail, ok, type UsecaseResult } from '../../result';
import type {
  NormalizedPaintMeshInput,
  ResolvedMeshFaces,
  SnapshotMesh,
  SnapshotMeshFace,
} from './contract';
import type { Rect } from '../paintFacesPixels';

export const normalizePaintMeshFaceRequest = (
  payload: PaintMeshFacePayload,
): UsecaseResult<NormalizedPaintMeshInput> => {
  if (!payload.target || typeof payload.target !== 'object') {
    return fail({ code: 'invalid_payload', message: TEXTURE_MESH_FACE_TARGET_REQUIRED });
  }
  const validations = [
    ensureNonBlankString(payload.target.meshId, 'meshId'),
    ensureNonBlankString(payload.target.meshName, 'meshName'),
    ensureNonBlankString(payload.target.faceId, 'target.faceId'),
  ];
  const invalidText = validations.find((error) => error !== null);
  if (invalidText) return fail(invalidText);
  if (!payload.target.meshId && !payload.target.meshName) {
    return fail({ code: 'invalid_payload', message: TEXTURE_MESH_FACE_TARGET_SELECTOR_REQUIRED });
  }
  const scopeRaw = payload.scope;
  if (scopeRaw && scopeRaw !== 'single_face' && scopeRaw !== 'all_faces') {
    return fail({ code: 'invalid_payload', message: TEXTURE_MESH_FACE_SCOPE_INVALID });
  }
  const scope = scopeRaw ?? (payload.target.faceId ? 'single_face' : 'all_faces');
  if (scope === 'single_face' && !payload.target.faceId) {
    return fail({
      code: 'invalid_payload',
      message: TEXTURE_MESH_FACE_SCOPE_SINGLE_REQUIRES_FACE_ID,
    });
  }
  if (scope === 'all_faces' && payload.target.faceId) {
    return fail({ code: 'invalid_payload', message: TEXTURE_MESH_FACE_SCOPE_ALL_FORBIDS_FACE_ID });
  }
  if (!payload.op || typeof payload.op !== 'object' || !isTextureOp(payload.op)) {
    if (!payload.op || typeof payload.op !== 'object') {
      return fail({ code: 'invalid_payload', message: TEXTURE_MESH_FACE_OP_REQUIRED });
    }
    return fail({
      code: 'invalid_payload',
      message: TEXTURE_OP_INVALID('paint_mesh_face'),
      details: { opIndex: 0, reason: 'invalid_op' },
    });
  }
  const coordSpace = payload.coordSpace ?? 'face';
  if (coordSpace !== 'face' && coordSpace !== 'texture') {
    return fail({ code: 'invalid_payload', message: TEXTURE_MESH_FACE_COORD_SPACE_INVALID });
  }
  const mapping = payload.mapping ?? 'stretch';
  if (mapping !== 'stretch' && mapping !== 'tile') {
    return fail({ code: 'invalid_payload', message: TEXTURE_OP_INVALID('paint_mesh_face') });
  }
  return ok({
    target: {
      meshId: payload.target.meshId,
      meshName: payload.target.meshName,
      faceId: payload.target.faceId,
      scope,
    },
    coordSpace,
    mapping,
    op: payload.op,
  });
};

const faceRect = (face: SnapshotMeshFace): Rect | null => {
  if (!Array.isArray(face.uv) || face.uv.length < 3) return null;
  const points = face.uv
    .map((point) => [Number(point?.uv?.[0]), Number(point?.uv?.[1])] as const)
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (points.length < 3) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const rect = {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
  return rect.x2 > rect.x1 && rect.y2 > rect.y1 ? rect : null;
};

const faceIdAt = (face: SnapshotMeshFace, index: number): string => {
  const id = typeof face.id === 'string' ? face.id.trim() : '';
  return id.length > 0 ? id : `face_${index}`;
};

export const resolvePaintableMeshFaces = (
  mesh: SnapshotMesh,
  scope: 'single_face' | 'all_faces',
  faceId: string | undefined,
): UsecaseResult<ResolvedMeshFaces> => {
  if (scope === 'single_face') {
    const found = mesh.faces.find((face) => face.id === faceId);
    if (!found || !faceId) {
      return fail({
        code: 'invalid_payload',
        message: TEXTURE_MESH_FACE_NOT_FOUND(faceId ?? 'unknown'),
      });
    }
    const rect = faceRect(found);
    return rect
      ? ok({ rects: [{ faceId, rect }], skippedFaces: [] })
      : fail({ code: 'invalid_payload', message: TEXTURE_MESH_FACE_UV_REQUIRED(faceId) });
  }
  const rects: Array<{ faceId: string; rect: Rect }> = [];
  const skippedFaces: Array<{ faceId: string; reason: string }> = [];
  mesh.faces.forEach((face, index) => {
    const faceId = faceIdAt(face, index);
    const rect = faceRect(face);
    if (rect) rects.push({ faceId, rect });
    else skippedFaces.push({ faceId, reason: 'missing_or_invalid_uv' });
  });
  return rects.length > 0
    ? ok({ rects, skippedFaces })
    : fail({
        code: 'invalid_state',
        message: TEXTURE_MESH_FACE_NO_PAINTABLE_FACES,
        details: { skippedFaces },
      });
};
