import { freeze } from '../../../../immutable';
import type { ProgramBinaryOperator } from '../../../../project/program/syntax/contract';
import {
  assetExactNumber,
  AssetValueNumericLimitError,
  isAssetExactNumberInput,
  isAssetExactNumberWithinBudget,
  type AssetExactNumber,
  type AssetValueDiagnosticCode,
} from './contract';

export type AssetOperationResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{
      readonly ok: false;
      readonly code: AssetValueDiagnosticCode;
      readonly message: string;
    }>;

export const succeed = <T>(value: T): AssetOperationResult<T> => freeze({ ok: true, value });

export const fail = (
  code: AssetValueDiagnosticCode,
  message: string,
): AssetOperationResult<never> => freeze({ ok: false, code, message });

type ExactResult = AssetOperationResult<AssetExactNumber>;

type ExactOperation = (
  operator: ProgramBinaryOperator,
  left: AssetExactNumber,
  right: AssetExactNumber,
) => ExactResult;

const PLAIN_INTEGER_MESSAGE = 'Plain arithmetic must produce an exact integer.';

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

const operandError = (left: AssetExactNumber, right: AssetExactNumber): ExactResult | null => {
  const leftError = exactInputError(left);
  const rightError = exactInputError(right);
  if (leftError === null && rightError === null) return null;
  const limited =
    leftError === 'asset.value.rational-limit' || rightError === 'asset.value.rational-limit';
  return limited
    ? fail('asset.value.rational-limit', 'Exact arithmetic exceeds the numeric budget.')
    : fail('asset.value.invalid-number', 'Arithmetic operand has an invalid exact shape.');
};

const normalize = (
  numerator: bigint,
  denominator: bigint,
  unit: AssetExactNumber['unit'],
): ExactResult => {
  try {
    return succeed(assetExactNumber(numerator, denominator, unit));
  } catch (error) {
    return error instanceof AssetValueNumericLimitError
      ? fail('asset.value.rational-limit', 'Exact arithmetic exceeds the numeric budget.')
      : fail('asset.value.invalid-number', 'Exact arithmetic produced an invalid number.');
  }
};

/** Rejects a normalized plain result that is not an exact integer. */
const integralPlain = (result: ExactResult, message: string): ExactResult => {
  if (!result.ok) return result;
  return result.value.unit === 'plain' && result.value.denominator !== 1n
    ? fail('asset.value.invalid-type', message)
    : succeed(result.value);
};

const sum: ExactOperation = (operator, left, right) => {
  if (left.unit !== right.unit)
    return fail('asset.value.unit-mismatch', 'Arithmetic operands must use compatible units.');
  const leftScaled = left.numerator * right.denominator;
  const rightScaled = right.numerator * left.denominator;
  const numerator = operator === '+' ? leftScaled + rightScaled : leftScaled - rightScaled;
  return integralPlain(
    normalize(numerator, left.denominator * right.denominator, left.unit),
    PLAIN_INTEGER_MESSAGE,
  );
};

const isDimensionlessUnit = (unit: AssetExactNumber['unit']): boolean =>
  unit === 'plain' || unit === 'ratio';

const productUnit = (
  left: AssetExactNumber['unit'],
  right: AssetExactNumber['unit'],
): AssetExactNumber['unit'] => {
  if (left === 'plain') return right;
  if (right === 'plain') return left;
  return left === 'ratio' ? right : left;
};

const product: ExactOperation = (_operator, left, right) => {
  if (!isDimensionlessUnit(left.unit) && !isDimensionlessUnit(right.unit))
    return fail(
      'asset.value.invalid-operator',
      'Multiplication may have at most one dimensional operand.',
    );
  const normalized = normalize(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
    productUnit(left.unit, right.unit),
  );
  return integralPlain(normalized, PLAIN_INTEGER_MESSAGE);
};

const quotientUnit = (
  left: AssetExactNumber['unit'],
  right: AssetExactNumber['unit'],
): AssetExactNumber['unit'] => {
  if (left === 'ratio' && isDimensionlessUnit(right)) return 'ratio';
  if (left === 'plain' && right === 'ratio') return 'ratio';
  return right === left ? 'plain' : left;
};

const quotient: ExactOperation = (_operator, left, right) => {
  if (right.numerator === 0n)
    return fail('asset.value.division-by-zero', 'Division by zero is not allowed.');
  if (!isDimensionlessUnit(right.unit) && left.unit !== right.unit)
    return fail(
      'asset.value.unit-mismatch',
      'Division requires a plain divisor or matching units.',
    );
  const normalized = normalize(
    left.numerator * right.denominator,
    left.denominator * right.numerator,
    quotientUnit(left.unit, right.unit),
  );
  return integralPlain(normalized, 'A plain division result must be an exact integer.');
};

const remainder: ExactOperation = (_operator, left, right) => {
  if (right.numerator === 0n)
    return fail('asset.value.division-by-zero', 'Remainder by zero is not allowed.');
  if (
    left.unit !== 'plain' ||
    right.unit !== 'plain' ||
    left.denominator !== 1n ||
    right.denominator !== 1n
  )
    return fail('asset.value.invalid-operator', 'Remainder requires exact integer plain operands.');
  return normalize(left.numerator % right.numerator, 1n, 'plain');
};

const EXACT_OPERATIONS: ReadonlyMap<ProgramBinaryOperator, ExactOperation> = new Map([
  ['+', sum],
  ['-', sum],
  ['*', product],
  ['/', quotient],
  ['%', remainder],
]);

/** Apply a scalar operator without converting exact values to JavaScript numbers. */
export const assetExactOperation = (
  operator: ProgramBinaryOperator,
  left: AssetExactNumber,
  right: AssetExactNumber,
): ExactResult => {
  const invalid = operandError(left, right);
  if (invalid !== null) return invalid;
  const operation = EXACT_OPERATIONS.get(operator);
  return operation === undefined
    ? fail('asset.value.invalid-operator', 'Operator is not valid for exact scalar operands.')
    : operation(operator, left, right);
};
