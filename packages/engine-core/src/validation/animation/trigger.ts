import type { AnimationEffect, AnimationTriggerTrack } from '../../model';
import { isFiniteNumber, isNonEmptyString } from '../shared/value';
import type { ClipValidationContext } from './context';

const isAnimationEffectValue = (value: unknown): value is AnimationEffect =>
  typeof value === 'object' &&
  value !== null &&
  'effect' in value &&
  typeof value.effect === 'string';

const isAnimationEffectArrayValue = (value: unknown): value is readonly AnimationEffect[] =>
  Array.isArray(value) && value.every((entry) => isAnimationEffectValue(entry));

const validateEffect = (
  effect: AnimationEffect,
  path: string,
  trigger: AnimationTriggerTrack,
  context: ClipValidationContext,
): void => {
  const { clip, document, add } = context;
  if (!isNonEmptyString(effect.effect)) {
    add({
      code: 'animation.invalid_effect',
      severity: 'error',
      message: `${trigger.type} effects require a non-empty effect identifier.`,
      path: `${path}.effect`,
      clipIds: [clip.id],
    });
  }
  if (effect.locatorId !== undefined) {
    const locator = document.scene.nodes[effect.locatorId];
    if (!isNonEmptyString(effect.locatorId) || !locator || locator.kind !== 'locator') {
      add({
        code: 'animation.invalid_effect',
        severity: 'error',
        message: `Effect locator "${effect.locatorId}" does not resolve to a locator node.`,
        path: `${path}.locatorId`,
        entityIds: [effect.locatorId],
        clipIds: [clip.id],
      });
    }
  }
  if (
    effect.preEffectScript &&
    (effect.preEffectScript.kind !== 'molang' || !isNonEmptyString(effect.preEffectScript.source))
  ) {
    add({
      code: 'animation.invalid_effect',
      severity: 'error',
      message: 'Effect pre-script Molang expressions must be non-empty.',
      path: `${path}.preEffectScript.source`,
      clipIds: [clip.id],
    });
  }
};

const validateTriggerValue = (
  trigger: AnimationTriggerTrack,
  value: unknown,
  path: string,
  context: ClipValidationContext,
): void => {
  if (trigger.type === 'timeline') {
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0 || values.some((entry) => !isNonEmptyString(entry))) {
      context.add({
        code: 'animation.invalid_effect',
        severity: 'error',
        message: 'Timeline triggers require one or more non-empty expressions.',
        path,
        clipIds: [context.clip.id],
      });
    }
    return;
  }
  const effects = isAnimationEffectArrayValue(value)
    ? value
    : isAnimationEffectValue(value)
      ? [value]
      : [];
  if (effects.length === 0) {
    context.add({
      code: 'animation.invalid_effect',
      severity: 'error',
      message: `${trigger.type} triggers require a structured effect value.`,
      path,
      clipIds: [context.clip.id],
    });
    return;
  }
  effects.forEach((effect, index) =>
    validateEffect(effect, `${path}${effects.length > 1 ? `[${index}]` : ''}`, trigger, context),
  );
};

const validateTriggerKeys = (
  trigger: AnimationTriggerTrack,
  path: string,
  context: ClipValidationContext,
): void => {
  const { clip, add, registerId } = context;
  if (trigger.keys.length === 0) {
    add({
      code: 'animation.invalid_timing',
      severity: 'error',
      message: 'Animation trigger tracks require at least one keyframe.',
      path: `${path}.keys`,
      clipIds: [clip.id],
    });
  }
  let previousTime = -Infinity;
  for (const [keyIndex, keyframe] of trigger.keys.entries()) {
    const keyPath = `${path}.keys[${keyIndex}]`;
    registerId(keyframe.id, keyPath);
    validateTriggerValue(trigger, keyframe.value, `${keyPath}.value`, context);
    if (
      !isFiniteNumber(keyframe.timeSeconds) ||
      keyframe.timeSeconds < 0 ||
      keyframe.timeSeconds > clip.durationSeconds
    ) {
      add({
        code: 'animation.key_out_of_range',
        severity: 'error',
        message: 'Trigger key time must be within the clip duration.',
        path: `${keyPath}.timeSeconds`,
        clipIds: [clip.id],
      });
    }
    if (keyframe.timeSeconds <= previousTime) {
      add({
        code: 'animation.key_order',
        severity: 'error',
        message: 'Trigger keys must be strictly ordered by time.',
        path: `${keyPath}.timeSeconds`,
        clipIds: [clip.id],
      });
    }
    previousTime = keyframe.timeSeconds;
  }
};

export const validateTriggerTracks = (context: ClipValidationContext): void => {
  const { clip, path, add, registerId } = context;
  for (const [triggerKey, trigger] of Object.entries(clip.triggers)) {
    const triggerPath = `${path}.triggers.${triggerKey}`;
    registerId(trigger.id, triggerPath);
    if (triggerKey !== trigger.id) {
      add({
        code: 'identity.key_mismatch',
        severity: 'error',
        message: `Animation trigger key "${triggerKey}" does not match ID "${trigger.id}".`,
        path: triggerPath,
        clipIds: [clip.id],
      });
    }
    if (!['sound', 'particle', 'timeline'].includes(trigger.type)) {
      add({
        code: 'animation.invalid_effect',
        severity: 'error',
        message: 'Trigger type must be sound, particle, or timeline.',
        path: `${triggerPath}.type`,
        clipIds: [clip.id],
      });
    }
    validateTriggerKeys(trigger, triggerPath, context);
  }
};
