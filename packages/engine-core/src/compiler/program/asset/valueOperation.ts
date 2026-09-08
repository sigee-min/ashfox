import type { ProgramBinaryOperator } from '../../../project/program/syntax/contract';
import {
  assetBooleanValue,
  assetExactNumber,
  assetVectorValue,
  type AssetExactNumber,
  type AssetNumberValue,
  type AssetValue,
  type AssetValueDiagnosticCode
} from './value/contract';
import type { AssetTypedCallExpression } from './value/contract';
import { evaluateDesignCall } from './designCall';
import {
  assetExactOperation,
  type AssetOperationResult
} from './valueArithmetic';
import { assetVectorComponent, assetVectorType } from './valueTypes';
import { valueFromExact } from './valueRuntime';

const freeze = <T>(value: T): T => Object.freeze(value);

const success = <T>(value: T): AssetOperationResult<T> =>
  freeze({ ok: true, value });

const failure = (
  code: AssetValueDiagnosticCode,
  message: string
): AssetOperationResult<never> => freeze({ ok: false, code, message });

const equalValue = (left: AssetValue, right: AssetValue): boolean => {
  const pending: Array<readonly [AssetValue, AssetValue]> = [[left, right]];
  while (pending.length > 0) {
    const [a, b] = pending.pop()!;
    if (a.kind !== b.kind) return false;
    if (a.kind === 'number' && b.kind === 'number') {
      if (a.value.unit !== b.value.unit ||
        a.value.numerator * b.value.denominator !==
          b.value.numerator * a.value.denominator) return false;
    } else if (a.kind === 'boolean' && b.kind === 'boolean') {
      if (a.value !== b.value) return false;
    } else if (a.kind === 'color' && b.kind === 'color') {
      if (a.value !== b.value) return false;
    } else if (a.kind === 'vector' && b.kind === 'vector') {
      if (a.type !== b.type || a.values.length !== b.values.length) return false;
      for (let index = 0; index < a.values.length; index += 1) {
        pending.push([a.values[index]!, b.values[index]!]);
      }
    }
  }
  return true;
};

const compareNumber = (
  operator: ProgramBinaryOperator,
  left: AssetExactNumber,
  right: AssetExactNumber
): boolean | null => {
  if (left.unit !== right.unit) return null;
  const relation = left.numerator * right.denominator -
    right.numerator * left.denominator;
  if (operator === '==') return relation === 0n;
  if (operator === '!=') return relation !== 0n;
  if (operator === '<') return relation < 0n;
  if (operator === '<=') return relation <= 0n;
  if (operator === '>') return relation > 0n;
  if (operator === '>=') return relation >= 0n;
  return null;
};

export const evaluateAssetCall = (
  name: AssetTypedCallExpression['name'],
  args: readonly AssetValue[]
): AssetOperationResult<AssetValue> => {
  if (name === 'texels' || name === 'mirror_x' || name === 'mirror_y' ||
      name === 'mirror_z' || name === 'box_origin') return evaluateDesignCall(name, args);
  if (name === 'vec2' || name === 'vec3') {
    const arity = name === 'vec2' ? 2 : 3;
    if (args.length !== arity || args.some(
      (value) => value.kind !== 'number')) return failure(
      'asset.value.invalid-call',
      `${name} requires exactly ${arity} numeric arguments.`);
    const numbers = args as readonly AssetNumberValue[];
    const component = assetVectorComponent(numbers.map((entry) => entry.type));
    const type = component === null || component === 'plain' ? null :
      assetVectorType(arity, component);
    return type === null ? failure(
      'asset.value.invalid-vector',
      'Vector arguments must use one supported shared unit.') :
      success(assetVectorValue(numbers, type));
  }
  const validCount = name === 'abs' ? args.length === 1 :
    name === 'clamp' ? args.length === 3 : args.length >= 1;
  if (!validCount) return failure('asset.value.invalid-call',
    'Function received an invalid argument count.');
  if (args.some((value) => value.kind !== 'number')) return failure(
    'asset.value.invalid-type', `${name} requires numeric arguments.`);
  const numbers = args as readonly AssetNumberValue[];
  const first = numbers[0]!;
  if (numbers.some((value) => value.value.unit !== first.value.unit)) {
    return failure('asset.value.unit-mismatch',
      'Function arguments must use one shared unit.');
  }
  if (name === 'abs') {
    const value = assetExactNumber(first.value.numerator < 0n
      ? -first.value.numerator : first.value.numerator,
    first.value.denominator, first.value.unit);
    const result = valueFromExact(value);
    return result === null ? failure('asset.value.invalid-type',
      'Plain arithmetic must produce an exact integer.') : success(result);
  }
  if (name === 'min' || name === 'max') {
    let selected = first.value;
    for (const entry of numbers.slice(1)) {
      const relation = compareNumber(
        name === 'min' ? '<' : '>', entry.value, selected);
      if (relation === null) return failure('asset.value.unit-mismatch',
        'Function arguments must use one shared unit.');
      if (relation) selected = entry.value;
    }
    const result = valueFromExact(selected);
    return result === null ? failure('asset.value.invalid-type',
      'Plain arithmetic must produce an exact integer.') : success(result);
  }
  const lower = compareNumber('<', first.value, numbers[1]!.value);
  const upper = compareNumber('>', first.value, numbers[2]!.value);
  if (lower === null || upper === null) return failure(
    'asset.value.unit-mismatch',
    'Clamp arguments must use one shared unit.');
  const selected = lower ? numbers[1]!.value :
    upper ? numbers[2]!.value : first.value;
  const result = valueFromExact(selected);
  return result === null ? failure('asset.value.invalid-type',
    'Plain arithmetic must produce an exact integer.') : success(result);
};

export const evaluateAssetBinary = (
  operator: ProgramBinaryOperator,
  left: AssetValue,
  right: AssetValue
): AssetOperationResult<AssetValue> => {
  if (operator === '==' || operator === '!=') {
    if (left.kind === 'number' && right.kind === 'number') {
      const compared = compareNumber(operator, left.value, right.value);
      return compared === null ? failure('asset.value.unit-mismatch',
        'Comparison operands must use compatible units.') :
        success(assetBooleanValue(compared));
    }
    return success(assetBooleanValue(operator === '=='
      ? equalValue(left, right) : !equalValue(left, right)));
  }
  if (operator === '<' || operator === '<=' || operator === '>' ||
      operator === '>=') {
    if (left.kind !== 'number' || right.kind !== 'number') return failure(
      'asset.value.invalid-operator', 'Ordered comparisons require numbers.');
    const compared = compareNumber(operator, left.value, right.value);
    return compared === null ? failure('asset.value.unit-mismatch',
      'Comparison operands must use compatible units.') :
      success(assetBooleanValue(compared));
  }
  if (left.kind === 'number' && right.kind === 'number') {
    const result = assetExactOperation(operator, left.value, right.value);
    if (!result.ok) return result;
    const value = valueFromExact(result.value);
    return value === null ? failure('asset.value.invalid-type',
      'Plain arithmetic must produce an exact integer.') : success(value);
  }
  if (left.kind === 'vector' || right.kind === 'vector') {
    if (left.kind === 'vector' && right.kind === 'vector') {
      if (operator !== '+' && operator !== '-' || left.type !== right.type) {
        return failure('asset.value.unit-mismatch',
          'Vector operands must have the same shape and unit.');
      }
      const values: AssetNumberValue[] = [];
      for (let index = 0; index < left.values.length; index += 1) {
        const result = assetExactOperation(operator,
          left.values[index]!.value, right.values[index]!.value);
        if (!result.ok) return result;
        const value = valueFromExact(result.value);
        if (value === null) return failure('asset.value.invalid-type',
          'Vector arithmetic must remain in the closed value ABI.');
        values.push(value);
      }
      return success(assetVectorValue(values, left.type));
    }
    const vector = left.kind === 'vector' ? left :
      right.kind === 'vector' ? right : null;
    const scalar = left.kind === 'vector' ? right : left;
    if (vector === null || scalar.kind !== 'number' ||
      scalar.value.unit !== 'plain' ||
      left.kind !== 'vector' && operator !== '*') return failure(
      'asset.value.invalid-operator',
      'Vector scaling requires a plain scalar operand.');
    const values: AssetNumberValue[] = [];
    for (const entry of vector.values) {
      const result = assetExactOperation(operator,
        left.kind === 'vector' ? entry.value : scalar.value,
        left.kind === 'vector' ? scalar.value : entry.value);
      if (!result.ok) return result;
      const value = valueFromExact(result.value);
      if (value === null) return failure('asset.value.invalid-type',
        'Vector arithmetic must remain in the closed value ABI.');
      values.push(value);
    }
    return success(assetVectorValue(values, vector.type));
  }
  return failure('asset.value.invalid-operator',
    'Operator requires numeric or vector operands.');
};
