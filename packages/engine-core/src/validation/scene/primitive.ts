import type { CylinderNode, ProjectDocument, TaperNode, WedgeNode } from '../../model';
import type { FindingSink } from '../contract';
import { EPSILON, isFiniteNumber, validateVec } from '../shared/value';
import { validateBoxFaces } from './cube';

const validateBoxPrimitive = (
  node: TaperNode | WedgeNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  validateVec(node.bounds.from, 3, `${path}.bounds.from`, add, node.id);
  validateVec(node.bounds.to, 3, `${path}.bounds.to`, add, node.id);
  const positiveAxes = node.bounds.from.reduce(
    (count, from, index) => count + (node.bounds.to[index]! - from > EPSILON ? 1 : 0),
    0,
  );
  if (positiveAxes < 2 || node.bounds.from.some((f, i) => node.bounds.to[i]! < f)) {
    add({
      code: 'cube.invalid_bounds',
      severity: 'error',
      message: `${node.kind} bounds must have positive dimensions.`,
      path: `${path}.bounds`,
      entityIds: [node.id],
    });
  }
  if (!isFiniteNumber(node.inflate)) {
    add({
      code: 'value.not_finite',
      severity: 'error',
      message: `${node.kind} inflate must be finite.`,
      path: `${path}.inflate`,
      entityIds: [node.id],
    });
  }
  validateBoxFaces(node.faces, node, document, path, add);
};

export const validateTaper = (
  node: TaperNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  validateBoxPrimitive(node, document, path, add);
  validateVec(node.topScale, 2, `${path}.topScale`, add, node.id);
  if (node.topScale.some((s) => !isFiniteNumber(s) || s < 0)) {
    add({
      code: 'value.invalid_scale',
      severity: 'error',
      message: 'Taper topScale components must be non-negative finite numbers.',
      path: `${path}.topScale`,
      entityIds: [node.id],
    });
  }
};

export const validateWedge = (
  node: WedgeNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  validateBoxPrimitive(node, document, path, add);
};

export const validateCylinder = (
  node: CylinderNode,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  validateVec(node.origin, 3, `${path}.origin`, add, node.id);
  if (!isFiniteNumber(node.radius) || node.radius < 0) {
    add({
      code: 'cube.invalid_bounds',
      severity: 'error',
      message: 'Cylinder radius must be non-negative.',
      path: `${path}.radius`,
      entityIds: [node.id],
    });
  }
  if (!isFiniteNumber(node.radiusTop) || node.radiusTop < 0) {
    add({
      code: 'cube.invalid_bounds',
      severity: 'error',
      message: 'Cylinder radiusTop must be non-negative.',
      path: `${path}.radiusTop`,
      entityIds: [node.id],
    });
  }
  if (
    isFiniteNumber(node.radius) &&
    isFiniteNumber(node.radiusTop) &&
    node.radius <= 0 &&
    node.radiusTop <= 0
  ) {
    add({
      code: 'cube.invalid_bounds',
      severity: 'error',
      message: 'Cylinder requires at least one positive end radius.',
      path: `${path}.radius`,
      entityIds: [node.id],
    });
  }
  if (!isFiniteNumber(node.height) || node.height <= 0) {
    add({
      code: 'cube.invalid_bounds',
      severity: 'error',
      message: 'Cylinder height must be positive.',
      path: `${path}.height`,
      entityIds: [node.id],
    });
  }
  validateBoxFaces(node.faces, node, document, path, add);
};
