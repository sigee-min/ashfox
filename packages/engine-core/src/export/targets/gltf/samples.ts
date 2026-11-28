import type { TransformChannel } from '../../../model';

export interface GltfAnimationSamples {
  times: readonly number[];
  values: readonly number[];
  componentCount: 3 | 4;
  interpolation: 'LINEAR' | 'STEP';
}

const VECTOR_ERROR = 0.000001;
const ROTATION_ERROR_RADIANS = 0.00001;

const sampleValue = (samples: GltfAnimationSamples, index: number): number[] =>
  samples.values.slice(index * samples.componentCount, (index + 1) * samples.componentCount);

const normalizedQuaternion = (value: readonly number[]): number[] => {
  const length = Math.hypot(...value);
  return length <= Number.EPSILON ? [0, 0, 0, 1] : value.map((component) => component / length);
};

const slerp = (left: readonly number[], right: readonly number[], alpha: number): number[] => {
  let target = right;
  let dot = left.reduce((sum, component, index) => sum + component * right[index], 0);
  if (dot < 0) {
    dot = -dot;
    target = right.map((component) => -component);
  }
  if (dot > 0.9995) {
    return normalizedQuaternion(
      left.map((component, index) => component + (target[index] - component) * alpha),
    );
  }
  const angle = Math.acos(Math.min(1, dot));
  const denominator = Math.sin(angle);
  const leftWeight = Math.sin((1 - alpha) * angle) / denominator;
  const rightWeight = Math.sin(alpha * angle) / denominator;
  return left.map((component, index) => component * leftWeight + target[index] * rightWeight);
};

const interpolationError = (
  channel: TransformChannel,
  actual: readonly number[],
  left: readonly number[],
  right: readonly number[],
  alpha: number,
): number => {
  if (channel.property === 'rotation') {
    const predicted = slerp(left, right, alpha);
    const dot = Math.abs(
      actual.reduce((sum, component, index) => sum + component * predicted[index], 0),
    );
    return 2 * Math.acos(Math.min(1, dot));
  }
  return actual.reduce(
    (error, component, index) =>
      Math.max(error, Math.abs(component - (left[index] + (right[index] - left[index]) * alpha))),
    0,
  );
};

const MAX_QUAT_CHORD_RADIANS = Math.PI / 3;

const quatGeodesicAngle = (left: readonly number[], right: readonly number[]): number => {
  const dot = left.reduce((sum, component, index) => sum + component * right[index], 0);
  return 2 * Math.acos(Math.min(1, Math.abs(dot)));
};

const findSegmentSplitIndex = (
  channel: TransformChannel,
  samples: GltfAnimationSamples,
  start: number,
  end: number,
  tolerance: number,
): number => {
  const duration = samples.times[end] - samples.times[start];
  const left = sampleValue(samples, start);
  const right = sampleValue(samples, end);
  let worstIndex = -1;
  let worstError = tolerance;
  for (let index = start + 1; index < end; index += 1) {
    const alpha =
      duration <= Number.EPSILON ? 0 : (samples.times[index] - samples.times[start]) / duration;
    const error = interpolationError(channel, sampleValue(samples, index), left, right, alpha);
    if (!Number.isFinite(error) || error > worstError) {
      worstError = error;
      worstIndex = index;
    }
  }
  if (worstIndex >= 0) return worstIndex;
  if (
    channel.property === 'rotation' &&
    end - start > 1 &&
    quatGeodesicAngle(left, right) > MAX_QUAT_CHORD_RADIANS
  ) {
    return Math.floor((start + end) / 2);
  }
  return -1;
};

const retainedLinearIndices = (
  channel: TransformChannel,
  samples: GltfAnimationSamples,
): number[] => {
  const last = samples.times.length - 1;
  if (last <= 1) return samples.times.map((_, index) => index);
  const tolerance = channel.property === 'rotation' ? ROTATION_ERROR_RADIANS : VECTOR_ERROR;
  const retained = new Set([0, last]);
  const segments: Array<[number, number]> = [[0, last]];
  while (segments.length > 0) {
    const [start, end] = segments.pop() as [number, number];
    const splitIndex = findSegmentSplitIndex(channel, samples, start, end, tolerance);
    if (splitIndex < 0) continue;
    retained.add(splitIndex);
    segments.push([start, splitIndex], [splitIndex, end]);
  }
  return [...retained].sort((left, right) => left - right);
};

const equalValue = (samples: GltfAnimationSamples, left: number, right: number): boolean =>
  sampleValue(samples, left).every(
    (value, component) =>
      Math.fround(value) === Math.fround(sampleValue(samples, right)[component]),
  );

const retainedStepIndices = (samples: GltfAnimationSamples): number[] => {
  const last = samples.times.length - 1;
  if (last <= 1) return samples.times.map((_, index) => index);
  const retained = [0];
  for (let index = 1; index < last; index += 1) {
    if (!equalValue(samples, index - 1, index)) retained.push(index);
  }
  retained.push(last);
  return retained;
};

export const optimizeGltfAnimationSamples = (
  channel: TransformChannel,
  samples: GltfAnimationSamples,
): GltfAnimationSamples => {
  if (samples.times.length * samples.componentCount !== samples.values.length) {
    throw new Error('glTF animation sample arrays do not have matching sizes.');
  }
  const retained =
    samples.interpolation === 'STEP'
      ? retainedStepIndices(samples)
      : retainedLinearIndices(channel, samples);
  return {
    ...samples,
    times: retained.map((index) => samples.times[index]),
    values: retained.flatMap((index) => sampleValue(samples, index)),
  };
};
