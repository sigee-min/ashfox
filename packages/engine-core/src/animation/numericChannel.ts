import type { AnimationScalar, AnimationVec3, TransformChannel } from '../model';

const EPSILON = 0.000001;

export type NumericAnimationVec3 = readonly [number, number, number];

export interface NumericTransformCompositionOptions {
  restValue: NumericAnimationVec3;
  translationScale?: number;
}

const numericScalar = (value: AnimationScalar): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const numericVector = (value: AnimationVec3): NumericAnimationVec3 | null => {
  const x = numericScalar(value[0]);
  const y = numericScalar(value[1]);
  const z = numericScalar(value[2]);
  return x === null || y === null || z === null ? null : [x, y, z];
};

const interpolateLinear = (
  start: NumericAnimationVec3,
  end: NumericAnimationVec3,
  progress: number,
): NumericAnimationVec3 => [
  start[0] + (end[0] - start[0]) * progress,
  start[1] + (end[1] - start[1]) * progress,
  start[2] + (end[2] - start[2]) * progress,
];

const catmullRomScalar = (
  previous: number,
  start: number,
  end: number,
  next: number,
  progress: number,
): number => {
  const squared = progress * progress;
  const cubed = squared * progress;
  return (
    0.5 *
    (2 * start +
      (-previous + end) * progress +
      (2 * previous - 5 * start + 4 * end - next) * squared +
      (-previous + 3 * start - 3 * end + next) * cubed)
  );
};

const interpolateCatmullRom = (
  previous: NumericAnimationVec3,
  start: NumericAnimationVec3,
  end: NumericAnimationVec3,
  next: NumericAnimationVec3,
  progress: number,
): NumericAnimationVec3 => [
  catmullRomScalar(previous[0], start[0], end[0], next[0], progress),
  catmullRomScalar(previous[1], start[1], end[1], next[1], progress),
  catmullRomScalar(previous[2], start[2], end[2], next[2], progress),
];

const defaultRestValue = (channel: TransformChannel): NumericAnimationVec3 =>
  channel.property === 'scale' ? [1, 1, 1] : [0, 0, 0];

interface NumericKey {
  timeSeconds: number;
  value: NumericAnimationVec3;
  interpolation: TransformChannel['keys'][number]['interpolation'];
}

const numericKeys = (
  channel: TransformChannel,
  restValue: NumericAnimationVec3,
): readonly NumericKey[] | null => {
  const keys: NumericKey[] = [];
  for (const key of [...channel.keys].sort((left, right) => left.timeSeconds - right.timeSeconds)) {
    const value = numericVector(key.value);
    if (!value) return null;
    keys.push({
      timeSeconds: key.timeSeconds,
      value,
      interpolation: key.interpolation,
    });
  }
  if (keys.length === 0) return [];
  return keys[0].timeSeconds > EPSILON
    ? [
        {
          timeSeconds: 0,
          value: restValue,
          interpolation: keys[0].interpolation,
        },
        ...keys,
      ]
    : keys;
};

export const sampleNumericTransformChannel = (
  channel: TransformChannel,
  timeSeconds: number,
  restValue: NumericAnimationVec3 = defaultRestValue(channel),
): NumericAnimationVec3 | null => {
  if (!Number.isFinite(timeSeconds)) return null;
  const keys = numericKeys(channel, restValue);
  if (!keys || keys.length === 0) return null;
  if (timeSeconds <= keys[0].timeSeconds + EPSILON) {
    return keys[0].value;
  }

  const endIndex = keys.findIndex((key) => key.timeSeconds >= timeSeconds - EPSILON);
  if (endIndex < 0) return keys.at(-1)?.value ?? null;
  if (endIndex === 0) return keys[0].value;

  const startIndex = endIndex - 1;
  const start = keys[startIndex];
  const end = keys[endIndex];
  if (Math.abs(timeSeconds - end.timeSeconds) <= EPSILON) {
    return end.value;
  }
  if (start.interpolation === 'step') return start.value;

  const duration = end.timeSeconds - start.timeSeconds;
  const progress =
    duration <= 0 ? 0 : Math.min(1, Math.max(0, (timeSeconds - start.timeSeconds) / duration));
  if (start.interpolation === 'catmullrom') {
    return interpolateCatmullRom(
      keys[Math.max(0, startIndex - 1)].value,
      start.value,
      end.value,
      keys[Math.min(keys.length - 1, endIndex + 1)].value,
      progress,
    );
  }
  return interpolateLinear(start.value, end.value, progress);
};

type NumericQuaternion = readonly [number, number, number, number];

const quaternionFromEulerXyzDegrees = (rotation: NumericAnimationVec3): NumericQuaternion => {
  const x = (rotation[0] * Math.PI) / 360;
  const y = (rotation[1] * Math.PI) / 360;
  const z = (rotation[2] * Math.PI) / 360;
  const sx = Math.sin(x);
  const cx = Math.cos(x);
  const sy = Math.sin(y);
  const cy = Math.cos(y);
  const sz = Math.sin(z);
  const cz = Math.cos(z);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
};

const multiplyNormalizedQuaternions = (
  left: NumericQuaternion,
  right: NumericQuaternion,
): NumericQuaternion => {
  const [lx, ly, lz, lw] = left;
  const [rx, ry, rz, rw] = right;
  const result: NumericQuaternion = [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ];
  const length = Math.hypot(...result);
  if (length <= EPSILON) return [0, 0, 0, 1];
  return [result[0] / length, result[1] / length, result[2] / length, result[3] / length];
};

const quaternionToEulerXyzDegrees = (quaternion: NumericQuaternion): NumericAnimationVec3 => {
  const [x, y, z, w] = quaternion;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const rotationY = Math.asin(Math.max(-1, Math.min(1, m13)));
  const singular = Math.abs(m13) >= 0.9999999;
  const rotationX = singular ? Math.atan2(m32, m22) : Math.atan2(-m23, m33);
  const rotationZ = singular ? 0 : Math.atan2(-m12, m11);
  const degrees = 180 / Math.PI;
  return [rotationX * degrees, rotationY * degrees, rotationZ * degrees];
};

export const sampleComposedNumericTransformChannel = (
  channel: TransformChannel,
  timeSeconds: number,
  options: NumericTransformCompositionOptions,
): NumericAnimationVec3 | null => {
  if (options.restValue.some((component) => !Number.isFinite(component))) {
    return null;
  }
  const sampled = sampleNumericTransformChannel(channel, timeSeconds);
  if (!sampled) return null;

  if (channel.property === 'position') {
    const translationScale = options.translationScale ?? 1;
    if (!Number.isFinite(translationScale)) return null;
    return [
      options.restValue[0] + sampled[0] * translationScale,
      options.restValue[1] + sampled[1] * translationScale,
      options.restValue[2] + sampled[2] * translationScale,
    ];
  }
  if (channel.property === 'scale') {
    return [
      options.restValue[0] * sampled[0],
      options.restValue[1] * sampled[1],
      options.restValue[2] * sampled[2],
    ];
  }
  return quaternionToEulerXyzDegrees(
    multiplyNormalizedQuaternions(
      quaternionFromEulerXyzDegrees(options.restValue),
      quaternionFromEulerXyzDegrees(sampled),
    ),
  );
};
