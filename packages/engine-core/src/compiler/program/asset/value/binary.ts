import type { ProgramBinaryOperator } from '../../../../project/program/syntax/contract';
import {
  assetBooleanValue,
  assetVectorValue,
  type AssetExactNumber,
  type AssetNumberValue,
  type AssetValue,
  type AssetVectorValue,
} from './contract';
import { assetExactOperation, fail, succeed, type AssetOperationResult } from './arithmetic';
import { valueFromExact } from './runtime';

const equalEntry = (
  a: AssetValue,
  b: AssetValue,
  pending: Array<readonly [AssetValue, AssetValue]>,
): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'number') {
    const right = b as AssetNumberValue;
    return (
      a.value.unit === right.value.unit &&
      a.value.numerator * right.value.denominator === right.value.numerator * a.value.denominator
    );
  }
  if (a.kind === 'boolean') return b.kind === 'boolean' && a.value === b.value;
  if (a.kind === 'color') return b.kind === 'color' && a.value === b.value;
  const right = b as AssetVectorValue;
  if (a.type !== right.type || a.values.length !== right.values.length) return false;
  for (let index = 0; index < a.values.length; index += 1) {
    pending.push([a.values[index]!, right.values[index]!]);
  }
  return true;
};

const equalValue = (left: AssetValue, right: AssetValue): boolean => {
  const pending: Array<readonly [AssetValue, AssetValue]> = [[left, right]];
  while (pending.length > 0) {
    const [a, b] = pending.pop()!;
    if (!equalEntry(a, b, pending)) return false;
  }
  return true;
};

const RELATION_PREDICATES: ReadonlyMap<ProgramBinaryOperator, (relation: bigint) => boolean> =
  new Map([
    ['==', (relation) => relation === 0n],
    ['!=', (relation) => relation !== 0n],
    ['<', (relation) => relation < 0n],
    ['<=', (relation) => relation <= 0n],
    ['>', (relation) => relation > 0n],
    ['>=', (relation) => relation >= 0n],
  ]);

export const compareNumber = (
  operator: ProgramBinaryOperator,
  left: AssetExactNumber,
  right: AssetExactNumber,
): boolean | null => {
  if (left.unit !== right.unit) return null;
  const predicate = RELATION_PREDICATES.get(operator);
  if (predicate === undefined) return null;
  return predicate(left.numerator * right.denominator - right.numerator * left.denominator);
};

const evaluateEquality = (
  operator: '==' | '!=',
  left: AssetValue,
  right: AssetValue,
): AssetOperationResult<AssetValue> => {
  if (left.kind === 'number' && right.kind === 'number') {
    const compared = compareNumber(operator, left.value, right.value);
    return compared === null
      ? fail('asset.value.unit-mismatch', 'Comparison operands must use compatible units.')
      : succeed(assetBooleanValue(compared));
  }
  const same = equalValue(left, right);
  return succeed(assetBooleanValue(operator === '==' ? same : !same));
};

const evaluateOrderedComparison = (
  operator: ProgramBinaryOperator,
  left: AssetValue,
  right: AssetValue,
): AssetOperationResult<AssetValue> => {
  if (left.kind !== 'number' || right.kind !== 'number') {
    return fail('asset.value.invalid-operator', 'Ordered comparisons require numbers.');
  }
  const compared = compareNumber(operator, left.value, right.value);
  return compared === null
    ? fail('asset.value.unit-mismatch', 'Comparison operands must use compatible units.')
    : succeed(assetBooleanValue(compared));
};

const evaluateNumberBinary = (
  operator: ProgramBinaryOperator,
  left: AssetNumberValue,
  right: AssetNumberValue,
): AssetOperationResult<AssetValue> => {
  const result = assetExactOperation(operator, left.value, right.value);
  if (!result.ok) return result;
  const value = valueFromExact(result.value);
  return value === null
    ? fail('asset.value.invalid-type', 'Plain arithmetic must produce an exact integer.')
    : succeed(value);
};

const toVectorComponent = (
  operator: ProgramBinaryOperator,
  left: AssetExactNumber,
  right: AssetExactNumber,
): AssetOperationResult<AssetNumberValue> => {
  const result = assetExactOperation(operator, left, right);
  if (!result.ok) return result;
  const value = valueFromExact(result.value);
  return value === null
    ? fail('asset.value.invalid-type', 'Vector arithmetic must remain in the closed value ABI.')
    : succeed(value);
};

const evaluateVectorPair = (
  operator: ProgramBinaryOperator,
  left: AssetVectorValue,
  right: AssetVectorValue,
): AssetOperationResult<AssetValue> => {
  if ((operator !== '+' && operator !== '-') || left.type !== right.type) {
    return fail('asset.value.unit-mismatch', 'Vector operands must have the same shape and unit.');
  }
  const values: AssetNumberValue[] = [];
  for (let index = 0; index < left.values.length; index += 1) {
    const component = toVectorComponent(
      operator,
      left.values[index]!.value,
      right.values[index]!.value,
    );
    if (!component.ok) return component;
    values.push(component.value);
  }
  return succeed(assetVectorValue(values, left.type));
};

const evaluateVectorScale = (
  operator: ProgramBinaryOperator,
  left: AssetValue,
  right: AssetValue,
): AssetOperationResult<AssetValue> => {
  const vector = left.kind === 'vector' ? left : (right as AssetVectorValue);
  const scalar = left.kind === 'vector' ? right : left;
  if (
    scalar.kind !== 'number' ||
    scalar.value.unit !== 'plain' ||
    (left.kind !== 'vector' && operator !== '*')
  ) {
    return fail('asset.value.invalid-operator', 'Vector scaling requires a plain scalar operand.');
  }
  const values: AssetNumberValue[] = [];
  for (const entry of vector.values) {
    const component = toVectorComponent(
      operator,
      left.kind === 'vector' ? entry.value : scalar.value,
      left.kind === 'vector' ? scalar.value : entry.value,
    );
    if (!component.ok) return component;
    values.push(component.value);
  }
  return succeed(assetVectorValue(values, vector.type));
};

export const evaluateAssetBinary = (
  operator: ProgramBinaryOperator,
  left: AssetValue,
  right: AssetValue,
): AssetOperationResult<AssetValue> => {
  if (operator === '==' || operator === '!=') return evaluateEquality(operator, left, right);
  if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
    return evaluateOrderedComparison(operator, left, right);
  }
  if (left.kind === 'number' && right.kind === 'number') {
    return evaluateNumberBinary(operator, left, right);
  }
  if (left.kind === 'vector' && right.kind === 'vector') {
    return evaluateVectorPair(operator, left, right);
  }
  if (left.kind === 'vector' || right.kind === 'vector') {
    return evaluateVectorScale(operator, left, right);
  }
  return fail('asset.value.invalid-operator', 'Operator requires numeric or vector operands.');
};
