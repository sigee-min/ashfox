import {
  assetExactNumber,
  assetNumberValue,
  assetVectorValue,
  AssetValueNumericLimitError,
  type AssetNumberValue,
  type AssetValue
} from './value/contract';
import type { AssetOperationResult } from './valueArithmetic';

type DesignCall = 'texels' | 'mirror_x' | 'mirror_y' | 'mirror_z' | 'box_origin';

const fail = (message: string): AssetOperationResult<never> => Object.freeze({
  ok: false, code: 'asset.value.invalid-call', message
});

/** Exact, explicit construction relations; no fitting, rounding, or solver state. */
export const evaluateDesignCall = (
  name: DesignCall,
  args: readonly AssetValue[]
): AssetOperationResult<AssetValue> => {
  try {
    const [point, second, alignment] = args;
    if (name === 'texels') {
      if (args.length !== 2 || point?.kind !== 'number' || point.type !== 'unit' ||
          second?.kind !== 'number' || second.type !== 'integer' ||
          second.value.denominator !== 1n || second.value.numerator <= 0n ||
          point.value.numerator < 0n) return fail('texels requires a nonnegative length and positive integral pixels per unit.');
      const value = assetExactNumber(point.value.numerator * second.value.numerator,
        point.value.denominator, 'texel');
      if (value.denominator !== 1n) return fail('texels conversion must land exactly on the pixel grid.');
      return Object.freeze({ ok: true, value: assetNumberValue(value) });
    }
    if (point?.kind !== 'vector' || point.type !== 'vec3<unit>') {
      return fail(name + ' requires a unit point.');
    }
    const values: AssetNumberValue[] = [];
    if (name === 'box_origin') {
      if (args.length !== 3 || second?.kind !== 'vector' || second.type !== 'vec3<unit>' ||
          alignment?.kind !== 'vector' || alignment.type !== 'vec3<ratio>') {
        return fail('box_origin requires a point, positive size, and alignment ratios in [0, 1].');
      }
      for (let index = 0; index < 3; index += 1) {
        const p = point.values[index]!.value;
        const s = second.values[index]!.value;
        const a = alignment.values[index]!.value;
        if (s.numerator <= 0n || a.numerator < 0n || a.numerator > a.denominator) {
          return fail('box_origin requires positive dimensions and alignment ratios in [0, 1].');
        }
        values.push(assetNumberValue(assetExactNumber(
          p.numerator * s.denominator * a.denominator - s.numerator * a.numerator * p.denominator,
          p.denominator * s.denominator * a.denominator, 'unit')));
      }
    } else {
      if (args.length !== 2 || second?.kind !== 'number' || second.type !== 'unit') {
        return fail(name + ' requires a unit point and explicit unit plane coordinate.');
      }
      const axis = name === 'mirror_x' ? 0 : name === 'mirror_y' ? 1 : 2;
      for (let index = 0; index < 3; index += 1) {
        const p = point.values[index]!.value;
        const plane = second.value;
        values.push(index !== axis ? point.values[index]! : assetNumberValue(assetExactNumber(
          2n * plane.numerator * p.denominator - p.numerator * plane.denominator,
          plane.denominator * p.denominator, 'unit')));
      }
    }
    return Object.freeze({ ok: true, value: assetVectorValue(values, 'vec3<unit>') });
  } catch (error) {
    return Object.freeze({ ok: false,
      code: error instanceof AssetValueNumericLimitError ? 'asset.value.rational-limit' : 'asset.value.invalid-call',
      message: 'Design relation exceeds the exact value contract.' });
  }
};
