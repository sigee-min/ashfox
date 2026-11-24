import { canonicalQuaternionFromEuler } from '../../../model/transform';
import type { Vec3 } from '../../../model';

export const multiplyVec3 = (value: Vec3, scale: number): [number, number, number] => [
  value[0] * scale,
  value[1] * scale,
  value[2] * scale,
];

export const subtractVec3 = (left: Vec3, right: Vec3): [number, number, number] => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
];

export const addVec3 = (left: Vec3, right: Vec3): [number, number, number] => [
  left[0] + right[0],
  left[1] + right[1],
  left[2] + right[2],
];

export const quaternionFromEuler = (rotation: Vec3): [number, number, number, number] =>
  [...canonicalQuaternionFromEuler(rotation)] as [number, number, number, number];

export const rotateVec3ByQuaternion = (
  value: Vec3,
  quaternion: readonly [number, number, number, number],
): [number, number, number] => {
  const [x, y, z, w] = quaternion;
  const crossX = y * value[2] - z * value[1];
  const crossY = z * value[0] - x * value[2];
  const crossZ = x * value[1] - y * value[0];
  const secondX = y * crossZ - z * crossY;
  const secondY = z * crossX - x * crossZ;
  const secondZ = x * crossY - y * crossX;
  return [
    value[0] + 2 * (w * crossX + secondX),
    value[1] + 2 * (w * crossY + secondY),
    value[2] + 2 * (w * crossZ + secondZ),
  ];
};

export const isIdentityRotation = (rotation: Vec3): boolean =>
  rotation.every((value) => Math.abs(value) <= 0.000001);

export const isIdentityScale = (scale: Vec3): boolean =>
  scale.every((value) => Math.abs(value - 1) <= 0.000001);
