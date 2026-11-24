import type { AnimationClip, TransformChannel } from '../../model';

export const CANONICAL_IDLE_CLIP_NAME = 'idle';

const EPSILON = 0.000001;

const isFiniteNumericVec3 = (value: unknown): value is readonly [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((component) => typeof component === 'number' && Number.isFinite(component));

const numericValuesClose = (first: readonly number[], last: readonly number[]): boolean =>
  first.every((component, index) => Math.abs(component - (last[index] ?? Number.NaN)) <= EPSILON);

const numericValuesAreRotationIdentity = (value: readonly number[]): boolean =>
  value.every((component) => Math.abs(component) <= EPSILON);

const transformChannelBeginsAndEndsAtRest = (channel: TransformChannel): boolean => {
  if (channel.property !== 'rotation') return true;
  const first = channel.keys[0];
  const last = channel.keys.at(-1);
  return (
    first !== undefined &&
    last !== undefined &&
    isFiniteNumericVec3(first.value) &&
    isFiniteNumericVec3(last.value) &&
    numericValuesAreRotationIdentity(first.value) &&
    numericValuesAreRotationIdentity(last.value)
  );
};

export const transformChannelNumericallyCloses = (
  channel: TransformChannel,
  durationSeconds: number,
): boolean => {
  const keys = [...channel.keys].sort((left, right) => left.timeSeconds - right.timeSeconds);
  const first = keys[0];
  const last = keys.at(-1);
  return (
    keys.length >= 2 &&
    first !== undefined &&
    last !== undefined &&
    Math.abs(first.timeSeconds) <= EPSILON &&
    Math.abs(last.timeSeconds - durationSeconds) <= EPSILON &&
    isFiniteNumericVec3(first.value) &&
    isFiniteNumericVec3(last.value) &&
    numericValuesClose(first.value, last.value)
  );
};

export const idleClipNumericallyCloses = (clip: AnimationClip): boolean => {
  const channels = Object.values(clip.channels);
  return (
    clip.name === CANONICAL_IDLE_CLIP_NAME &&
    clip.loop === 'loop' &&
    channels.length > 0 &&
    channels.every(
      (channel) =>
        transformChannelNumericallyCloses(channel, clip.durationSeconds) &&
        transformChannelBeginsAndEndsAtRest(channel),
    )
  );
};
