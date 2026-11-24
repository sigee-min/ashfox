import type { ProgramBinaryOperator } from '../../../project/program/syntax/contract';
import {
  assetExactNumber,
  AssetValueNumericLimitError,
  isAssetExactNumberInput,
  isAssetExactNumberWithinBudget,
  type AssetExactNumber,
  type AssetValueDiagnosticCode,
} from './value/contract';

const freeze = <T>(value: T): T => Object.freeze(value);

export type AssetOperationResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{
      readonly ok: false;
      readonly code: AssetValueDiagnosticCode;
      readonly message: string;
    }>;

const success = <T>(value: T): AssetOperationResult<T> => freeze({ ok: true, value });

const failure = (code: AssetValueDiagnosticCode, message: string): AssetOperationResult<never> =>
  freeze({ ok: false, code, message });

const exactInputError = (value: AssetExactNumber): AssetValueDiagnosticCode | null => {
  if (
    value === null ||
    typeof value !== 'object' ||
    !isAssetExactNumberInput(value.numerator, value.denominator, value.unit) ||
    value.denominator <= 0n
  )
    return 'asset.value.invalid-number';
  if (value.unit === 'plain' && value.denominator !== 1n) return 'asset.value.invalid-type';
  return isAssetExactNumberWithinBudget(value.numerator, value.denominator)
    ? null
    : 'asset.value.rational-limit';
};

const normalize = (
  numerator: bigint,
  denominator: bigint,
  unit: AssetExactNumber['unit'],
): AssetOperationResult<AssetExactNumber> => {
  try {
    return success(assetExactNumber(numerator, denominator, unit));
  } catch (error) {
    return error instanceof AssetValueNumericLimitError
      ? failure('asset.value.rational-limit', 'Exact arithmetic exceeds the numeric budget.')
      : failure('asset.value.invalid-number', 'Exact arithmetic produced an invalid number.');
  }
};

/** Apply a scalar operator without converting exact values to JavaScript numbers. */
export const assetExactOperation = (
  operator: ProgramBinaryOperator,
  left: AssetExactNumber,
  right: AssetExactNumber,
): AssetOperationResult<AssetExactNumber> => {
  const leftError = exactInputError(left);
  const rightError = exactInputError(right);
  if (leftError !== null || rightError !== null)
    return failure(
      leftError === 'asset.value.rational-limit' || rightError === 'asset.value.rational-limit'
        ? 'asset.value.rational-limit'
        : 'asset.value.invalid-number',
      leftError === 'asset.value.rational-limit' || rightError === 'asset.value.rational-limit'
        ? 'Exact arithmetic exceeds the numeric budget.'
        : 'Arithmetic operand has an invalid exact shape.',
    );
  if (operator === '+' || operator === '-') {
    if (left.unit !== right.unit)
      return failure('asset.value.unit-mismatch', 'Arithmetic operands must use compatible units.');
    const numerator =
      operator === '+'
        ? left.numerator * right.denominator + right.numerator * left.denominator
        : left.numerator * right.denominator - right.numerator * left.denominator;
    const normalized = normalize(numerator, left.denominator * right.denominator, left.unit);
    if (!normalized.ok) return normalized;
    const value = normalized.value;
    if (value.unit === 'plain' && value.denominator !== 1n)
      return freeze({
        ok: false,
        code: 'asset.value.invalid-type',
        message: 'Plain arithmetic must produce an exact integer.',
      });
    return success(value);
  }
  if (operator === '*') {
    if (left.unit !== 'plain' && right.unit !== 'plain')
      return failure(
        'asset.value.invalid-operator',
        'Multiplication may have at most one dimensional operand.',
      );
    const normalized = normalize(
      left.numerator * right.numerator,
      left.denominator * right.denominator,
      left.unit === 'plain' ? right.unit : left.unit,
    );
    if (!normalized.ok) return normalized;
    const value = normalized.value;
    if (value.unit === 'plain' && value.denominator !== 1n)
      return freeze({
        ok: false,
        code: 'asset.value.invalid-type',
        message: 'Plain arithmetic must produce an exact integer.',
      });
    return success(value);
  }
  if (operator === '/' && right.numerator === 0n)
    return failure('asset.value.division-by-zero', 'Division by zero is not allowed.');
  if (operator === '/') {
    if (right.unit !== 'plain' && left.unit !== right.unit)
      return failure(
        'asset.value.unit-mismatch',
        'Division requires a plain divisor or matching units.',
      );
    const normalized = normalize(
      left.numerator * right.denominator,
      left.denominator * right.numerator,
      right.unit === left.unit ? 'plain' : left.unit,
    );
    if (!normalized.ok) return normalized;
    const value = normalized.value;
    if (value.unit === 'plain' && value.denominator !== 1n)
      return freeze({
        ok: false,
        code: 'asset.value.invalid-type',
        message: 'A plain division result must be an exact integer.',
      });
    return success(value);
  }
  if (operator !== '%')
    return failure(
      'asset.value.invalid-operator',
      'Operator is not valid for exact scalar operands.',
    );
  if (right.numerator === 0n)
    return failure('asset.value.division-by-zero', 'Remainder by zero is not allowed.');
  if (
    left.unit !== 'plain' ||
    right.unit !== 'plain' ||
    left.denominator !== 1n ||
    right.denominator !== 1n
  )
    return failure(
      'asset.value.invalid-operator',
      'Remainder requires exact integer plain operands.',
    );
  return normalize(left.numerator % right.numerator, 1n, 'plain');
};
