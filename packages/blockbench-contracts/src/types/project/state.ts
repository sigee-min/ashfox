import { isNonEmptyContractText } from '@ashfox/internal-contracts';

import type {
  ProjectState,
  ProjectTextureUsage,
  TrackedAnimation,
  TrackedBone,
  TrackedCube,
  TrackedMesh,
  TrackedTexture,
} from './index';
import { FORMAT_KINDS } from '../shared';
import { isTrackedAnimationContract, isTrackedTextureContract } from './assets';
import { isTrackedBoneContract, isTrackedCubeContract, isTrackedMeshContract } from './geometry';
import {
  hasShape,
  isArrayOf,
  isBoolean,
  isClosedContractRecord,
  isCubeFaceDirection,
  isEnumValue,
  isFiniteNumber,
  isNonNegativeInteger,
  isNullableString,
  isString,
  isVec4,
  type ValueGuard,
} from './shared';

const isStateCounts = (value: unknown): value is ProjectState['counts'] =>
  isClosedContractRecord(value) &&
  hasShape(
    value,
    ['bones', 'cubes', 'textures', 'animations'],
    ['meshes', 'meshVertices', 'meshFaces'],
  ) &&
  isNonNegativeInteger(value.bones) &&
  isNonNegativeInteger(value.cubes) &&
  isNonNegativeInteger(value.textures) &&
  isNonNegativeInteger(value.animations) &&
  (value.meshes === undefined || isNonNegativeInteger(value.meshes)) &&
  (value.meshVertices === undefined || isNonNegativeInteger(value.meshVertices)) &&
  (value.meshFaces === undefined || isNonNegativeInteger(value.meshFaces));

const isTextureResolution = (
  value: unknown,
): value is NonNullable<ProjectState['textureResolution']> =>
  isClosedContractRecord(value) &&
  hasShape(value, ['width', 'height']) &&
  isNonNegativeInteger(value.width) &&
  isNonNegativeInteger(value.height);

const isTextureUsageFace = (
  value: unknown,
): value is ProjectTextureUsage['textures'][number]['cubes'][number]['faces'][number] =>
  isClosedContractRecord(value) &&
  hasShape(value, ['face'], ['uv']) &&
  isCubeFaceDirection(value.face) &&
  (value.uv === undefined || isVec4(value.uv));

const isTextureUsageCube = (
  value: unknown,
): value is ProjectTextureUsage['textures'][number]['cubes'][number] =>
  isClosedContractRecord(value) &&
  hasShape(value, ['name', 'faces'], ['id']) &&
  isString(value.name) &&
  isArrayOf(value.faces, isTextureUsageFace) &&
  (value.id === undefined || isString(value.id));

const isTextureUsageEntry = (value: unknown): value is ProjectTextureUsage['textures'][number] => {
  if (
    !isClosedContractRecord(value) ||
    !hasShape(value, ['name', 'cubeCount', 'faceCount', 'cubes'], ['id', 'width', 'height']) ||
    !isString(value.name) ||
    !isNonNegativeInteger(value.cubeCount) ||
    !isNonNegativeInteger(value.faceCount) ||
    !isArrayOf(value.cubes, isTextureUsageCube) ||
    !(value.id === undefined || isString(value.id)) ||
    !(value.width === undefined || isNonNegativeInteger(value.width)) ||
    !(value.height === undefined || isNonNegativeInteger(value.height))
  ) {
    return false;
  }
  return (
    value.cubeCount === value.cubes.length &&
    value.faceCount === value.cubes.reduce((count, cube) => count + cube.faces.length, 0)
  );
};

const isTextureUsageUnresolved = (
  value: unknown,
): value is NonNullable<ProjectTextureUsage['unresolved']>[number] =>
  isClosedContractRecord(value) &&
  hasShape(value, ['textureRef', 'cubeName', 'face'], ['cubeId']) &&
  isString(value.textureRef) &&
  isString(value.cubeName) &&
  isCubeFaceDirection(value.face) &&
  (value.cubeId === undefined || isString(value.cubeId));

const isProjectTextureUsage = (value: unknown): value is ProjectTextureUsage =>
  isClosedContractRecord(value) &&
  hasShape(value, ['textures'], ['unresolved']) &&
  isArrayOf(value.textures, isTextureUsageEntry) &&
  (value.unresolved === undefined || isArrayOf(value.unresolved, isTextureUsageUnresolved));

const readOptionalArray = <T>(
  value: unknown,
  guard: ValueGuard<T>,
): readonly T[] | undefined | null => {
  if (value === undefined) return undefined;
  return isArrayOf(value, guard) ? value : null;
};

export const isProjectStateContract = (value: unknown): value is ProjectState => {
  if (
    !isClosedContractRecord(value) ||
    !hasShape(
      value,
      ['id', 'active', 'name', 'format', 'revision', 'counts'],
      [
        'formatId',
        'dirty',
        'textureResolution',
        'uvPixelsPerBlock',
        'textureUsage',
        'bones',
        'cubes',
        'meshes',
        'textures',
        'animations',
      ],
    ) ||
    !isNonEmptyContractText(value.id) ||
    !isBoolean(value.active) ||
    !isNullableString(value.name) ||
    !(value.format === null || isEnumValue(FORMAT_KINDS, value.format)) ||
    !isNonEmptyContractText(value.revision) ||
    !isStateCounts(value.counts) ||
    !(value.formatId === undefined || isNullableString(value.formatId)) ||
    !(value.dirty === undefined || isBoolean(value.dirty)) ||
    !(value.textureResolution === undefined || isTextureResolution(value.textureResolution)) ||
    !(value.uvPixelsPerBlock === undefined || isFiniteNumber(value.uvPixelsPerBlock)) ||
    !(value.textureUsage === undefined || isProjectTextureUsage(value.textureUsage))
  ) {
    return false;
  }
  const bones = readOptionalArray<TrackedBone>(value.bones, isTrackedBoneContract);
  const cubes = readOptionalArray<TrackedCube>(value.cubes, isTrackedCubeContract);
  const meshes = readOptionalArray<TrackedMesh>(value.meshes, isTrackedMeshContract);
  const textures = readOptionalArray<TrackedTexture>(value.textures, isTrackedTextureContract);
  const animations = readOptionalArray<TrackedAnimation>(
    value.animations,
    isTrackedAnimationContract,
  );
  if (
    bones === null ||
    cubes === null ||
    meshes === null ||
    textures === null ||
    animations === null
  )
    return false;
  const meshVertexCount = meshes?.reduce((sum, mesh) => sum + mesh.vertices.length, 0);
  const meshFaceCount = meshes?.reduce((sum, mesh) => sum + mesh.faces.length, 0);
  return (
    (!bones || bones.length === value.counts.bones) &&
    (!cubes || cubes.length === value.counts.cubes) &&
    (!meshes ||
      (value.counts.meshes === meshes.length &&
        value.counts.meshVertices === meshVertexCount &&
        value.counts.meshFaces === meshFaceCount)) &&
    (!textures || textures.length === value.counts.textures) &&
    (!animations || animations.length === value.counts.animations)
  );
};

export const isProjectStateCountsContract = isStateCounts;
export const isProjectTextureResolutionContract = isTextureResolution;
