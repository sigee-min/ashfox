import { buildRigTemplate } from '../../domain/rigTemplates';
import { applyBounds, isZeroSize, snapVec3 } from '../../domain/geometry';
import type { ModelBoneSpec, ModelCubeSpec, ModelSpec } from '../../spec';
import type { ToolResponse } from '../../types';
import { err } from '../../shared/tooling/toolResponse';
import { applyAnchors } from './anchorResolver';
import { DEFAULT_PIVOT, DEFAULT_ROTATION, DEFAULT_SCALE } from './constants';
import type { NormalizedBone, NormalizedCube, NormalizedModel, Vec3 } from './types';
import { isResponseError } from '../../shared/tooling/responseGuards';
import { resolveId } from './idResolver';
import { resolveCubeBounds } from './cubeBounds';
import {
  MODEL_BONE_ID_REQUIRED_EXPLICIT,
  MODEL_BONE_ID_REQUIRED_EXPLICIT_FIX,
  MODEL_BONE_PARENT_MISSING,
  MODEL_CUBE_BOUNDS_MISSING,
  MODEL_CUBE_ID_REQUIRED_EXPLICIT,
  MODEL_CUBE_ID_REQUIRED_EXPLICIT_FIX,
  MODEL_CUBE_PARENT_BONE_MISSING,
  MODEL_CUBE_PARENT_REQUIRED,
  MODEL_CUBE_PARENT_REQUIRED_FIX,
  MODEL_DUPLICATE_BONE_ID,
  MODEL_DUPLICATE_BONE_NAME,
  MODEL_DUPLICATE_ROOT_FIX,
  MODEL_DUPLICATE_CUBE_ID,
  MODEL_DUPLICATE_CUBE_NAME,
  MODEL_REQUIRED,
  TOO_MANY_CUBES
} from '../../shared/messages';

export const normalizeModelSpec = (model: ModelSpec, maxCubes: number): ToolResponse<NormalizedModel> => {
  if (!model || typeof model !== 'object') {
    return err('invalid_payload', MODEL_REQUIRED);
  }

  const warnings: string[] = [];
  const policies = model.policies ?? {};
  const idPolicy = policies.idPolicy ?? 'stable_path';
  const enforceRoot = policies.enforceRoot ?? true;
  let defaultParentId = policies.defaultParentId ?? (enforceRoot ? 'root' : undefined);
  const snapGrid = policies.snap?.grid;
  const bounds = policies.bounds;

  const bones = model.bone ? [model.bone] : [];
  const cubes = model.cube ? [model.cube] : [];
  let error: ToolResponse<NormalizedModel> | null = null;
  const fail = (message: string, fix?: string): null => {
    if (!error) {
      error = err('invalid_payload', message, undefined, fix);
    }
    return null;
  };

  const boneMap = new Map<string, NormalizedBone>();
  const cubeMap = new Map<string, NormalizedCube>();

  const rigTemplate = model.rigTemplate ?? 'empty';
  const templateParts = buildRigTemplate(rigTemplate, []);
  templateParts.forEach((part) => {
    const id = part.id;
    if (!id) return;
    if (!boneMap.has(id)) {
      boneMap.set(id, {
        id,
        name: id,
        parentId: part.parent ?? null,
        pivot: snapVec3(part.pivot ?? DEFAULT_PIVOT, snapGrid),
        rotation: DEFAULT_ROTATION,
        scale: DEFAULT_SCALE,
        explicit: {
          name: false,
          parentId: part.parent !== undefined,
          pivot: part.pivot !== undefined,
          rotation: false,
          scale: false,
          visibility: false
        }
      });
    }
    if (isZeroSize(part.size)) return;
    const from: Vec3 = [part.offset[0], part.offset[1], part.offset[2]];
    const to: Vec3 = [part.offset[0] + part.size[0], part.offset[1] + part.size[1], part.offset[2] + part.size[2]];
    if (!cubeMap.has(id)) {
      cubeMap.set(id, {
        id,
        name: id,
        parentId: id,
        from: snapVec3(from, snapGrid),
        to: snapVec3(to, snapGrid),
        origin: snapVec3(part.pivot ?? DEFAULT_PIVOT, snapGrid),
        originFromSpec: part.pivot !== undefined,
        rotation: DEFAULT_ROTATION,
        inflate: part.inflate,
        mirror: part.mirror,
        explicit: {
          name: false,
          parentId: true,
          fromTo: true,
          origin: part.pivot !== undefined,
          rotation: false,
          inflate: part.inflate !== undefined,
          mirror: part.mirror !== undefined,
          visibility: false,
          boxUv: false,
          uvOffset: false
        }
      });
    }
  });

  const resolveBone = (spec: ModelBoneSpec, index: number): NormalizedBone | null => {
    const parentId = spec.parentId === undefined ? (spec.id === 'root' ? null : defaultParentId) : spec.parentId;
    const id = resolveId('bone', spec.id, spec.name, parentId, index, idPolicy);
    if (!id) {
      return fail(
        MODEL_BONE_ID_REQUIRED_EXPLICIT,
        MODEL_BONE_ID_REQUIRED_EXPLICIT_FIX
      );
    }
    const name = spec.name ?? id;
    return {
      id,
      name,
      parentId: parentId ?? null,
      pivot: snapVec3(spec.pivot ?? DEFAULT_PIVOT, snapGrid),
      pivotAnchorId: spec.pivotAnchorId,
      rotation: spec.rotation ?? DEFAULT_ROTATION,
      scale: spec.scale ?? DEFAULT_SCALE,
      visibility: spec.visibility,
      explicit: {
        name: spec.name !== undefined,
        parentId: spec.parentId !== undefined,
        pivot: spec.pivot !== undefined || spec.pivotAnchorId !== undefined,
        rotation: spec.rotation !== undefined,
        scale: spec.scale !== undefined,
        visibility: spec.visibility !== undefined
      }
    };
  };

  const resolveCube = (spec: ModelCubeSpec, index: number): NormalizedCube | null => {
    const parentId = spec.parentId ?? defaultParentId;
    if (!parentId) {
      return fail(MODEL_CUBE_PARENT_REQUIRED, MODEL_CUBE_PARENT_REQUIRED_FIX);
    }
    const id = resolveId('cube', spec.id, spec.name, parentId, index, idPolicy);
    if (!id) {
      return fail(
        MODEL_CUBE_ID_REQUIRED_EXPLICIT,
        MODEL_CUBE_ID_REQUIRED_EXPLICIT_FIX
      );
    }
    const boundsRes = resolveCubeBounds(spec);
    if (!boundsRes) return fail(MODEL_CUBE_BOUNDS_MISSING(spec.name ?? id));
    const from = snapVec3(boundsRes.from, snapGrid);
    const to = snapVec3(boundsRes.to, snapGrid);
    const center: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    const origin = snapVec3(spec.origin ?? center, snapGrid);
    return {
      id,
      name: spec.name ?? id,
      parentId,
      from,
      to,
      origin,
      originFromSpec: spec.origin !== undefined,
      originAnchorId: spec.originAnchorId,
      centerAnchorId: spec.centerAnchorId,
      rotation: spec.rotation ?? DEFAULT_ROTATION,
      inflate: spec.inflate,
      mirror: spec.mirror,
      visibility: spec.visibility,
      boxUv: spec.boxUv,
      uvOffset: spec.uvOffset,
      explicit: {
        name: spec.name !== undefined,
        parentId: spec.parentId !== undefined,
        fromTo: boundsRes.explicit || spec.centerAnchorId !== undefined,
        origin: spec.origin !== undefined || spec.originAnchorId !== undefined,
        rotation: spec.rotation !== undefined,
        inflate: spec.inflate !== undefined,
        mirror: spec.mirror !== undefined,
        visibility: spec.visibility !== undefined,
        boxUv: spec.boxUv !== undefined,
        uvOffset: spec.uvOffset !== undefined
      }
    };
  };

  bones.forEach((bone, index) => {
    const resolved = resolveBone(bone, index);
    if (!resolved) return;
    boneMap.set(resolved.id, resolved);
  });
  if (error) return error;

  const resolveRootNameId = () => {
    for (const bone of boneMap.values()) {
      if (bone.name === 'root') return bone.id;
    }
    return null;
  };

  const rootNameId = resolveRootNameId();
  if (enforceRoot && !boneMap.has('root') && rootNameId && defaultParentId === 'root') {
    for (const bone of boneMap.values()) {
      if (!bone.explicit.parentId && bone.parentId === 'root') {
        bone.parentId = rootNameId;
      }
    }
    defaultParentId = rootNameId;
  }

  cubes.forEach((cube, index) => {
    const resolved = resolveCube(cube, index);
    if (!resolved) return;
    cubeMap.set(resolved.id, resolved);
  });
  if (error) return error;

  if (enforceRoot && !boneMap.has('root') && !rootNameId) {
    boneMap.set('root', {
      id: 'root',
      name: 'root',
      parentId: null,
      pivot: DEFAULT_PIVOT,
      rotation: DEFAULT_ROTATION,
      scale: DEFAULT_SCALE,
      explicit: {
        name: false,
        parentId: false,
        pivot: false,
        rotation: false,
        scale: false,
        visibility: false
      }
    });
  }

  const boneIds = new Set<string>();
  const boneNames = new Set<string>();
  for (const bone of boneMap.values()) {
    if (boneIds.has(bone.id)) return err('invalid_payload', MODEL_DUPLICATE_BONE_ID(bone.id));
    boneIds.add(bone.id);
    if (boneNames.has(bone.name)) {
      const fix = bone.name === 'root' && enforceRoot ? MODEL_DUPLICATE_ROOT_FIX : undefined;
      return err('invalid_payload', MODEL_DUPLICATE_BONE_NAME(bone.name), undefined, fix);
    }
    boneNames.add(bone.name);
  }

  const cubeIds = new Set<string>();
  const cubeNames = new Set<string>();
  for (const cube of cubeMap.values()) {
    if (cubeIds.has(cube.id)) return err('invalid_payload', MODEL_DUPLICATE_CUBE_ID(cube.id));
    cubeIds.add(cube.id);
    if (cubeNames.has(cube.name)) return err('invalid_payload', MODEL_DUPLICATE_CUBE_NAME(cube.name));
    cubeNames.add(cube.name);
  }

  for (const bone of boneMap.values()) {
    if (bone.parentId && !boneMap.has(bone.parentId)) {
      return err('invalid_payload', MODEL_BONE_PARENT_MISSING(bone.parentId));
    }
  }

  for (const cube of cubeMap.values()) {
    if (!boneMap.has(cube.parentId)) {
      return err('invalid_payload', MODEL_CUBE_PARENT_BONE_MISSING(cube.parentId));
    }
  }

  const anchorRes = applyAnchors(model, boneMap, cubeMap);
  if (isResponseError(anchorRes)) return anchorRes;

  if (cubeMap.size > maxCubes) {
    return err('invalid_payload', TOO_MANY_CUBES(cubeMap.size, maxCubes));
  }

  const boundedBones = Array.from(boneMap.values()).map((bone) => ({
    ...bone,
    pivot: applyBounds(snapVec3(bone.pivot, snapGrid), bounds),
    rotation: bone.rotation,
    scale: bone.scale
  }));

  const boundedCubes = Array.from(cubeMap.values()).map((cube) => ({
    ...cube,
    from: applyBounds(snapVec3(cube.from, snapGrid), bounds),
    to: applyBounds(snapVec3(cube.to, snapGrid), bounds),
    origin: applyBounds(snapVec3(cube.origin, snapGrid), bounds)
  }));

  return { ok: true, data: { bones: boundedBones, cubes: boundedCubes, warnings } };
};





