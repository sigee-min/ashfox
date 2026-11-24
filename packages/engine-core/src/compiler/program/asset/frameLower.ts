import { freeze } from '../../../immutable';
import type { Transform } from '../../../model/scene';
import { canonicalQuaternionFromEuler } from '../../../model/transform';
import { isAssetExactFrame, type AssetExactFrame } from './frame';

type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

const vector = (values: readonly number[]): readonly [number, number, number] =>
  freeze([values[0]!, values[1]!, values[2]!]);
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

/** Convert one exact unit value at the sole canonical numeric boundary. */
const exactUnitNumber = (value: AssetExactFrame['origin'][number]): number | null => {
  if (value.unit !== 'unit' || value.denominator <= 0n) return null;
  const absoluteNumerator = value.numerator < 0n ? -value.numerator : value.numerator;
  if (absoluteNumerator > MAX_SAFE_INTEGER || value.denominator > MAX_SAFE_INTEGER) return null;
  const numerator = Number(value.numerator);
  const denominator = Number(value.denominator);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  const result = numerator / denominator;
  if (!Number.isFinite(result)) return null;
  if (
    value.numerator % value.denominator === 0n &&
    (!Number.isSafeInteger(result) || BigInt(result) !== value.numerator / value.denominator)
  )
    return null;
  return result;
};

/** Convert basis columns to rows, then make an improper frame proper. */
const properMatrix = (frame: AssetExactFrame): Matrix3 => {
  const columns = [frame.xAxis, frame.yAxis, frame.zAxis];
  const scale = frame.determinant === -1 ? [-1, 1, 1] : [1, 1, 1];
  const row = (index: 0 | 1 | 2): readonly [number, number, number] =>
    freeze([
      columns[0]![index]! * scale[0]!,
      columns[1]![index]! * scale[1]!,
      columns[2]![index]! * scale[2]!,
    ]);
  const rows: Matrix3 = [row(0), row(1), row(2)];
  return freeze(rows);
};

const degrees = (radians: number): number => {
  const value = (radians * 180) / Math.PI;
  const nearest = Math.round(value);
  if (Math.abs(value - nearest) <= 0.000000001) return nearest === 0 ? 0 : nearest;
  return Math.abs(value) <= 0.000000001 ? 0 : value;
};

/** Invert the shared canonical quaternion's intrinsic XYZ convention. */
const eulerFromProperMatrix = (matrix: Matrix3): readonly [number, number, number] => {
  const sineY = Math.max(-1, Math.min(1, matrix[0]![2]!));
  const y = Math.asin(sineY);
  const cosineY = Math.cos(y);
  let x: number;
  let z: number;
  if (Math.abs(cosineY) > 0.0000001) {
    x = Math.atan2(-matrix[1]![2]!, matrix[2]![2]!);
    z = Math.atan2(-matrix[0]![1]!, matrix[0]![0]!);
  } else if (sineY >= 0) {
    x = Math.atan2(matrix[1]![0]!, matrix[1]![1]!);
    z = 0;
  } else {
    x = Math.atan2(-matrix[1]![0]!, matrix[1]![1]!);
    z = 0;
  }
  return vector([degrees(x), degrees(y), degrees(z)]);
};

const matrixFromEuler = (rotation: readonly [number, number, number]): Matrix3 => {
  const [x, y, z, w] = canonicalQuaternionFromEuler(rotation);
  const rows: Matrix3 = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  return rows;
};

const sameMatrix = (left: Matrix3, right: Matrix3): boolean =>
  left.every((row, rowIndex) =>
    row.every(
      (value, columnIndex) => Math.abs(value - right[rowIndex]![columnIndex]!) <= 0.0000001,
    ),
  );

/**
 * Lower an exact signed frame to the canonical bone transform. Reflections
 * use one negative X scale so the Euler rotation remains proper (determinant
 * +1), matching the shared scene quaternion convention.
 */
export const lowerAssetFrameToBoneTransform = (
  frame: AssetExactFrame,
): Readonly<Transform> | null => {
  if (!isAssetExactFrame(frame)) return null;
  try {
    const origin = [
      exactUnitNumber(frame.origin[0]),
      exactUnitNumber(frame.origin[1]),
      exactUnitNumber(frame.origin[2]),
    ] as const;
    if (origin.some((value): value is null => value === null)) return null;
    const pivot: readonly [number, number, number] = [origin[0]!, origin[1]!, origin[2]!];
    const proper = properMatrix(frame);
    const rotation = eulerFromProperMatrix(proper);
    if (!sameMatrix(matrixFromEuler(rotation), proper)) return null;
    const scale = frame.determinant === -1 ? [-1, 1, 1] : [1, 1, 1];
    return freeze({
      position: vector([0, 0, 0]),
      rotation,
      scale: vector(scale),
      pivot: vector(pivot),
    });
  } catch {
    return null;
  }
};
