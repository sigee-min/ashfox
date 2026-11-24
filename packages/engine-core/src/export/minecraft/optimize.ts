import type { AnimationVec3, TransformChannel, TransformKeyframe } from '../../model';

export interface OptimizedMinecraftChannel {
  keys: readonly TransformKeyframe[];
  constant?: AnimationVec3;
}

const VECTOR_ERROR = 0.000001;
const ROTATION_ERROR_DEGREES = 0.0005;

const isNumericVector = (value: AnimationVec3): value is readonly [number, number, number] =>
  value.every((component) => typeof component === 'number');

const isSimpleKey = (key: TransformKeyframe): boolean =>
  key.preValue === undefined && key.postValue === undefined && key.easing === undefined;

const equalNumericVectors = (left: readonly number[], right: readonly number[]): boolean =>
  left.every((value, component) => Math.fround(value) === Math.fround(right[component]));

const retainedStepIndices = (keys: readonly TransformKeyframe[]): number[] => {
  if (keys.length <= 2) return keys.map((_, index) => index);
  const retained = [0];
  for (let index = 1; index < keys.length - 1; index += 1) {
    if (
      !equalNumericVectors(
        keys[index - 1].value as readonly number[],
        keys[index].value as readonly number[],
      )
    ) {
      retained.push(index);
    }
  }
  retained.push(keys.length - 1);
  return retained;
};

const linearError = (
  keys: readonly TransformKeyframe[],
  start: number,
  end: number,
  index: number,
): number => {
  const left = keys[start];
  const right = keys[end];
  const duration = right.timeSeconds - left.timeSeconds;
  const alpha =
    duration <= Number.EPSILON ? 0 : (keys[index].timeSeconds - left.timeSeconds) / duration;
  return (keys[index].value as readonly number[]).reduce(
    (error, value, component) =>
      Math.max(
        error,
        Math.abs(
          value -
            ((left.value[component] as number) +
              ((right.value[component] as number) - (left.value[component] as number)) * alpha),
        ),
      ),
    0,
  );
};

const retainedLinearIndices = (channel: TransformChannel): number[] => {
  const keys = channel.keys;
  if (keys.length <= 2) return keys.map((_, index) => index);
  const tolerance = channel.property === 'rotation' ? ROTATION_ERROR_DEGREES : VECTOR_ERROR;
  const retained = new Set([0, keys.length - 1]);
  const segments: Array<[number, number]> = [[0, keys.length - 1]];
  while (segments.length > 0) {
    const [start, end] = segments.pop() as [number, number];
    let worstIndex = -1;
    let worstError = tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const error = linearError(keys, start, end, index);
      if (!Number.isFinite(error) || error > worstError) {
        worstError = error;
        worstIndex = index;
      }
    }
    if (worstIndex < 0) continue;
    retained.add(worstIndex);
    segments.push([start, worstIndex], [worstIndex, end]);
  }
  return [...retained].sort((left, right) => left - right);
};

export const optimizeMinecraftAnimationChannel = (
  channel: TransformChannel,
): OptimizedMinecraftChannel => {
  const keys = channel.keys;
  const numeric = keys.every((key) => isSimpleKey(key) && isNumericVector(key.value));
  if (!numeric || keys.length === 0) {
    return { keys };
  }
  const interpolation = new Set(keys.map((key) => key.interpolation));
  const retained =
    interpolation.size === 1 && interpolation.has('linear')
      ? retainedLinearIndices(channel)
      : interpolation.size === 1 && interpolation.has('step')
        ? retainedStepIndices(keys)
        : keys.map((_, index) => index);
  const optimizedKeys = retained.map((index) => keys[index]);
  const first = keys[0].value as readonly number[];
  const constant = keys.every((key) => equalNumericVectors(first, key.value as readonly number[]));
  const startsAtZero = Math.abs(keys[0].timeSeconds) <= 0.000001;
  return {
    keys: optimizedKeys,
    ...(constant && startsAtZero ? { constant: keys[0].value } : {}),
  };
};
