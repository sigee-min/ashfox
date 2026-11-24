import {
  assetExactNumber,
  assetNumberValue,
  assetVectorValue,
  AssetValueNumericLimitError,
  type AssetExactNumber,
  type AssetNumberValue,
  type AssetValue,
  type AssetVectorValue,
} from './contract';
import type { AssetOperationResult } from './arithmetic';

type DesignCall = 'texels' | 'mirror_x' | 'mirror_y' | 'mirror_z' | 'box_origin';

const fail = (message: string): AssetOperationResult<never> =>
  Object.freeze({
    ok: false,
    code: 'asset.value.invalid-call',
    message,
  });

const isTexelsInput = (args: readonly AssetValue[]): boolean => {
  const [point, second] = args;
  if (args.length !== 2 || point?.kind !== 'number' || second?.kind !== 'number') return false;
  return (
    point.type === 'unit' &&
    point.value.numerator >= 0n &&
    second.type === 'integer' &&
    second.value.denominator === 1n &&
    second.value.numerator > 0n
  );
};

const evaluateTexels = (args: readonly AssetValue[]): AssetOperationResult<AssetValue> => {
  if (!isTexelsInput(args)) {
    return fail('texels requires a nonnegative length and positive integral pixels per unit.');
  }
  const point = args[0] as AssetNumberValue;
  const second = args[1] as AssetNumberValue;
  const value = assetExactNumber(
    point.value.numerator * second.value.numerator,
    point.value.denominator,
    'texel',
  );
  if (value.denominator !== 1n) {
    return fail('texels conversion must land exactly on the pixel grid.');
  }
  return Object.freeze({ ok: true, value: assetNumberValue(value) });
};

const boxOriginAxis = (
  p: AssetExactNumber,
  s: AssetExactNumber,
  a: AssetExactNumber,
): AssetNumberValue | null => {
  if (s.numerator <= 0n || a.numerator < 0n || a.numerator > a.denominator) return null;
  return assetNumberValue(
    assetExactNumber(
      p.numerator * s.denominator * a.denominator - s.numerator * a.numerator * p.denominator,
      p.denominator * s.denominator * a.denominator,
      'unit',
    ),
  );
};

const isBoxOriginInput = (
  argCount: number,
  second: AssetValue | undefined,
  alignment: AssetValue | undefined,
): boolean =>
  argCount === 3 &&
  second?.kind === 'vector' &&
  second.type === 'vec3<unit>' &&
  alignment?.kind === 'vector' &&
  alignment.type === 'vec3<ratio>';

const evaluateBoxOrigin = (
  point: AssetVectorValue,
  second: AssetValue | undefined,
  alignment: AssetValue | undefined,
  argCount: number,
): AssetOperationResult<AssetValue> => {
  if (!isBoxOriginInput(argCount, second, alignment)) {
    return fail('box_origin requires a point, positive size, and alignment ratios in [0, 1].');
  }
  const size = second as AssetVectorValue;
  const ratio = alignment as AssetVectorValue;
  const values: AssetNumberValue[] = [];
  for (let index = 0; index < 3; index += 1) {
    const entry = boxOriginAxis(
      point.values[index]!.value,
      size.values[index]!.value,
      ratio.values[index]!.value,
    );
    if (entry === null) {
      return fail('box_origin requires positive dimensions and alignment ratios in [0, 1].');
    }
    values.push(entry);
  }
  return Object.freeze({ ok: true, value: assetVectorValue(values, 'vec3<unit>') });
};

const evaluateMirror = (
  name: DesignCall,
  point: AssetVectorValue,
  second: AssetValue | undefined,
  argCount: number,
): AssetOperationResult<AssetValue> => {
  if (argCount !== 2 || second?.kind !== 'number' || second.type !== 'unit') {
    return fail(name + ' requires a unit point and explicit unit plane coordinate.');
  }
  const axis = name === 'mirror_x' ? 0 : name === 'mirror_y' ? 1 : 2;
  const plane = second.value;
  const values: AssetNumberValue[] = [];
  for (let index = 0; index < 3; index += 1) {
    if (index !== axis) {
      values.push(point.values[index]!);
      continue;
    }
    const p = point.values[index]!.value;
    values.push(
      assetNumberValue(
        assetExactNumber(
          2n * plane.numerator * p.denominator - p.numerator * plane.denominator,
          plane.denominator * p.denominator,
          'unit',
        ),
      ),
    );
  }
  return Object.freeze({ ok: true, value: assetVectorValue(values, 'vec3<unit>') });
};

/** Exact, explicit construction relations; no fitting, rounding, or solver state. */
export const evaluateDesignCall = (
  name: DesignCall,
  args: readonly AssetValue[],
): AssetOperationResult<AssetValue> => {
  try {
    if (name === 'texels') return evaluateTexels(args);
    const [point, second, alignment] = args;
    if (point?.kind !== 'vector' || point.type !== 'vec3<unit>') {
      return fail(name + ' requires a unit point.');
    }
    return name === 'box_origin'
      ? evaluateBoxOrigin(point, second, alignment, args.length)
      : evaluateMirror(name, point, second, args.length);
  } catch (error) {
    return Object.freeze({
      ok: false,
      code:
        error instanceof AssetValueNumericLimitError
          ? 'asset.value.rational-limit'
          : 'asset.value.invalid-call',
      message: 'Design relation exceeds the exact value contract.',
    });
  }
};
