import type { SessionState } from '../../../session';
import { resolveBoneNameById } from '../../../domain/sessionLookup';
import { MODEL_BONE_NOT_FOUND } from '../../../shared/messages';
import { fail, ok, type UsecaseResult } from '../../result';

export const resolveMeshBone = (
  snapshot: SessionState,
  payload: { bone?: string; boneId?: string },
): UsecaseResult<string | undefined> => {
  const hasExplicit = payload.boneId !== undefined || payload.bone !== undefined;
  if (hasExplicit) {
    const boneName = payload.boneId
      ? resolveBoneNameById(snapshot.bones, payload.boneId)
      : payload.bone;
    if (payload.boneId && !boneName) {
      return fail({
        code: 'invalid_payload',
        message: MODEL_BONE_NOT_FOUND(payload.boneId),
      });
    }
    if (boneName && !snapshot.bones.some((bone) => bone.name === boneName)) {
      return fail({
        code: 'invalid_payload',
        message: MODEL_BONE_NOT_FOUND(boneName),
      });
    }
    return ok(boneName ?? undefined);
  }
  return ok(snapshot.bones.some((bone) => bone.name === 'root') ? 'root' : undefined);
};

export const resolveMeshBoneUpdate = (
  snapshot: SessionState,
  payload: { boneRoot?: boolean; bone?: string; boneId?: string },
): UsecaseResult<string | null | undefined> => {
  const boneUpdate = payload.boneRoot
    ? null
    : payload.boneId
      ? resolveBoneNameById(snapshot.bones, payload.boneId)
      : payload.bone;
  if (payload.boneId && !boneUpdate) {
    return fail({
      code: 'invalid_payload',
      message: MODEL_BONE_NOT_FOUND(payload.boneId),
    });
  }
  if (typeof boneUpdate === 'string' && !snapshot.bones.some((bone) => bone.name === boneUpdate)) {
    return fail({
      code: 'invalid_payload',
      message: MODEL_BONE_NOT_FOUND(boneUpdate),
    });
  }
  return ok(boneUpdate ?? undefined);
};
