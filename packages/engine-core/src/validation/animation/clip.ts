import type { AnimationClip, ProjectDocument } from '../../model';
import { isFiniteNumber, isNonEmptyString } from '../shared/value';
import type { FindingSink, IdRegistrar } from '../contract';
import { validateAnimationScalar } from './value';
import { validateTransformChannels } from './channel';
import type { ClipValidationContext } from './context';
import { validateTriggerTracks } from './trigger';

const LOOP_MODES = new Set<string>(['once', 'loop', 'hold_on_last_frame']);

const validateClipMetadata = ({ clip, path, add }: ClipValidationContext): void => {
  if (!isNonEmptyString(clip.name)) {
    add({
      code: 'document.required_value',
      severity: 'error',
      message: 'Animation names must be non-empty.',
      path: `${path}.name`,
      clipIds: [clip.id],
    });
  }
  if (!isFiniteNumber(clip.durationSeconds) || clip.durationSeconds <= 0) {
    add({
      code: 'animation.invalid_timing',
      severity: 'error',
      message: 'Animation duration must be greater than zero.',
      path: `${path}.durationSeconds`,
      clipIds: [clip.id],
    });
  }
  if (!isFiniteNumber(clip.fps) || clip.fps <= 0) {
    add({
      code: 'animation.invalid_timing',
      severity: 'error',
      message: 'Animation FPS must be greater than zero.',
      path: `${path}.fps`,
      clipIds: [clip.id],
    });
  }
  if (!LOOP_MODES.has(clip.loop)) {
    add({
      code: 'animation.invalid_loop',
      severity: 'error',
      message: 'Animation loop must be once, loop, or hold_on_last_frame.',
      path: `${path}.loop`,
      clipIds: [clip.id],
    });
  }
};

const validateClipExpressions = ({ clip, path, add }: ClipValidationContext): void => {
  for (const [field, expression] of [
    ['startDelay', clip.startDelay],
    ['loopDelay', clip.loopDelay],
    ['animationTimeUpdate', clip.animationTimeUpdate],
  ] as const) {
    if (expression && (expression.kind !== 'molang' || !isNonEmptyString(expression.source))) {
      add({
        code: 'animation.invalid_value',
        severity: 'error',
        message: `${field} requires a non-empty Molang expression.`,
        path: `${path}.${field}.source`,
        clipIds: [clip.id],
      });
    }
  }
  if (clip.blendWeight !== undefined) {
    validateAnimationScalar(clip.blendWeight, `${path}.blendWeight`, clip.id, add);
  }
  if (
    clip.overridePreviousAnimation !== undefined &&
    typeof clip.overridePreviousAnimation !== 'boolean'
  ) {
    add({
      code: 'animation.invalid_value',
      severity: 'error',
      message: 'overridePreviousAnimation must be a boolean.',
      path: `${path}.overridePreviousAnimation`,
      clipIds: [clip.id],
    });
  }
};

export const validateAnimationClip = (
  clip: AnimationClip,
  document: ProjectDocument,
  path: string,
  add: FindingSink,
  registerId: IdRegistrar,
): void => {
  const context: ClipValidationContext = {
    clip,
    document,
    path,
    add,
    registerId,
  };
  validateClipMetadata(context);
  validateClipExpressions(context);
  validateTransformChannels(context);
  validateTriggerTracks(context);
};
