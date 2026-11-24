import {
  CUBE_FACE_DIRECTIONS,
  type CubeFaceDirection,
  type CubeNode,
  type ProjectDocument,
} from '../../model';
import { cubeUnrotatedBounds } from '../../model';
import { EPSILON, isFiniteNumber, isNonEmptyString, validateVec } from '../shared/value';
import type { FindingSink } from '../contract';
import { validateOrientedCubeAuthority } from './orientedCube';

const CUBE_FACE_ROTATIONS = [0, 90, 180, 270] as const;
const CUBE_FACE_DIRECTION_SET = new Set<string>(CUBE_FACE_DIRECTIONS);

export const validateCube = (
  cube: CubeNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  const bounds = cubeUnrotatedBounds(cube);
  const boundsPath = cube.geometryMode === 'axis-box' ? `${path}.bounds` : `${path}.orientedBox`;
  validateVec(
    bounds.from,
    3,
    cube.geometryMode === 'axis-box' ? `${boundsPath}.from` : `${boundsPath}.unrotatedFrom`,
    add,
    cube.id,
  );
  validateVec(
    bounds.to,
    3,
    cube.geometryMode === 'axis-box' ? `${boundsPath}.to` : `${boundsPath}.unrotatedTo`,
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

  const faceRecord = cube.faces as Partial<
    Record<CubeFaceDirection, CubeNode['faces'][CubeFaceDirection]>
  >;
  for (const direction of CUBE_FACE_DIRECTIONS) {
    const face = faceRecord[direction];
    const facePath = `${path}.faces.${direction}`;
    if (!face) {
      add({
        code: 'cube.invalid_face',
        severity: 'error',
        message: `Cube is missing its ${direction} face record.`,
        path: facePath,
        entityIds: [cube.id],
      });
      continue;
    }
    if (typeof face.enabled !== 'boolean') {
      add({
        code: 'cube.invalid_face',
        severity: 'error',
        message: 'Face enabled must be a boolean.',
        path: `${facePath}.enabled`,
        entityIds: [cube.id],
      });
    }
    if (face.uv) validateVec(face.uv, 4, `${facePath}.uv`, add, cube.id);
    if (
      face.rotation !== undefined &&
      !CUBE_FACE_ROTATIONS.some((rotation) => rotation === face.rotation)
    ) {
      add({
        code: 'cube.invalid_face',
        severity: 'error',
        message: 'Face rotation must be 0, 90, 180, or 270 degrees.',
        path: `${facePath}.rotation`,
        entityIds: [cube.id],
      });
    }
    if (face.cullFace !== undefined && !CUBE_FACE_DIRECTION_SET.has(face.cullFace)) {
      add({
        code: 'cube.invalid_face',
        severity: 'error',
        message: 'Face cullFace must be a canonical cube direction.',
        path: `${facePath}.cullFace`,
        entityIds: [cube.id],
      });
    }
    if (face.tintIndex !== undefined && (!Number.isInteger(face.tintIndex) || face.tintIndex < 0)) {
      add({
        code: 'cube.invalid_face',
        severity: 'error',
        message: 'Face tintIndex must be a non-negative integer.',
        path: `${facePath}.tintIndex`,
        entityIds: [cube.id],
      });
    }
    if (face.materialInstance !== undefined && !isNonEmptyString(face.materialInstance)) {
      add({
        code: 'cube.invalid_face',
        severity: 'error',
        message: 'Face materialInstance must be a non-empty string.',
        path: `${facePath}.materialInstance`,
        entityIds: [cube.id],
      });
    }
    if (face.textureId !== null) {
      if (!isNonEmptyString(face.textureId)) {
        add({
          code: 'cube.invalid_face',
          severity: 'error',
          message: 'Face textureId must be a non-empty asset ID or null.',
          path: `${facePath}.textureId`,
          entityIds: [cube.id],
        });
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
    }
    const faceTexture =
      typeof face.textureId === 'string' ? document.textures[face.textureId] : undefined;
    if (
      face.enabled &&
      faceTexture &&
      face.uv &&
      (!Array.isArray(face.uv) ||
        face.uv.length !== 4 ||
        face.uv[0] < 0 ||
        face.uv[0] > faceTexture.width ||
        face.uv[2] < 0 ||
        face.uv[2] > faceTexture.width ||
        face.uv[1] < 0 ||
        face.uv[1] > faceTexture.height ||
        face.uv[3] < 0 ||
        face.uv[3] > faceTexture.height)
    ) {
      add({
        code: 'cube.invalid_face',
        severity: 'error',
        message: 'Preserved face UV endpoints must stay inside the texture canvas.',
        path: `${facePath}.uv`,
        entityIds: [cube.id],
        assetIds: [faceTexture.id],
      });
    }
  }
  if (
    cube.lightEmission !== undefined &&
    (!Number.isInteger(cube.lightEmission) || cube.lightEmission < 0 || cube.lightEmission > 15)
  ) {
    add({
      code: 'cube.invalid_face',
      severity: 'error',
      message: 'Cube lightEmission must be an integer between 0 and 15.',
      path: `${path}.lightEmission`,
      entityIds: [cube.id],
    });
  }
};
