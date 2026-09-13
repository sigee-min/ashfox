import assert from 'node:assert/strict';
import {
  ASSET_EXACT_INTEGER_BITS, AssetValueNumericLimitError, assetExactNumber,
  isAssetExactNumberWithinBudget
} from '../../../src/compiler/program/asset/value/contract';

const limit = 1n << BigInt(ASSET_EXACT_INTEGER_BITS);
const previous = (n: bigint, d: bigint): boolean => [n, d].every(value => {
  const absolute = value < 0n ? -value : value;
  return absolute === 0n || absolute.toString(2).length <= ASSET_EXACT_INTEGER_BITS;
});
// Exact boundaries around every power of two, for both signs and both fields.
for (let bit = 0; bit <= 514; bit++) {
  for (const delta of [-1n, 0n, 1n]) {
    for (const sign of [-1n, 1n]) {
      const value = ((1n << BigInt(bit)) + delta) * sign;
      assert.equal(isAssetExactNumberWithinBudget(value, 1n), previous(value, 1n));
      assert.equal(isAssetExactNumberWithinBudget(1n, value), previous(1n, value));
    }
  }
}
for (const invalid of [0, '1', null, undefined, {}, Object(1n)]) {
  assert.equal(Reflect.apply(isAssetExactNumberWithinBudget, null, [invalid, 1n]), false);
  assert.equal(Reflect.apply(isAssetExactNumberWithinBudget, null, [1n, invalid]), false);
}
assert.equal(isAssetExactNumberWithinBudget(0n, 0n), true, 'This helper checks magnitude only');
assert.throws(() => assetExactNumber(0n, 0n, 'unit'), /denominator cannot be zero/);
for (const oversized of [limit, -limit, limit + 1n, 1n << 10000n]) {
  assert.throws(() => assetExactNumber(oversized, 1n, 'unit'), AssetValueNumericLimitError);
  assert.throws(() => assetExactNumber(1n, oversized, 'unit'), AssetValueNumericLimitError);
  assert.throws(() => assetExactNumber(oversized, oversized, 'unit'), AssetValueNumericLimitError);
}
for (const n of [0n, 1n, -1n, 42n, -42n, limit - 1n, 1n - limit]) {
  for (const d of [1n, -1n]) {
    const value = assetExactNumber(n, d, 'unit');
    assert.deepEqual(value, { numerator: n * d, denominator: 1n, unit: 'unit' });
    assert.ok(Object.isFrozen(value));
  }
}
assert.deepEqual(assetExactNumber(6n, -8n, 'unit'), { numerator: -3n, denominator: 4n, unit: 'unit' });
assert.deepEqual(assetExactNumber(0n, -8n, 'unit'), { numerator: 0n, denominator: 1n, unit: 'unit' });
console.log('Exact numbers: signed bit boundaries, invalid inputs, integral normalization and rational reduction pass');
