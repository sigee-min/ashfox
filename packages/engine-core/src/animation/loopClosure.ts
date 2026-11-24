import type { AnimationClip, AnimationScalar, TransformChannel } from '../model';

const LOOP_CLOSURE_EPSILON = 0.000001;

const scalarExactlyMatches = (opening: AnimationScalar, closing: AnimationScalar): boolean => {
  if (typeof opening === 'number' && typeof closing === 'number') {
    return Math.abs(closing - opening) <= LOOP_CLOSURE_EPSILON;
  }
  return JSON.stringify(opening) === JSON.stringify(closing);
};

const rotationScalarCloses = (opening: AnimationScalar, closing: AnimationScalar): boolean => {
  if (typeof opening !== 'number' || typeof closing !== 'number') {
    return scalarExactlyMatches(opening, closing);
  }
  const turns = (closing - opening) / 360;
  return Math.abs(turns - Math.round(turns)) <= LOOP_CLOSURE_EPSILON;
};

export const transformChannelClosesLoop = (
  channel: TransformChannel,
  durationSeconds: number,
): boolean => {
  const keys = [...channel.keys].sort((left, right) => left.timeSeconds - right.timeSeconds);
  const opening = keys[0];
  const closing = keys.at(-1);
  if (
    keys.length < 2 ||
    opening === undefined ||
    closing === undefined ||
    Math.abs(opening.timeSeconds) > LOOP_CLOSURE_EPSILON ||
    Math.abs(closing.timeSeconds - durationSeconds) > LOOP_CLOSURE_EPSILON
  ) {
    return false;
  }
  return opening.value.every((openingValue, index) => {
    const closingValue = closing.value[index];
    if (closingValue === undefined) return false;
    return channel.property === 'rotation'
      ? rotationScalarCloses(openingValue, closingValue)
      : scalarExactlyMatches(openingValue, closingValue);
  });
};

export const loopClipTransformChannelsClose = (clip: AnimationClip): boolean =>
  clip.loop === 'loop' &&
  Object.values(clip.channels).every((channel) =>
    transformChannelClosesLoop(channel, clip.durationSeconds),
  );
