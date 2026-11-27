import {
  CUBE_FACE_DIRECTIONS,
  type CubeFaceDirection,
  type CubeFaces,
  type CubeNode,
  type ProjectDocument,
  type SceneNode,
} from '../../model';
import { cubeUnrotatedBounds } from '../../model';
import { EPSILON, isFiniteNumber, isNonEmptyString, validateVec } from '../shared/value';
import type { FindingSink, InvariantFinding } from '../contract';
import { validateOrientedCubeAuthority } from './orientedCube';

const CUBE_FACE_ROTATIONS = [0, 90, 180, 270] as const;
const CUBE_FACE_DIRECTION_SET = new Set<string>(CUBE_FACE_DIRECTIONS);

type CubeFace = CubeNode['faces'][CubeFaceDirection];
type Texture = ProjectDocument['textures'][string];

const faceIssue = (node: SceneNode, path: string, message: string): InvariantFinding => ({
  code: 'cube.invalid_face',
  severity: 'error',
  message,
  path,
  entityIds: [node.id],
});

const validateCubeBounds = (cube: CubeNode, path: string, add: FindingSink): void => {
  const bounds = cubeUnrotatedBounds(cube);
  const axisBox = cube.geometryMode === 'axis-box';
  const boundsPath = axisBox ? `${path}.bounds` : `${path}.orientedBox`;
  validateVec(
    bounds.from,
    3,
    axisBox ? `${boundsPath}.from` : `${boundsPath}.unrotatedFrom`,
    add,
    cube.id,
  );
  validateVec(
    bounds.to,
    3,
    axisBox ? `${boundsPath}.to` : `${boundsPath}.unrotatedTo`,
    add,
    cube.id,
  );
  if (cube.geometryMode === 'oriented-box') validateOrientedCubeAuthority(cube, path, add);
  if (!isFiniteNumber(cube.inflate)) {
    add({
      code: 'value.not_finite',
      severity: 'error',
      message: 'Cube inflate must be finite.',
      path: `${path}.inflate`,
      entityIds: [cube.id],
    });
  }
  const positiveAxes = bounds.from.reduce(
    (count, from, index) => count + (bounds.to[index] - from > EPSILON ? 1 : 0),
    0,
  );
  const reversedAxis = bounds.from.findIndex((from, index) => bounds.to[index] < from);
  if (reversedAxis >= 0 || positiveAxes < 2) {
    add({
      code: 'cube.invalid_bounds',
      severity: 'error',
      message: 'Cube bounds must not be reversed and must span at least two axes.',
      path: boundsPath,
      entityIds: [cube.id],
    });
  }
};

const validateFaceShape = (
  face: CubeFace,
  cube: CubeNode,
  facePath: string,
  add: FindingSink,
): void => {
  if (typeof face.enabled !== 'boolean') {
    add(faceIssue(cube, `${facePath}.enabled`, 'Face enabled must be a boolean.'));
  }
  if (face.uv) validateVec(face.uv, 4, `${facePath}.uv`, add, cube.id);
  if (
    face.rotation !== undefined &&
    !CUBE_FACE_ROTATIONS.some((rotation) => rotation === face.rotation)
  ) {
    add(
      faceIssue(cube, `${facePath}.rotation`, 'Face rotation must be 0, 90, 180, or 270 degrees.'),
    );
  }
  if (face.cullFace !== undefined && !CUBE_FACE_DIRECTION_SET.has(face.cullFace)) {
    add(
      faceIssue(cube, `${facePath}.cullFace`, 'Face cullFace must be a canonical cube direction.'),
    );
  }
  if (face.tintIndex !== undefined && (!Number.isInteger(face.tintIndex) || face.tintIndex < 0)) {
    add(faceIssue(cube, `${facePath}.tintIndex`, 'Face tintIndex must be a non-negative integer.'));
  }
  if (face.materialInstance !== undefined && !isNonEmptyString(face.materialInstance)) {
    add(
      faceIssue(
        cube,
        `${facePath}.materialInstance`,
        'Face materialInstance must be a non-empty string.',
      ),
    );
  }
};

const validateFaceTextureId = (
  face: CubeFace,
  cube: CubeNode,
  document: ProjectDocument,
  facePath: string,
  add: FindingSink,
): void => {
  if (face.textureId === null) return;
  if (!isNonEmptyString(face.textureId)) {
    add(
      faceIssue(
        cube,
        `${facePath}.textureId`,
        'Face textureId must be a non-empty asset ID or null.',
      ),
    );
  } else if (face.enabled && !document.textures[face.textureId]) {
    add({
      code: 'cube.texture_missing',
      severity: 'error',
      message: `Face references missing texture "${face.textureId}".`,
      path: `${facePath}.textureId`,
      entityIds: [cube.id],
      assetIds: [face.textureId],
    });
  }
};

const isUvOutsideTexture = (uv: unknown, texture: Texture): boolean =>
  !Array.isArray(uv) ||
  uv.length !== 4 ||
  uv[0] < 0 ||
  uv[0] > texture.width ||
  uv[2] < 0 ||
  uv[2] > texture.width ||
  uv[1] < 0 ||
  uv[1] > texture.height ||
  uv[3] < 0 ||
  uv[3] > texture.height;

const validateFaceUvCanvas = (
  face: CubeFace,
  cube: CubeNode,
  document: ProjectDocument,
  facePath: string,
  add: FindingSink,
): void => {
  const faceTexture =
    typeof face.textureId === 'string' ? document.textures[face.textureId] : undefined;
  if (!face.enabled || !faceTexture || !face.uv || !isUvOutsideTexture(face.uv, faceTexture)) {
    return;
  }
  add({
    code: 'cube.invalid_face',
    severity: 'error',
    message: 'Preserved face UV endpoints must stay inside the texture canvas.',
    path: `${facePath}.uv`,
    entityIds: [cube.id],
    assetIds: [faceTexture.id],
  });
};

const validateCubeFace = (
  face: CubeFace | undefined,
  direction: CubeFaceDirection,
  node: SceneNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  const facePath = `${path}.faces.${direction}`;
  if (!face) {
    add(faceIssue(node, facePath, `Node is missing its ${direction} face record.`));
    return;
  }
  validateFaceShape(face, node as CubeNode, facePath, add);
  validateFaceTextureId(face, node as CubeNode, document, facePath, add);
  validateFaceUvCanvas(face, node as CubeNode, document, facePath, add);
};

export const validateBoxFaces = (
  faces: CubeFaces,
  node: SceneNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  const faceRecord = faces as Partial<Record<CubeFaceDirection, CubeFace>>;
  for (const direction of CUBE_FACE_DIRECTIONS) {
    validateCubeFace(faceRecord[direction], direction, node, document, path, add);
  }
};

export const validateCube = (
  cube: CubeNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  validateCubeBounds(cube, path, add);
  validateBoxFaces(cube.faces, cube, document, path, add);
  if (
    cube.lightEmission !== undefined &&
    (!Number.isInteger(cube.lightEmission) || cube.lightEmission < 0 || cube.lightEmission > 15)
  ) {
    add(
      faceIssue(
        cube,
        `${path}.lightEmission`,
        'Cube lightEmission must be an integer between 0 and 15.',
      ),
    );
  }
};
