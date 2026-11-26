import { cross3 } from '../../math/vec3';
import {
  PLANE_FACE_DIRECTIONS,
  type PlaneFaceDirection,
  type PlaneNode,
  type ProjectDocument,
} from '../../model';
import { isNonEmptyString, validateVec } from '../shared/value';
import type { FindingSink, InvariantFinding } from '../contract';
import { worldToLattice } from '../../modeling/lattice';

const FACE_ROTATIONS = [0, 90, 180, 270] as const;

type PlaneFace = PlaneNode['faces'][PlaneFaceDirection];
type PlaneBasis = NonNullable<PlaneNode['basis']>;
type SurfaceDensity = ProjectDocument['settings']['surfacePixelDensity'];

const faceIssue = (plane: PlaneNode, path: string, message: string): InvariantFinding => ({
  code: 'plane.invalid_face',
  severity: 'error',
  message,
  path,
  entityIds: [plane.id],
});

const isLatticeSpan = (size: number, density: SurfaceDensity): boolean => {
  if (!Number.isFinite(size) || size <= 0) return false;
  try {
    return worldToLattice(size, density) > 0;
  } catch {
    return false;
  }
};

const isSignedAxis = (value: readonly number[]): boolean =>
  value.length === 3 &&
  value.filter((entry) => Math.abs(entry) === 1).length === 1 &&
  value.filter((entry) => entry === 0).length === 2;

const isValidBasis = (basis: PlaneBasis): boolean =>
  [basis.normal, basis.uAxis, basis.vAxis].every(isSignedAxis) &&
  JSON.stringify(cross3(basis.uAxis, basis.vAxis)) === JSON.stringify(basis.normal);

const validatePlaneShape = (
  plane: PlaneNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  validateVec(plane.size, 2, `${path}.size`, add, plane.id);
  const density = document.settings.surfacePixelDensity;
  if (!plane.size.every((size) => isLatticeSpan(size, density))) {
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
  if (plane.basis !== undefined && !isValidBasis(plane.basis)) {
    add(
      faceIssue(
        plane,
        `${path}.basis`,
        'Plane basis must be three signed axes with u×v equal to normal.',
      ),
    );
  }
};

const validateFaceTextureId = (
  face: PlaneFace,
  plane: PlaneNode,
  document: ProjectDocument,
  facePath: string,
  add: FindingSink,
): void => {
  if (face.textureId === null) return;
  if (!isNonEmptyString(face.textureId)) {
    add(
      faceIssue(
        plane,
        `${facePath}.textureId`,
        'Plane textureId must be a non-empty asset ID or null.',
      ),
    );
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
};

const validatePlaneFace = (
  face: PlaneFace | undefined,
  direction: PlaneFaceDirection,
  plane: PlaneNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  const facePath = `${path}.faces.${direction}`;
  if (!face) {
    add(faceIssue(plane, facePath, `Plane is missing its ${direction} face record.`));
    return;
  }
  const expectedEnabled = direction === 'front' || plane.sidedness === 'double';
  if (face.enabled !== expectedEnabled) {
    add(
      faceIssue(
        plane,
        `${facePath}.enabled`,
        `${direction} face enabled does not match plane sidedness.`,
      ),
    );
  }
  if (face.uv) validateVec(face.uv, 4, `${facePath}.uv`, add, plane.id);
  if (
    face.rotation !== undefined &&
    !FACE_ROTATIONS.some((rotation) => rotation === face.rotation)
  ) {
    add(
      faceIssue(
        plane,
        `${facePath}.rotation`,
        'Plane face rotation must be 0, 90, 180, or 270 degrees.',
      ),
    );
  }
  validateFaceTextureId(face, plane, document, facePath, add);
};

export const validatePlane = (
  plane: PlaneNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  validatePlaneShape(plane, document, path, add);
  const faces = plane.faces as Partial<Record<PlaneFaceDirection, PlaneFace>>;
  for (const direction of PLANE_FACE_DIRECTIONS) {
    validatePlaneFace(faces[direction], direction, plane, document, path, add);
  }
};
