import type { Vec3 } from '../model/identity';

/** Add two 3D vectors component-wise. */
export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Subtract two 3D vectors component-wise (`a - b`). */
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Multiply two 3D vectors component-wise. */
export const mul3 = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

/** Scale a 3D vector by a scalar factor. */
export const scale3 = (v: Vec3, scalar: number): Vec3 => [
  v[0] * scalar,
  v[1] * scalar,
  v[2] * scalar,
];

/** Compute the Euclidean dot product of two 3D vectors. */
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Compute the right-handed cross product of two 3D vectors. */
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Compute the Euclidean length of a 3D vector. */
export const length3 = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

/** Normalize a 3D vector, returning `[1, 0, 0]` when shorter than `eps`. */
export const normalize3 = (v: Vec3, eps = 1e-6): Vec3 => {
  const length = length3(v);
  return length > eps ? [v[0] / length, v[1] / length, v[2] / length] : [1, 0, 0];
};
