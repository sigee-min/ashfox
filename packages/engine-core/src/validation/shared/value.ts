import type { EntityId, Transform, Vec2, Vec3 } from '../../model';
import type { FindingSink } from '../contract';

export const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const EPSILON = 0.000001;

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const isSafeBlobBucket = (value: string): boolean =>
  /^[A-Za-z0-9_.-]+$/.test(value) && value !== '.' && value !== '..';

export const isSafeBlobKey = (value: string): boolean =>
  !value.startsWith('/') &&
  !value.includes('\\') &&
  !/^[A-Za-z]:/.test(value) &&
  value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');

export const isIdentityPosition = (value: Vec3): boolean =>
  value.every((entry) => Math.abs(entry) <= EPSILON);

export const isIdentityRotation = isIdentityPosition;

export const isIdentityScale = (value: Vec3): boolean =>
  value.every((entry) => Math.abs(entry - 1) <= EPSILON);

export const validateVec = (
  value: Vec2 | Vec3 | readonly number[],
  expectedLength: 2 | 3 | 4,
  path: string,
  add: FindingSink,
  entityId?: EntityId,
): void => {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    add({
      code: 'value.not_finite',
      severity: 'error',
      message: `Expected a ${expectedLength}-component numeric vector.`,
      path,
      ...(entityId ? { entityIds: [entityId] } : {}),
    });
    return;
  }
  value.forEach((entry, index) => {
    if (!isFiniteNumber(entry)) {
      add({
        code: 'value.not_finite',
        severity: 'error',
        message: 'Vector components must be finite numbers.',
        path: `${path}[${index}]`,
        ...(entityId ? { entityIds: [entityId] } : {}),
      });
    }
  });
};

export const validateTransform = (
  transform: Transform,
  path: string,
  add: FindingSink,
  entityId: EntityId,
  allowZeroScale = false,
): void => {
  validateVec(transform.position, 3, `${path}.position`, add, entityId);
  validateVec(transform.rotation, 3, `${path}.rotation`, add, entityId);
  validateVec(transform.scale, 3, `${path}.scale`, add, entityId);
  validateVec(transform.pivot, 3, `${path}.pivot`, add, entityId);
  if (
    transform.scale.some(
      (entry) => !isFiniteNumber(entry) || (!allowZeroScale && Math.abs(entry) <= EPSILON),
    )
  ) {
    add({
      code: 'value.invalid_scale',
      severity: 'error',
      message: 'Scale components must be finite and non-zero.',
      path: `${path}.scale`,
      entityIds: [entityId],
    });
  }
};
