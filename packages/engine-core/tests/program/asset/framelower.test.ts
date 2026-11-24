import assert from 'node:assert/strict';

import type { Vec3 } from '../../../src/model/identity';
import { canonicalQuaternionFromEuler } from '../../../src/model/transform';
import { lowerAssetFrameToBoneTransform } from '../../../src/compiler/program/asset/frameLower';
import { assetExactNumber } from '../../../src/compiler/program/asset/value/contract';
import type { AssetExactFrame, AssetSignedAxis } from '../../../src/compiler/program/asset/frame';

const axis = (x: -1 | 0 | 1, y: -1 | 0 | 1, z: -1 | 0 | 1): AssetSignedAxis =>
  Object.freeze([x, y, z]);

const origin = (x: bigint, y: bigint, z: bigint, denominator = 1n): AssetExactFrame['origin'] =>
  Object.freeze([
    assetExactNumber(x, denominator, 'unit'),
    assetExactNumber(y, denominator, 'unit'),
    assetExactNumber(z, denominator, 'unit'),
  ]);

const frame = (
  value: AssetExactFrame['origin'],
  xAxis: AssetSignedAxis,
  yAxis: AssetSignedAxis,
  zAxis: AssetSignedAxis,
  determinant: -1 | 1,
): AssetExactFrame =>
  Object.freeze({
    origin: value,
    xAxis,
    yAxis,
    zAxis,
    determinant,
  });

const identity = frame(origin(0n, 0n, 0n), axis(1, 0, 0), axis(0, 1, 0), axis(0, 0, 1), 1);

const matrixFromEuler = (rotation: Vec3): readonly (readonly number[])[] => {
  const [x, y, z, w] = canonicalQuaternionFromEuler(rotation);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
};

const assertMatrixEquivalent = (
  value: NonNullable<ReturnType<typeof lowerAssetFrameToBoneTransform>>,
  expected: AssetExactFrame,
): void => {
  const rotation = matrixFromEuler(value.rotation);
  const scale = value.scale;
  const columns = [expected.xAxis, expected.yAxis, expected.zAxis];
  for (let row = 0; row < 3; row += 1)
    for (let column = 0; column < 3; column += 1) {
      assert.ok(
        Math.abs(rotation[row]![column]! * scale[column]! - columns[column]![row]!) < 0.000001,
        `matrix mismatch at ${row},${column}`,
      );
    }
};

const parity = (permutation: readonly number[]): -1 | 1 => {
  let inversions = 0;
  for (let left = 0; left < 3; left += 1)
    for (let right = left + 1; right < 3; right += 1) {
      if (permutation[left]! > permutation[right]!) inversions += 1;
    }
  return inversions % 2 === 0 ? 1 : -1;
};

const permutations = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const;

const first = lowerAssetFrameToBoneTransform(identity);
assert.deepEqual(first, {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  pivot: [0, 0, 0],
});
assert.ok(first !== null);
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(first.position));
assert.ok(Object.isFrozen(first.rotation));
assert.ok(Object.isFrozen(first.scale));
assert.ok(Object.isFrozen(first.pivot));

const quarterX = frame(origin(0n, 0n, 0n), axis(1, 0, 0), axis(0, 0, 1), axis(0, -1, 0), 1);
const quarterZ = frame(origin(0n, 0n, 0n), axis(0, 1, 0), axis(-1, 0, 0), axis(0, 0, 1), 1);
assert.deepEqual(lowerAssetFrameToBoneTransform(quarterX)?.rotation, [90, 0, 0]);
assert.deepEqual(lowerAssetFrameToBoneTransform(quarterZ)?.rotation, [0, 0, 90]);

let frameCount = 0;
for (const permutation of permutations)
  for (const x of [-1, 1] as const) {
    for (const y of [-1, 1] as const)
      for (const z of [-1, 1] as const) {
        const signs = [x, y, z];
        const columns: AssetSignedAxis[] = [];
        for (let column = 0; column < 3; column += 1) {
          const values: [-1 | 0 | 1, -1 | 0 | 1, -1 | 0 | 1] = [0, 0, 0];
          values[permutation[column]!] = signs[column]!;
          columns.push(axis(values[0], values[1], values[2]));
        }
        const determinant = (parity(permutation) * x * y * z) as -1 | 1;
        const candidate = frame(
          origin(0n, 0n, 0n),
          columns[0]!,
          columns[1]!,
          columns[2]!,
          determinant,
        );
        const lowered = lowerAssetFrameToBoneTransform(candidate);
        assert.ok(lowered !== null);
        if (lowered !== null) {
          assert.deepEqual(lowered.scale, determinant === -1 ? [-1, 1, 1] : [1, 1, 1]);
          assertMatrixEquivalent(lowered, candidate);
        }
        frameCount += 1;
      }
  }
assert.equal(frameCount, 48);

const reflected = frame(origin(0n, 0n, 0n), axis(-1, 0, 0), axis(0, 1, 0), axis(0, 0, 1), -1);
const reflectedLowering = lowerAssetFrameToBoneTransform(reflected);
assert.ok(reflectedLowering !== null);
assert.deepEqual(reflectedLowering?.scale, [-1, 1, 1]);
assert.deepEqual(reflectedLowering?.rotation, [0, 0, 0]);

const placed = frame(
  Object.freeze([
    assetExactNumber(3n, 2n, 'unit'),
    assetExactNumber(-7n, 1n, 'unit'),
    assetExactNumber(5n, 2n, 'unit'),
  ]),
  axis(1, 0, 0),
  axis(0, 1, 0),
  axis(0, 0, 1),
  1,
);
const placedLowering = lowerAssetFrameToBoneTransform(placed);
assert.deepEqual(placedLowering?.pivot, [1.5, -7, 2.5]);
assert.deepEqual(placedLowering, lowerAssetFrameToBoneTransform(placed));

const unsafeInteger = frame(
  origin(1n << 60n, 0n, 0n),
  axis(1, 0, 0),
  axis(0, 1, 0),
  axis(0, 0, 1),
  1,
);
assert.equal(lowerAssetFrameToBoneTransform(unsafeInteger), null);
const malformed = {
  ...identity,
  origin: [
    { numerator: 0n, denominator: 0n, unit: 'unit' },
    identity.origin[1],
    identity.origin[2],
  ],
} as unknown as AssetExactFrame;
assert.equal(lowerAssetFrameToBoneTransform(malformed), null);
const invalidAxes = frame(origin(0n, 0n, 0n), axis(1, 0, 0), axis(1, 0, 0), axis(0, 0, 1), 1);
assert.equal(lowerAssetFrameToBoneTransform(invalidAxes), null);

console.log('asset exact frame canonical lowering ok');
