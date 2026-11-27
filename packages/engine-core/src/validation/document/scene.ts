import { isClosedContractRecord } from '@ashfox/internal-contracts';

import { CUBE_FACE_DIRECTIONS, PLANE_FACE_DIRECTIONS } from '../../model';
import {
  closedRecord,
  expectBoolean,
  expectFiniteNumber,
  expectLiteral,
  expectNullableString,
  expectNumericTuple,
  expectString,
  expectStringArray,
  hasOwn,
  reject,
  validateRecordMap,
  type ContractContext,
  type ContractRecord,
} from './shared';

const BASE_REQUIRED = ['id', 'kind', 'name', 'parentId', 'transform', 'visible'];
const BASE_OPTIONAL = ['tags'];
const CUBE_OPTIONAL = [...BASE_OPTIONAL, 'uvOffset', 'rescale', 'shade', 'lightEmission'];
const CUBE_SHAPE_KEYS = ['inflate', 'mirror', 'boxUv', 'faces'];
const ORIENTED_BOX_KEYS = [
  'unrotatedFrom',
  'unrotatedTo',
  'pivot',
  'rotation',
  'cornerDenominator',
  'cornerNumerators',
  'cornerDigest',
  'faceChartDigest',
  'coverProofDigest',
];
const ORIENTED_DIGEST_KEYS = ['cornerDigest', 'faceChartDigest', 'coverProofDigest'] as const;

const validateTransform = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(value, path, ['position', 'rotation', 'scale', 'pivot'], [], context);
  if (!record) return;
  expectNumericTuple(record.position, 3, `${path}.position`, context);
  expectNumericTuple(record.rotation, 3, `${path}.rotation`, context);
  expectNumericTuple(record.scale, 3, `${path}.scale`, context);
  expectNumericTuple(record.pivot, 3, `${path}.pivot`, context);
};

const validatePlaneBasis = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(
    value,
    path,
    ['normal', 'uAxis', 'vAxis', 'orientation'],
    [],
    context,
  );
  if (!record) return;
  expectNumericTuple(record.normal, 3, `${path}.normal`, context);
  expectNumericTuple(record.uAxis, 3, `${path}.uAxis`, context);
  expectNumericTuple(record.vAxis, 3, `${path}.vAxis`, context);
  expectLiteral(
    record.orientation,
    ['normal', 'mirror-u', 'mirror-v', 'rotate-90'],
    `${path}.orientation`,
    context,
  );
};

const validateCubeFace = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(
    value,
    path,
    ['enabled', 'textureId'],
    ['uv', 'rotation', 'cullFace', 'tintIndex', 'materialInstance'],
    context,
  );
  if (!record) return;
  expectBoolean(record.enabled, `${path}.enabled`, context);
  expectNullableString(record.textureId, `${path}.textureId`, context);
  if (hasOwn(record, 'uv')) {
    expectNumericTuple(record.uv, 4, `${path}.uv`, context);
  }
  if (hasOwn(record, 'rotation')) {
    expectLiteral(record.rotation, [0, 90, 180, 270], `${path}.rotation`, context);
  }
  if (hasOwn(record, 'cullFace')) {
    expectLiteral(record.cullFace, CUBE_FACE_DIRECTIONS, `${path}.cullFace`, context);
  }
  if (hasOwn(record, 'tintIndex')) {
    expectFiniteNumber(record.tintIndex, `${path}.tintIndex`, context);
  }
  if (hasOwn(record, 'materialInstance')) {
    expectString(record.materialInstance, `${path}.materialInstance`, context);
  }
};

const validateFaces = (
  value: unknown,
  path: string,
  directions: readonly string[],
  context: ContractContext,
): void => {
  const record = closedRecord(value, path, directions, [], context);
  if (!record) return;
  for (const direction of directions) {
    validateCubeFace(record[direction], `${path}.${direction}`, context);
  }
};

const cubeNodeRecord = (
  value: ContractRecord,
  path: string,
  context: ContractContext,
): ContractRecord | null => {
  if (value.geometryMode === 'axis-box') {
    const required = [...BASE_REQUIRED, 'geometryMode', 'bounds', ...CUBE_SHAPE_KEYS];
    return closedRecord(value, path, required, CUBE_OPTIONAL, context);
  }
  if (value.geometryMode === 'oriented-box') {
    const required = [...BASE_REQUIRED, 'geometryMode', 'orientedBox', ...CUBE_SHAPE_KEYS];
    return closedRecord(value, path, required, CUBE_OPTIONAL, context);
  }
  reject(
    context,
    `${path}.geometryMode`,
    'Cube geometryMode must be axis-box or oriented-box.',
    'scene.invalid_kind',
  );
  return null;
};

const unsupportedNodeRecord = (
  value: ContractRecord,
  path: string,
  context: ContractContext,
): ContractRecord | null => {
  const record = closedRecord(value, path, BASE_REQUIRED, BASE_OPTIONAL, context);
  reject(
    context,
    `${path}.kind`,
    `Unsupported scene node kind "${String(value.kind)}".`,
    'scene.invalid_kind',
  );
  return record;
};

type NodeRecordReader = (
  value: ContractRecord,
  path: string,
  context: ContractContext,
) => ContractRecord | null;

const NODE_RECORD_READERS: Readonly<Record<string, NodeRecordReader>> = {
  bone: (value, path, context) =>
    closedRecord(value, path, BASE_REQUIRED, [...BASE_OPTIONAL, 'canonicalFrame'], context),
  locator: (value, path, context) =>
    closedRecord(value, path, BASE_REQUIRED, [...BASE_OPTIONAL, 'ignoreInheritedScale'], context),
  cube: cubeNodeRecord,
  taper: (value, path, context) =>
    closedRecord(
      value,
      path,
      [...BASE_REQUIRED, 'bounds', 'topScale', 'axis', 'inflate', 'mirror', 'faces'],
      BASE_OPTIONAL,
      context,
    ),
  wedge: (value, path, context) =>
    closedRecord(
      value,
      path,
      [...BASE_REQUIRED, 'bounds', 'slope', 'inflate', 'mirror', 'faces'],
      BASE_OPTIONAL,
      context,
    ),
  cylinder: (value, path, context) =>
    closedRecord(
      value,
      path,
      [...BASE_REQUIRED, 'origin', 'radius', 'radiusTop', 'height', 'sides', 'axis', 'faces'],
      BASE_OPTIONAL,
      context,
    ),
  plane: (value, path, context) =>
    closedRecord(
      value,
      path,
      [...BASE_REQUIRED, 'size', 'sidedness', 'coverageId', 'faces'],
      [...BASE_OPTIONAL, 'basis'],
      context,
    ),
};

const nodeRecord = (
  value: ContractRecord,
  path: string,
  context: ContractContext,
): ContractRecord | null => {
  const kind = String(value.kind);
  const reader = hasOwn(NODE_RECORD_READERS, kind)
    ? NODE_RECORD_READERS[kind]
    : unsupportedNodeRecord;
  return reader(value, path, context);
};

const validateCanonicalFrame = (value: unknown, path: string, context: ContractContext): void => {
  const frame = closedRecord(
    value,
    path,
    ['origin', 'xAxis', 'yAxis', 'zAxis', 'determinant', 'rotation'],
    [],
    context,
  );
  if (!frame) return;
  for (const axis of ['origin', 'xAxis', 'yAxis', 'zAxis'] as const) {
    expectNumericTuple(frame[axis], 3, `${path}.${axis}`, context);
  }
  expectNumericTuple(frame.rotation, 3, `${path}.rotation`, context);
  if (frame.determinant !== 1 && frame.determinant !== -1) {
    reject(context, `${path}.determinant`, `${path}.determinant must be 1 or -1.`);
  }
};

const validateAxisBounds = (value: unknown, path: string, context: ContractContext): void => {
  const bounds = closedRecord(value, path, ['from', 'to'], [], context);
  if (!bounds) return;
  expectNumericTuple(bounds.from, 3, `${path}.from`, context);
  expectNumericTuple(bounds.to, 3, `${path}.to`, context);
};

const validateOrientedRotation = (value: unknown, path: string, context: ContractContext): void => {
  const rotation = closedRecord(value, path, ['axis', 'angle22_5Units'], [], context);
  if (!rotation) return;
  if (!['x', 'y', 'z'].includes(String(rotation.axis))) {
    reject(context, `${path}.axis`, 'Oriented axis must be x, y, or z.');
  }
  if (![-2, -1, 1, 2].includes(Number(rotation.angle22_5Units))) {
    reject(
      context,
      `${path}.angle22_5Units`,
      'Oriented rotation must be a supported 22.5-degree tick.',
    );
  }
};

const isExactCorner = (corner: unknown): boolean =>
  Array.isArray(corner) &&
  corner.length === 3 &&
  corner.every((entry) => typeof entry === 'string');

const validateCornerNumerators = (value: unknown, path: string, context: ContractContext): void => {
  if (Array.isArray(value) && value.length === 8 && value.every(isExactCorner)) return;
  reject(context, path, 'Oriented box must carry eight exact string corner tuples.');
};

const validateOrientedBox = (value: unknown, path: string, context: ContractContext): void => {
  const oriented = closedRecord(value, path, ORIENTED_BOX_KEYS, [], context);
  if (!oriented) return;
  expectNumericTuple(oriented.unrotatedFrom, 3, `${path}.unrotatedFrom`, context);
  expectNumericTuple(oriented.unrotatedTo, 3, `${path}.unrotatedTo`, context);
  expectNumericTuple(oriented.pivot, 3, `${path}.pivot`, context);
  validateOrientedRotation(oriented.rotation, `${path}.rotation`, context);
  expectFiniteNumber(oriented.cornerDenominator, `${path}.cornerDenominator`, context);
  validateCornerNumerators(oriented.cornerNumerators, `${path}.cornerNumerators`, context);
  for (const key of ORIENTED_DIGEST_KEYS) {
    expectString(oriented[key], `${path}.${key}`, context);
  }
};

const validateCubeGeometry = (record: ContractRecord, path: string, context: ContractContext) => {
  expectString(record.geometryMode, `${path}.geometryMode`, context);
  if (record.geometryMode === 'axis-box') {
    validateAxisBounds(record.bounds, `${path}.bounds`, context);
  } else if (record.geometryMode === 'oriented-box') {
    validateOrientedBox(record.orientedBox, `${path}.orientedBox`, context);
  }
};

const validateCubeNode = (record: ContractRecord, path: string, context: ContractContext): void => {
  validateCubeGeometry(record, path, context);
  expectFiniteNumber(record.inflate, `${path}.inflate`, context);
  expectBoolean(record.mirror, `${path}.mirror`, context);
  expectBoolean(record.boxUv, `${path}.boxUv`, context);
  validateFaces(record.faces, `${path}.faces`, CUBE_FACE_DIRECTIONS, context);
  if (hasOwn(record, 'uvOffset')) {
    expectNumericTuple(record.uvOffset, 2, `${path}.uvOffset`, context);
  }
  if (hasOwn(record, 'rescale')) {
    expectBoolean(record.rescale, `${path}.rescale`, context);
  }
  if (hasOwn(record, 'shade')) {
    expectBoolean(record.shade, `${path}.shade`, context);
  }
  if (hasOwn(record, 'lightEmission')) {
    expectFiniteNumber(record.lightEmission, `${path}.lightEmission`, context);
  }
};

const validatePlaneNode = (
  record: ContractRecord,
  path: string,
  context: ContractContext,
): void => {
  if (hasOwn(record, 'basis')) {
    validatePlaneBasis(record.basis, `${path}.basis`, context);
  }
  expectNumericTuple(record.size, 2, `${path}.size`, context);
  expectLiteral(record.sidedness, ['front', 'double'], `${path}.sidedness`, context);
  expectString(record.coverageId, `${path}.coverageId`, context);
  validateFaces(record.faces, `${path}.faces`, PLANE_FACE_DIRECTIONS, context);
};

const validateKindFields = (
  kind: unknown,
  record: ContractRecord,
  path: string,
  context: ContractContext,
): void => {
  if (kind === 'bone' && hasOwn(record, 'canonicalFrame')) {
    validateCanonicalFrame(record.canonicalFrame, `${path}.canonicalFrame`, context);
  }
  if (kind === 'locator' && hasOwn(record, 'ignoreInheritedScale')) {
    expectBoolean(record.ignoreInheritedScale, `${path}.ignoreInheritedScale`, context);
  }
  if (kind === 'cube') validateCubeNode(record, path, context);
  if (kind === 'taper') {
    validateAxisBounds(record.bounds, `${path}.bounds`, context);
    expectNumericTuple(record.topScale, 2, `${path}.topScale`, context);
    expectLiteral(record.axis, ['x', 'y', 'z'], `${path}.axis`, context);
    expectFiniteNumber(record.inflate, `${path}.inflate`, context);
    expectBoolean(record.mirror, `${path}.mirror`, context);
    validateFaces(record.faces, `${path}.faces`, CUBE_FACE_DIRECTIONS, context);
  }
  if (kind === 'wedge') {
    validateAxisBounds(record.bounds, `${path}.bounds`, context);
    expectLiteral(record.slope, ['north', 'south', 'east', 'west'], `${path}.slope`, context);
    expectFiniteNumber(record.inflate, `${path}.inflate`, context);
    expectBoolean(record.mirror, `${path}.mirror`, context);
    validateFaces(record.faces, `${path}.faces`, CUBE_FACE_DIRECTIONS, context);
  }
  if (kind === 'cylinder') {
    expectNumericTuple(record.origin, 3, `${path}.origin`, context);
    expectFiniteNumber(record.radius, `${path}.radius`, context);
    expectFiniteNumber(record.radiusTop, `${path}.radiusTop`, context);
    expectFiniteNumber(record.height, `${path}.height`, context);
    expectLiteral(record.sides, [6, 8, 12], `${path}.sides`, context);
    expectLiteral(record.axis, ['x', 'y', 'z'], `${path}.axis`, context);
    validateFaces(record.faces, `${path}.faces`, CUBE_FACE_DIRECTIONS, context);
  }
  if (kind === 'plane') validatePlaneNode(record, path, context);
};

const validateSceneNode = (value: unknown, path: string, context: ContractContext): void => {
  if (!isClosedContractRecord(value)) {
    reject(context, path, `${path} must be a scene node object.`);
    return;
  }
  const record = nodeRecord(value, path, context);
  if (!record) return;
  expectString(record.id, `${path}.id`, context);
  expectString(record.name, `${path}.name`, context);
  expectNullableString(record.parentId, `${path}.parentId`, context);
  expectBoolean(record.visible, `${path}.visible`, context);
  validateTransform(record.transform, `${path}.transform`, context);
  if (hasOwn(record, 'tags')) {
    expectStringArray(record.tags, `${path}.tags`, context);
  }
  validateKindFields(value.kind, record, path, context);
};

export const validateScene = (value: unknown, context: ContractContext): void => {
  const record = closedRecord(value, 'scene', ['roots', 'nodes'], [], context);
  if (!record) return;
  expectStringArray(record.roots, 'scene.roots', context);
  validateRecordMap(record.nodes, 'scene.nodes', context, (entry, path) => {
    validateSceneNode(entry, path, context);
  });
};
