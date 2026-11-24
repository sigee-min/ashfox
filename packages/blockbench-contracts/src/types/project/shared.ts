import { isClosedContractRecord, isDenseContractArray } from '@ashfox/internal-contracts';

import { CUBE_FACE_DIRECTIONS } from '../shared';

/** Closed project-contract value before a specific reader narrows it. */
export type ContractRecord = Readonly<Record<string, unknown>>;
export type ValueGuard<T> = (value: unknown) => value is T;

const owns = (value: ContractRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export const hasShape = (
  value: ContractRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => owns(value, key)) && Object.keys(value).every((key) => allowed.has(key))
  );
};

export const optional = (
  value: ContractRecord,
  key: string,
  guard: (value: unknown) => boolean,
): boolean => !owns(value, key) || guard(value[key]);

export const isString = (value: unknown): value is string => typeof value === 'string';
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export const isFiniteNumberInRange = (
  value: unknown,
  minimum: number,
  maximum: number,
): value is number => isFiniteNumber(value) && value >= minimum && value <= maximum;
export const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

export const isEnumValue = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.some((candidate) => candidate === value);

const isFiniteTuple = <TLength extends number>(
  value: unknown,
  length: TLength,
): value is readonly number[] & { readonly length: TLength } =>
  isDenseContractArray(value) && value.length === length && value.every(isFiniteNumber);

export const isVec2 = (value: unknown): value is readonly [number, number] =>
  isFiniteTuple(value, 2);
export const isVec3 = (value: unknown): value is readonly [number, number, number] =>
  isFiniteTuple(value, 3);
export const isVec4 = (value: unknown): value is readonly [number, number, number, number] =>
  isFiniteTuple(value, 4);

export const isStringArray = (value: unknown): value is readonly string[] =>
  isDenseContractArray(value) && value.every(isString);

export const isArrayOf = <T>(value: unknown, guard: ValueGuard<T>): value is readonly T[] =>
  isDenseContractArray(value) && value.every(guard);

export const isCubeFaceDirection = (
  value: unknown,
): value is (typeof CUBE_FACE_DIRECTIONS)[number] => isEnumValue(CUBE_FACE_DIRECTIONS, value);

export { isClosedContractRecord };
