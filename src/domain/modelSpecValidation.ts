import type { ModelSpec } from '../spec';
import type { DomainResult } from './result';
import { fail, ok } from './result';
import { isFiniteNumber } from './guards';

export type ModelSpecMessages = {
  modelRequired: string;
  modelContentRequired: string;
  anchorsArray: string;
  boneObject: string;
  cubeObject: string;
  anchorObject: string;
  anchorIdRequired: string;
  anchorIdDuplicate: (id: string) => string;
  anchorTargetInvalid: (id: string) => string;
  anchorBoneIdInvalid: (id: string) => string;
  anchorCubeIdInvalid: (id: string) => string;
  anchorOffsetInvalid: (id: string) => string;
  anchorRefString: (label: string) => string;
  anchorRequired: (label: string) => string;
  anchorNotFound: (id: string) => string;
};

export const validateModelSpec = (
  model: ModelSpec,
  messages: ModelSpecMessages
): DomainResult<{ valid: true }> => {
  if (!model || typeof model !== 'object') return fail('invalid_payload', messages.modelRequired);
  if (model.anchors !== undefined && !Array.isArray(model.anchors)) {
    return fail('invalid_payload', messages.anchorsArray);
  }
  if (model.bone !== undefined && (typeof model.bone !== 'object' || Array.isArray(model.bone))) {
    return fail('invalid_payload', messages.boneObject);
  }
  if (model.cube !== undefined && (typeof model.cube !== 'object' || Array.isArray(model.cube))) {
    return fail('invalid_payload', messages.cubeObject);
  }
  const hasBone = Boolean(model.bone);
  const hasCube = Boolean(model.cube);
  const hasTemplate = typeof model.rigTemplate === 'string';
  if (!hasBone && !hasCube && !hasTemplate) {
    return fail('invalid_payload', messages.modelContentRequired);
  }

  const anchors = Array.isArray(model.anchors) ? model.anchors : [];
  const anchorIds = new Set<string>();

  for (const anchor of anchors) {
    if (!anchor || typeof anchor !== 'object') {
      return fail('invalid_payload', messages.anchorObject);
    }
    if (typeof anchor.id !== 'string' || anchor.id.trim().length === 0) {
      return fail('invalid_payload', messages.anchorIdRequired);
    }
    if (anchorIds.has(anchor.id)) {
      return fail('invalid_payload', messages.anchorIdDuplicate(anchor.id));
    }
    anchorIds.add(anchor.id);
    const target = anchor.target as { boneId?: unknown; cubeId?: unknown } | undefined;
    const boneId = target?.boneId;
    const cubeId = target?.cubeId;
    if ((boneId && cubeId) || (!boneId && !cubeId)) {
      return fail('invalid_payload', messages.anchorTargetInvalid(anchor.id));
    }
    if (boneId !== undefined && (typeof boneId !== 'string' || boneId.trim().length === 0)) {
      return fail('invalid_payload', messages.anchorBoneIdInvalid(anchor.id));
    }
    if (cubeId !== undefined && (typeof cubeId !== 'string' || cubeId.trim().length === 0)) {
      return fail('invalid_payload', messages.anchorCubeIdInvalid(anchor.id));
    }
    if (anchor.offset !== undefined) {
      if (!Array.isArray(anchor.offset) || anchor.offset.length !== 3 || !anchor.offset.every(isFiniteNumber)) {
        return fail('invalid_payload', messages.anchorOffsetInvalid(anchor.id));
      }
    }
  }

  const bones = model.bone ? [model.bone] : [];
  const cubes = model.cube ? [model.cube] : [];

  const assertAnchorRef = (anchorId: unknown, label: string): DomainResult<null> | null => {
    if (anchorId === undefined) return null;
    if (typeof anchorId !== 'string' || anchorId.trim().length === 0) {
      return fail('invalid_payload', messages.anchorRefString(label));
    }
    if (anchors.length === 0) {
      return fail('invalid_payload', messages.anchorRequired(label));
    }
    if (!anchorIds.has(anchorId)) {
      return fail('invalid_payload', messages.anchorNotFound(anchorId));
    }
    return null;
  };

  for (const bone of bones) {
    const err = assertAnchorRef(bone?.pivotAnchorId, 'bone pivotAnchorId');
    if (err) return err as DomainResult<{ valid: true }>;
  }

  for (const cube of cubes) {
    const centerErr = assertAnchorRef(cube?.centerAnchorId, 'cube centerAnchorId');
    if (centerErr) return centerErr as DomainResult<{ valid: true }>;
    const originErr = assertAnchorRef(cube?.originAnchorId, 'cube originAnchorId');
    if (originErr) return originErr as DomainResult<{ valid: true }>;
  }

  return ok({ valid: true });
};


