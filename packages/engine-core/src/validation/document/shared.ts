import { isClosedContractRecord, isDenseContractArray } from '@ashfox/internal-contracts';

import type { FindingSink, InvariantCode } from '../contract';

export type ContractRecord = Readonly<Record<string, unknown>>;

export interface ContractContext {
  readonly add: FindingSink;
  valid: boolean;
}

export const hasOwn = (value: ContractRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export const childPath = (path: string, key: string): string =>
  path.length === 0 ? key : `${path}.${key}`;

export const reject = (
  context: ContractContext,
  path: string,
  message: string,
  code: InvariantCode = 'document.required_value',
): void => {
  context.valid = false;
  context.add({
    code,
    severity: 'error',
    message,
    path,
  });
};

export const closedRecord = (
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  context: ContractContext,
): ContractRecord | null => {
  if (!isClosedContractRecord(value)) {
    reject(context, path, `${path || 'Project document'} must be an object.`);
    return null;
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    reject(
      context,
      childPath(path, key),
      `Unknown current-contract property "${key}".`,
      'document.unknown_property',
    );
  }
  for (const key of requiredKeys) {
    if (hasOwn(value, key)) continue;
    reject(
      context,
      childPath(path, key),
      `Required current-contract property "${key}" is missing.`,
    );
  }
  return value;
};

export const expectString = (
  value: unknown,
  path: string,
  context: ContractContext,
): value is string => {
  if (typeof value === 'string') return true;
  reject(context, path, `${path} must be a string.`);
  return false;
};

export const expectNullableString = (
  value: unknown,
  path: string,
  context: ContractContext,
): value is string | null => {
  if (value === null || typeof value === 'string') return true;
  reject(context, path, `${path} must be a string or null.`);
  return false;
};

export const expectBoolean = (
  value: unknown,
  path: string,
  context: ContractContext,
): value is boolean => {
  if (typeof value === 'boolean') return true;
  reject(context, path, `${path} must be a boolean.`);
  return false;
};

export const expectFiniteNumber = (
  value: unknown,
  path: string,
  context: ContractContext,
): value is number => {
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  reject(context, path, `${path} must be a finite JSON number.`, 'value.not_finite');
  return false;
};

export const expectLiteral = <TValue extends string | number>(
  value: unknown,
  allowed: readonly TValue[],
  path: string,
  context: ContractContext,
): value is TValue => {
  if (allowed.some((candidate) => candidate === value)) return true;
  reject(context, path, `${path} must be ${allowed.map(String).join(' | ')}.`);
  return false;
};

export const expectArray = (
  value: unknown,
  path: string,
  context: ContractContext,
): readonly unknown[] | null => {
  if (isDenseContractArray(value)) return value;
  reject(context, path, `${path} must be an array.`);
  return null;
};

export const expectStringArray = (value: unknown, path: string, context: ContractContext): void => {
  const values = expectArray(value, path, context);
  values?.forEach((entry, index) => {
    expectString(entry, `${path}[${index}]`, context);
  });
};

export const expectNumericTuple = (
  value: unknown,
  length: 2 | 3 | 4,
  path: string,
  context: ContractContext,
): void => {
  const values = expectArray(value, path, context);
  if (!values) return;
  if (values.length !== length) {
    reject(context, path, `${path} must contain exactly ${length} components.`, 'value.not_finite');
  }
  values.forEach((entry, index) => {
    expectFiniteNumber(entry, `${path}[${index}]`, context);
  });
};

export const validateRecordMap = (
  value: unknown,
  path: string,
  context: ContractContext,
  validateValue: (entry: unknown, entryPath: string) => void,
): void => {
  if (!isClosedContractRecord(value)) {
    reject(context, path, `${path} must be an object map.`);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    validateValue(entry, childPath(path, key));
  }
};
