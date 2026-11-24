import type { Vec3 } from './identity';

export type CanonicalQuaternion = readonly [number, number, number, number];

/** Shared target X-then-Y-then-Z transform convention. */
export const canonicalQuaternionFromEuler = (rotation: Vec3): CanonicalQuaternion => {
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

export const canonicalRotatePoint = (point: Vec3, rotation: Vec3): [number, number, number] => {
  const [x, y, z, w] = canonicalQuaternionFromEuler(rotation);
  const crossX = y * point[2] - z * point[1];
  const crossY = z * point[0] - x * point[2];
  const crossZ = x * point[1] - y * point[0];
  const secondX = y * crossZ - z * crossY;
  const secondY = z * crossX - x * crossZ;
  const secondZ = x * crossY - y * crossX;
  return [
    point[0] + 2 * (w * crossX + secondX),
    point[1] + 2 * (w * crossY + secondY),
    point[2] + 2 * (w * crossZ + secondZ),
  ];
};

const canonicalRotationMatrix = (
  quaternion: CanonicalQuaternion,
): readonly (readonly [number, number, number])[] => {
  const [x, y, z, w] = quaternion;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
};

/**
 * Bedrock/Gecko geometry uses the canonical scene with its X axis reflected.
 * Convert the canonical rotation through that reflection once, then extract
 * the same intrinsic-XYZ Euler vocabulary consumed by the target schema.
 * This is a target-coordinate adapter, not a second authored transform.
 */
export const canonicalMinecraftRotation = (rotation: Vec3): [number, number, number] => {
  const source = canonicalRotationMatrix(canonicalQuaternionFromEuler(rotation));
  const reflection = [-1, 1, 1] as const;
  const mirrored = source.map((row, rowIndex) =>
    row.map((value, columnIndex) => reflection[rowIndex]! * value * reflection[columnIndex]!),
  );
  const y = Math.asin(Math.max(-1, Math.min(1, -mirrored[2]![0]!)));
  const cosineY = Math.cos(y);
  let x: number;
  let z: number;
  if (Math.abs(cosineY) > 0.0000001) {
    x = Math.atan2(mirrored[2]![1]!, mirrored[2]![2]!);
    z = Math.atan2(mirrored[1]![0]!, mirrored[0]![0]!);
  } else {
    x = Math.atan2(-mirrored[0]![1]!, mirrored[1]![1]!);
    z = 0;
  }
  const degrees = (value: number): number => {
    const result = (value * 180) / Math.PI;
    return Math.abs(result) <= 0.000001 ? 0 : result;
  };
  return [degrees(x), degrees(y), degrees(z)];
};
