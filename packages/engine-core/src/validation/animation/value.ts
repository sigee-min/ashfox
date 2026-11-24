import type { AnimationScalar, AnimationVec3, KeyframeEasing } from '../../model';
import { isNonEmptyString } from '../shared/value';
import type { FindingSink } from '../contract';

export const validateAnimationScalar = (
  value: AnimationScalar,
  path: string,
  clipId: string,
  add: FindingSink,
): void => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      add({
        code: 'animation.invalid_value',
        severity: 'error',
        message: 'Animation numeric values must be finite.',
        path,
        clipIds: [clipId],
      });
    }
    return;
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    value.kind !== 'molang' ||
    !isNonEmptyString(value.source)
  ) {
    add({
      code: 'animation.invalid_value',
      severity: 'error',
      message: 'Animation values must be finite numbers or non-empty Molang expressions.',
      path,
      clipIds: [clipId],
    });
  }
};

export const validateAnimationVector = (
  value: AnimationVec3,
  path: string,
  clipId: string,
  add: FindingSink,
): void => {
  if (!Array.isArray(value) || value.length !== 3) {
    add({
      code: 'animation.invalid_value',
      severity: 'error',
      message: 'Animation transforms require a three-component vector.',
      path,
      clipIds: [clipId],
    });
    return;
  }
  value.forEach((component, index) =>
    validateAnimationScalar(component, `${path}[${index}]`, clipId, add),
  );
};

export const validateKeyframeEasing = (
  easing: KeyframeEasing,
  path: string,
  clipId: string,
  add: FindingSink,
): void => {
  if (!isNonEmptyString(easing.type)) {
    add({
      code: 'animation.invalid_value',
      severity: 'error',
      message: 'Animation easing types must be non-empty.',
      path: `${path}.type`,
      clipIds: [clipId],
    });
  }
  easing.arguments?.forEach((argument, index) =>
    validateAnimationScalar(argument, `${path}.arguments[${index}]`, clipId, add),
  );
};
