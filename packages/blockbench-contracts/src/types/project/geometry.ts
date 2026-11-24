import { MESH_UV_POLICY_LIMITS } from '../../mcpSchemas/constants';
import type { TrackedBone, TrackedCube, TrackedCubeFace, TrackedMesh } from './index';
import { MESH_SYMMETRY_AXES } from './index';
import {
  hasShape,
  isArrayOf,
  isBoolean,
  isClosedContractRecord,
  isCubeFaceDirection,
  isEnumValue,
  isFiniteNumber,
  isFiniteNumberInRange,
  isString,
  isStringArray,
  isVec2,
  isVec3,
  isVec4,
  optional,
} from './shared';

export const isTrackedBoneContract = (value: unknown): value is TrackedBone =>
  isClosedContractRecord(value) &&
  hasShape(value, ['name', 'pivot'], ['id', 'parent', 'rotation', 'scale', 'visibility']) &&
  isString(value.name) &&
  isVec3(value.pivot) &&
  optional(value, 'id', isString) &&
  optional(value, 'parent', isString) &&
  optional(value, 'rotation', isVec3) &&
  optional(value, 'scale', isVec3) &&
  optional(value, 'visibility', isBoolean);

export const isTrackedCubeFaceContract = (value: unknown): value is TrackedCubeFace =>
  isClosedContractRecord(value) &&
  hasShape(
    value,
    ['enabled'],
    ['texture', 'uv', 'rotation', 'cullface', 'tintIndex', 'materialInstance'],
  ) &&
  isBoolean(value.enabled) &&
  optional(
    value,
    'texture',
    (entry): entry is string | false | null =>
      entry === false || entry === null || typeof entry === 'string',
  ) &&
  optional(value, 'uv', isVec4) &&
  optional(
    value,
    'rotation',
    (entry): entry is 0 | 90 | 180 | 270 =>
      entry === 0 || entry === 90 || entry === 180 || entry === 270,
  ) &&
  optional(value, 'cullface', isCubeFaceDirection) &&
  optional(value, 'tintIndex', isFiniteNumber) &&
  optional(value, 'materialInstance', isString);

const isTrackedCubeFaces = (value: unknown): value is NonNullable<TrackedCube['faces']> =>
  isClosedContractRecord(value) &&
  Object.keys(value).every(
    (key) => isCubeFaceDirection(key) && isTrackedCubeFaceContract(value[key]),
  );

export const isTrackedCubeContract = (value: unknown): value is TrackedCube =>
  isClosedContractRecord(value) &&
  hasShape(
    value,
    ['name', 'from', 'to', 'bone'],
    [
      'id',
      'origin',
      'rotation',
      'uv',
      'uvOffset',
      'inflate',
      'mirror',
      'visibility',
      'boxUv',
      'shade',
      'lightEmission',
      'rescale',
      'faces',
    ],
  ) &&
  isString(value.name) &&
  isVec3(value.from) &&
  isVec3(value.to) &&
  isString(value.bone) &&
  optional(value, 'id', isString) &&
  optional(value, 'origin', isVec3) &&
  optional(value, 'rotation', isVec3) &&
  optional(value, 'uv', isVec2) &&
  optional(value, 'uvOffset', isVec2) &&
  optional(value, 'inflate', isFiniteNumber) &&
  optional(value, 'mirror', isBoolean) &&
  optional(value, 'visibility', isBoolean) &&
  optional(value, 'boxUv', isBoolean) &&
  optional(value, 'shade', isBoolean) &&
  optional(value, 'lightEmission', isFiniteNumber) &&
  optional(value, 'rescale', isBoolean) &&
  optional(value, 'faces', isTrackedCubeFaces);

const isMeshUvPolicy = (value: unknown): value is NonNullable<TrackedMesh['uvPolicy']> =>
  isClosedContractRecord(value) &&
  hasShape(value, [], ['symmetryAxis', 'texelDensity', 'padding']) &&
  optional(
    value,
    'symmetryAxis',
    (entry): entry is NonNullable<TrackedMesh['uvPolicy']>['symmetryAxis'] =>
      isEnumValue(MESH_SYMMETRY_AXES, entry),
  ) &&
  optional(value, 'texelDensity', (entry) =>
    isFiniteNumberInRange(
      entry,
      MESH_UV_POLICY_LIMITS.minTexelDensity,
      MESH_UV_POLICY_LIMITS.maxTexelDensity,
    ),
  ) &&
  optional(value, 'padding', (entry) =>
    isFiniteNumberInRange(
      entry,
      MESH_UV_POLICY_LIMITS.minPadding,
      MESH_UV_POLICY_LIMITS.maxPadding,
    ),
  );

const isTrackedMeshVertex = (value: unknown): value is TrackedMesh['vertices'][number] =>
  isClosedContractRecord(value) &&
  hasShape(value, ['id', 'pos']) &&
  isString(value.id) &&
  isVec3(value.pos);

const isTrackedMeshFaceUv = (
  value: unknown,
): value is NonNullable<TrackedMesh['faces'][number]['uv']>[number] =>
  isClosedContractRecord(value) &&
  hasShape(value, ['vertexId', 'uv']) &&
  isString(value.vertexId) &&
  isVec2(value.uv);

const isTrackedMeshFace = (value: unknown): value is TrackedMesh['faces'][number] =>
  isClosedContractRecord(value) &&
  hasShape(value, ['vertices'], ['id', 'uv', 'texture']) &&
  isStringArray(value.vertices) &&
  optional(value, 'id', isString) &&
  optional(value, 'uv', (entry) => isArrayOf(entry, isTrackedMeshFaceUv)) &&
  optional(
    value,
    'texture',
    (entry): entry is string | false => entry === false || typeof entry === 'string',
  );

export const isTrackedMeshContract = (value: unknown): value is TrackedMesh =>
  isClosedContractRecord(value) &&
  hasShape(
    value,
    ['name', 'vertices', 'faces'],
    ['id', 'bone', 'origin', 'rotation', 'visibility', 'uvPolicy'],
  ) &&
  isString(value.name) &&
  isArrayOf(value.vertices, isTrackedMeshVertex) &&
  isArrayOf(value.faces, isTrackedMeshFace) &&
  optional(value, 'id', isString) &&
  optional(value, 'bone', isString) &&
  optional(value, 'origin', isVec3) &&
  optional(value, 'rotation', isVec3) &&
  optional(value, 'visibility', isBoolean) &&
  optional(value, 'uvPolicy', isMeshUvPolicy);
