import { freeze } from '../../../immutable';
import { assetExactNumber, type AssetExactNumber } from './value/contract';

export type AssetSignedCoordinate = -1 | 0 | 1;
export type AssetSignedAxis = readonly [
  AssetSignedCoordinate,
  AssetSignedCoordinate,
  AssetSignedCoordinate,
];

export type AssetExactUnitVector = readonly [AssetExactNumber, AssetExactNumber, AssetExactNumber];

/** Exact affine frame used only between semantic HIR and canonical lowering. */
export interface AssetExactFrame {
  readonly origin: AssetExactUnitVector;
  /** Basis columns in the owning frame. */
  readonly xAxis: AssetSignedAxis;
  readonly yAxis: AssetSignedAxis;
  readonly zAxis: AssetSignedAxis;
  readonly determinant: -1 | 1;
}

const MAX_FRAME_INTEGER_BITS = 512;

const integerBits = (value: bigint): number => {
  const absolute = value < 0n ? -value : value;
  return absolute === 0n ? 1 : absolute.toString(2).length;
};

const normalizedExactUnit = (value: unknown): value is AssetExactNumber => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AssetExactNumber>;
  if (
    typeof candidate.numerator !== 'bigint' ||
    typeof candidate.denominator !== 'bigint' ||
    candidate.unit !== 'unit' ||
    candidate.denominator <= 0n ||
    integerBits(candidate.numerator) > MAX_FRAME_INTEGER_BITS ||
    integerBits(candidate.denominator) > MAX_FRAME_INTEGER_BITS
  )
    return false;
  const normalized = assetExactNumber(candidate.numerator, candidate.denominator, 'unit');
  return (
    normalized.numerator === candidate.numerator && normalized.denominator === candidate.denominator
  );
};

const signed = (value: number): AssetSignedCoordinate | null =>
  value === -1 || value === 0 || value === 1 ? value : null;

const dot = (left: AssetSignedAxis, right: AssetSignedAxis): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

const cross = (left: AssetSignedAxis, right: AssetSignedAxis): AssetSignedAxis | null => {
  const values = [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
  const x = signed(values[0]!);
  const y = signed(values[1]!);
  const z = signed(values[2]!);
  return x === null || y === null || z === null ? null : freeze([x, y, z]);
};

const sameAxis = (left: AssetSignedAxis, right: AssetSignedAxis): boolean =>
  left.every((value, index) => value === right[index]);

const signedAxis = (value: unknown): value is AssetSignedAxis =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((entry) => entry === -1 || entry === 0 || entry === 1);

const determinant = (
  xAxis: AssetSignedAxis,
  yAxis: AssetSignedAxis,
  zAxis: AssetSignedAxis,
): -1 | 1 | null => {
  const crossed = cross(xAxis, yAxis);
  if (crossed === null) return null;
  if (sameAxis(crossed, zAxis)) return 1;
  if (
    sameAxis(
      crossed,
      freeze([
        -zAxis[0] as AssetSignedCoordinate,
        -zAxis[1] as AssetSignedCoordinate,
        -zAxis[2] as AssetSignedCoordinate,
      ]),
    )
  )
    return -1;
  return null;
};

const validAxis = (axis: AssetSignedAxis): boolean => dot(axis, axis) === 1;

export const isAssetExactFrame = (value: unknown): value is AssetExactFrame => {
  if (typeof value !== 'object' || value === null) return false;
  const frame = value as Partial<AssetExactFrame>;
  if (
    !Array.isArray(frame.origin) ||
    frame.origin.length !== 3 ||
    !frame.origin.every(normalizedExactUnit) ||
    !signedAxis(frame.xAxis) ||
    !signedAxis(frame.yAxis) ||
    !signedAxis(frame.zAxis) ||
    (frame.determinant !== -1 && frame.determinant !== 1)
  )
    return false;
  return (
    validAxis(frame.xAxis) &&
    validAxis(frame.yAxis) &&
    validAxis(frame.zAxis) &&
    dot(frame.xAxis, frame.yAxis) === 0 &&
    dot(frame.xAxis, frame.zAxis) === 0 &&
    dot(frame.yAxis, frame.zAxis) === 0 &&
    determinant(frame.xAxis, frame.yAxis, frame.zAxis) === frame.determinant
  );
};

const add = (left: AssetExactNumber, right: AssetExactNumber): AssetExactNumber =>
  assetExactNumber(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
    'unit',
  );

const scale = (value: AssetExactNumber, factor: AssetSignedCoordinate): AssetExactNumber =>
  assetExactNumber(value.numerator * BigInt(factor), value.denominator, 'unit');

const transformVector = (
  frame: AssetExactFrame,
  value: AssetExactUnitVector,
): AssetExactUnitVector => {
  const component = (row: 0 | 1 | 2): AssetExactNumber => {
    const x = scale(value[0], frame.xAxis[row]!);
    const y = scale(value[1], frame.yAxis[row]!);
    const z = scale(value[2], frame.zAxis[row]!);
    return add(add(x, y), z);
  };
  return freeze([component(0), component(1), component(2)]);
};

const transformAxis = (frame: AssetExactFrame, axis: AssetSignedAxis): AssetSignedAxis | null => {
  const values = [0, 1, 2].map(
    (row) =>
      frame.xAxis[row]! * axis[0] + frame.yAxis[row]! * axis[1] + frame.zAxis[row]! * axis[2],
  );
  const x = signed(values[0]!);
  const y = signed(values[1]!);
  const z = signed(values[2]!);
  return x === null || y === null || z === null ? null : freeze([x, y, z]);
};

const createFrame = (
  origin: AssetExactUnitVector,
  xAxis: AssetSignedAxis,
  yAxis: AssetSignedAxis,
  zAxis: AssetSignedAxis,
): AssetExactFrame | null => {
  const sign = determinant(xAxis, yAxis, zAxis);
  if (sign === null) return null;
  const frame = freeze({
    origin: freeze([...origin]) as AssetExactUnitVector,
    xAxis,
    yAxis,
    zAxis,
    determinant: sign,
  });
  return isAssetExactFrame(frame) ? frame : null;
};

/** Compose parent-world and child-local frames without floating-point loss. */
export const composeAssetFrames = (
  parent: AssetExactFrame,
  local: AssetExactFrame,
): AssetExactFrame | null => {
  if (!isAssetExactFrame(parent) || !isAssetExactFrame(local)) return null;
  try {
    const offset = transformVector(parent, local.origin);
    const xAxis = transformAxis(parent, local.xAxis);
    const yAxis = transformAxis(parent, local.yAxis);
    const zAxis = transformAxis(parent, local.zAxis);
    if (xAxis === null || yAxis === null || zAxis === null) return null;
    return createFrame(
      freeze([
        add(parent.origin[0], offset[0]),
        add(parent.origin[1], offset[1]),
        add(parent.origin[2], offset[2]),
      ]),
      xAxis,
      yAxis,
      zAxis,
    );
  } catch {
    return null;
  }
};

/** Inverse of one signed orthonormal affine frame. */
export const invertAssetFrame = (frame: AssetExactFrame): AssetExactFrame | null => {
  if (!isAssetExactFrame(frame)) return null;
  try {
    const xAxis = freeze([frame.xAxis[0], frame.yAxis[0], frame.zAxis[0]]) as AssetSignedAxis;
    const yAxis = freeze([frame.xAxis[1], frame.yAxis[1], frame.zAxis[1]]) as AssetSignedAxis;
    const zAxis = freeze([frame.xAxis[2], frame.yAxis[2], frame.zAxis[2]]) as AssetSignedAxis;
    const basis = createFrame(
      freeze([
        assetExactNumber(0n, 1n, 'unit'),
        assetExactNumber(0n, 1n, 'unit'),
        assetExactNumber(0n, 1n, 'unit'),
      ]),
      xAxis,
      yAxis,
      zAxis,
    );
    if (basis === null) return null;
    const translated = transformVector(basis, frame.origin);
    return createFrame(
      freeze([scale(translated[0], -1), scale(translated[1], -1), scale(translated[2], -1)]),
      xAxis,
      yAxis,
      zAxis,
    );
  } catch {
    return null;
  }
};

/** Transform placing a required local endpoint onto a provider world frame. */
export const connectAssetFrames = (
  providerWorld: AssetExactFrame,
  requiredLocal: AssetExactFrame,
): AssetExactFrame | null => {
  const inverse = invertAssetFrame(requiredLocal);
  return inverse === null ? null : composeAssetFrames(providerWorld, inverse);
};

export const equalAssetFrames = (left: unknown, right: unknown): boolean =>
  isAssetExactFrame(left) &&
  isAssetExactFrame(right) &&
  left.determinant === right.determinant &&
  sameAxis(left.xAxis, right.xAxis) &&
  sameAxis(left.yAxis, right.yAxis) &&
  sameAxis(left.zAxis, right.zAxis) &&
  left.origin.every((value, index) => {
    const other = right.origin[index]!;
    return (
      value.unit === other.unit &&
      value.numerator * other.denominator === other.numerator * value.denominator
    );
  });
