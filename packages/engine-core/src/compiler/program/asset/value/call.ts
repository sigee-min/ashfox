import {
  assetExactNumber,
  assetVectorValue,
  type AssetExactNumber,
  type AssetNumberValue,
  type AssetTypedCallExpression,
  type AssetValue,
} from './contract';
import { fail, succeed, type AssetOperationResult } from './arithmetic';
import { compareNumber } from './binary';
import { evaluateDesignCall } from './relation';
import { valueFromExact } from './runtime';
import { assetVectorComponent, assetVectorType } from './types';

type CallName = AssetTypedCallExpression['name'];
type DesignCallName = 'texels' | 'mirror_x' | 'mirror_y' | 'mirror_z' | 'box_origin';

const DESIGN_CALLS: ReadonlySet<CallName> = new Set([
  'texels',
  'mirror_x',
  'mirror_y',
  'mirror_z',
  'box_origin',
]);

const exactResult = (exact: AssetExactNumber): AssetOperationResult<AssetValue> => {
  const result = valueFromExact(exact);
  return result === null
    ? fail('asset.value.invalid-type', 'Plain arithmetic must produce an exact integer.')
    : succeed(result);
};

const evaluateVectorCall = (
  name: 'vec2' | 'vec3',
  args: readonly AssetValue[],
): AssetOperationResult<AssetValue> => {
  const arity = name === 'vec2' ? 2 : 3;
  if (args.length !== arity || args.some((value) => value.kind !== 'number')) {
    return fail('asset.value.invalid-call', `${name} requires exactly ${arity} numeric arguments.`);
  }
  const numbers = args as readonly AssetNumberValue[];
  const component = assetVectorComponent(numbers.map((entry) => entry.type));
  const type =
    component === null || component === 'plain' ? null : assetVectorType(arity, component);
  return type === null
    ? fail('asset.value.invalid-vector', 'Vector arguments must use one supported shared unit.')
    : succeed(assetVectorValue(numbers, type));
};

const evaluateAbs = (first: AssetExactNumber): AssetOperationResult<AssetValue> =>
  exactResult(
    assetExactNumber(
      first.numerator < 0n ? -first.numerator : first.numerator,
      first.denominator,
      first.unit,
    ),
  );

const evaluateMinMax = (
  operator: '<' | '>',
  numbers: readonly AssetNumberValue[],
): AssetOperationResult<AssetValue> => {
  let selected = numbers[0]!.value;
  for (const entry of numbers.slice(1)) {
    const relation = compareNumber(operator, entry.value, selected);
    if (relation === null) {
      return fail('asset.value.unit-mismatch', 'Function arguments must use one shared unit.');
    }
    if (relation) selected = entry.value;
  }
  return exactResult(selected);
};

const evaluateClamp = (numbers: readonly AssetNumberValue[]): AssetOperationResult<AssetValue> => {
  const target = numbers[0]!.value;
  const lower = compareNumber('<', target, numbers[1]!.value);
  const upper = compareNumber('>', target, numbers[2]!.value);
  if (lower === null || upper === null) {
    return fail('asset.value.unit-mismatch', 'Clamp arguments must use one shared unit.');
  }
  const selected = lower ? numbers[1]!.value : upper ? numbers[2]!.value : target;
  return exactResult(selected);
};

const hasValidNumericCount = (name: 'abs' | 'min' | 'max' | 'clamp', count: number): boolean => {
  if (name === 'abs') return count === 1;
  if (name === 'clamp') return count === 3;
  return count >= 1;
};

const evaluateNumericCall = (
  name: 'abs' | 'min' | 'max' | 'clamp',
  args: readonly AssetValue[],
): AssetOperationResult<AssetValue> => {
  if (!hasValidNumericCount(name, args.length)) {
    return fail('asset.value.invalid-call', 'Function received an invalid argument count.');
  }
  if (args.some((value) => value.kind !== 'number')) {
    return fail('asset.value.invalid-type', `${name} requires numeric arguments.`);
  }
  const numbers = args as readonly AssetNumberValue[];
  const first = numbers[0]!;
  if (numbers.some((value) => value.value.unit !== first.value.unit)) {
    return fail('asset.value.unit-mismatch', 'Function arguments must use one shared unit.');
  }
  if (name === 'abs') return evaluateAbs(first.value);
  if (name === 'clamp') return evaluateClamp(numbers);
  return evaluateMinMax(name === 'min' ? '<' : '>', numbers);
};

export const evaluateAssetCall = (
  name: CallName,
  args: readonly AssetValue[],
): AssetOperationResult<AssetValue> => {
  if (DESIGN_CALLS.has(name)) return evaluateDesignCall(name as DesignCallName, args);
  if (name === 'vec2' || name === 'vec3') return evaluateVectorCall(name, args);
  return evaluateNumericCall(name as 'abs' | 'min' | 'max' | 'clamp', args);
};
