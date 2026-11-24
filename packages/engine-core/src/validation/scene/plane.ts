import {
  PLANE_FACE_DIRECTIONS,
  type PlaneFaceDirection,
  type PlaneNode,
  type ProjectDocument,
} from '../../model';
import { isNonEmptyString, validateVec } from '../shared/value';
import type { FindingSink } from '../contract';
import { worldToLattice } from '../../modeling/lattice';

const FACE_ROTATIONS = [0, 90, 180, 270] as const;

export const validatePlane = (
  plane: PlaneNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  validateVec(plane.size, 2, `${path}.size`, add, plane.id);
  const latticeAlignedSize = plane.size.every((size) => {
    if (!Number.isFinite(size) || size <= 0) return false;
    try {
      return worldToLattice(size, document.settings.surfacePixelDensity) > 0;
    } catch {
      return false;
    }
  });
  if (!latticeAlignedSize) {
    add({
      code: 'plane.invalid_size',
      severity: 'error',
      message: 'Plane size must contain two positive project-lattice spans.',
      path: `${path}.size`,
      entityIds: [plane.id],
    });
  }
  if (plane.sidedness !== 'front' && plane.sidedness !== 'double') {
    add({
      code: 'plane.invalid_sidedness',
      severity: 'error',
      message: 'Plane sidedness must be front or double.',
      path: `${path}.sidedness`,
      entityIds: [plane.id],
    });
  }
  if (!isNonEmptyString(plane.coverageId)) {
    add({
      code: 'plane.invalid_coverage',
      severity: 'error',
      message: 'Plane coverageId must be non-empty.',
      path: `${path}.coverageId`,
      entityIds: [plane.id],
    });
  }
  if (plane.basis !== undefined) {
    const axes = [plane.basis.normal, plane.basis.uAxis, plane.basis.vAxis];
    const isAxis = (value: readonly number[]): boolean =>
      value.length === 3 &&
      value.filter((entry) => Math.abs(entry) === 1).length === 1 &&
      value.filter((entry) => entry === 0).length === 2;
    const cross = (left: readonly number[], right: readonly number[]) => [
      left[1]! * right[2]! - left[2]! * right[1]!,
      left[2]! * right[0]! - left[0]! * right[2]!,
      left[0]! * right[1]! - left[1]! * right[0]!,
    ];
    if (
      !axes.every(isAxis) ||
      JSON.stringify(cross(plane.basis.uAxis, plane.basis.vAxis)) !==
        JSON.stringify(plane.basis.normal)
    ) {
      add({
        code: 'plane.invalid_face',
        severity: 'error',
        message: 'Plane basis must be three signed axes with u×v equal to normal.',
        path: `${path}.basis`,
        entityIds: [plane.id],
      });
    }
  }
  const faces = plane.faces as Partial<
    Record<PlaneFaceDirection, PlaneNode['faces'][PlaneFaceDirection]>
  >;
  for (const direction of PLANE_FACE_DIRECTIONS) {
    const face = faces[direction];
    const facePath = `${path}.faces.${direction}`;
    if (!face) {
      add({
        code: 'plane.invalid_face',
        severity: 'error',
        message: `Plane is missing its ${direction} face record.`,
        path: facePath,
        entityIds: [plane.id],
      });
      continue;
    }
    const expectedEnabled = direction === 'front' || plane.sidedness === 'double';
    if (face.enabled !== expectedEnabled) {
      add({
        code: 'plane.invalid_face',
        severity: 'error',
        message: `${direction} face enabled does not match plane sidedness.`,
        path: `${facePath}.enabled`,
        entityIds: [plane.id],
      });
    }
    if (face.uv) validateVec(face.uv, 4, `${facePath}.uv`, add, plane.id);
    if (
      face.rotation !== undefined &&
      !FACE_ROTATIONS.some((rotation) => rotation === face.rotation)
    ) {
      add({
        code: 'plane.invalid_face',
        severity: 'error',
        message: 'Plane face rotation must be 0, 90, 180, or 270 degrees.',
        path: `${facePath}.rotation`,
        entityIds: [plane.id],
      });
    }
    if (face.textureId !== null) {
      if (!isNonEmptyString(face.textureId)) {
        add({
          code: 'plane.invalid_face',
          severity: 'error',
          message: 'Plane textureId must be a non-empty asset ID or null.',
          path: `${facePath}.textureId`,
          entityIds: [plane.id],
        });
      } else if (face.enabled && !document.textures[face.textureId]) {
        add({
          code: 'plane.texture_missing',
          severity: 'error',
          message: `Plane face references missing texture "${face.textureId}".`,
          path: `${facePath}.textureId`,
          entityIds: [plane.id],
          assetIds: [face.textureId],
        });
      }
    }
  }
};
