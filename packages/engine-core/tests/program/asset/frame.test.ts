import assert from 'node:assert/strict';

import {
  composeAssetFrames,
  connectAssetFrames,
  equalAssetFrames,
  invertAssetFrame,
  isAssetExactFrame,
  type AssetExactFrame,
  type AssetSignedAxis,
} from '../../../src/compiler/program/asset/frame';
import { assetExactNumber } from '../../../src/compiler/program/asset/value/contract';

const origin = (x: bigint, y: bigint, z: bigint, denominator = 1n) =>
  Object.freeze([
    assetExactNumber(x, denominator, 'unit'),
    assetExactNumber(y, denominator, 'unit'),
    assetExactNumber(z, denominator, 'unit'),
  ]) as AssetExactFrame['origin'];

const axis = (x: -1 | 0 | 1, y: -1 | 0 | 1, z: -1 | 0 | 1) =>
  Object.freeze([x, y, z]) as AssetSignedAxis;

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
const provider = frame(origin(7n, 5n, -3n, 2n), axis(0, 1, 0), axis(-1, 0, 0), axis(0, 0, 1), 1);
const required = frame(origin(2n, -1n, 3n, 2n), axis(0, 0, 1), axis(0, 1, 0), axis(1, 0, 0), -1);

assert.equal(isAssetExactFrame(identity), true);
assert.equal(isAssetExactFrame(provider), true);
assert.equal(isAssetExactFrame(required), true);

const inverse = invertAssetFrame(required);
assert.notEqual(inverse, null);
const inverseRoundTrip = inverse === null ? null : composeAssetFrames(required, inverse);
assert.ok(inverseRoundTrip !== null && equalAssetFrames(inverseRoundTrip, identity));

const placement = connectAssetFrames(provider, required);
assert.notEqual(placement, null);
const endpointWorld = placement === null ? null : composeAssetFrames(placement, required);
assert.ok(endpointWorld !== null && equalAssetFrames(endpointWorld, provider));

assert.equal(Object.isFrozen(placement), true);
assert.equal(Object.isFrozen(placement?.origin), true);

const invalid = frame(origin(0n, 0n, 0n), axis(1, 0, 0), axis(1, 0, 0), axis(0, 0, 1), 1);
assert.equal(isAssetExactFrame(invalid), false);
assert.equal(connectAssetFrames(provider, invalid), null);

assert.equal(isAssetExactFrame(null), false);
assert.equal(isAssetExactFrame({}), false);
assert.equal(
  isAssetExactFrame({ ...identity, origin: [...identity.origin, identity.origin[0]] }),
  false,
);
assert.equal(isAssetExactFrame({ ...identity, xAxis: [...identity.xAxis, 99] }), false);
assert.equal(
  isAssetExactFrame({
    ...identity,
    origin: [
      { numerator: 0, denominator: 1n, unit: 'unit' },
      identity.origin[1],
      identity.origin[2],
    ],
  }),
  false,
);
assert.equal(
  isAssetExactFrame({
    ...identity,
    origin: [
      { numerator: 2n, denominator: 2n, unit: 'unit' },
      identity.origin[1],
      identity.origin[2],
    ],
  }),
  false,
);
assert.equal(
  equalAssetFrames(identity, {
    ...identity,
    origin: [
      { numerator: 2n, denominator: 2n, unit: 'unit' },
      identity.origin[1],
      identity.origin[2],
    ],
  }),
  false,
);
assert.equal(
  isAssetExactFrame({
    ...identity,
    origin: [
      { numerator: 1n << 513n, denominator: 1n, unit: 'unit' },
      identity.origin[1],
      identity.origin[2],
    ],
  }),
  false,
);

const firstLarge = frame(
  origin(1n, 0n, 0n, (1n << 510n) - 1n),
  axis(1, 0, 0),
  axis(0, 1, 0),
  axis(0, 0, 1),
  1,
);
const secondLarge = frame(
  origin(1n, 0n, 0n, (1n << 509n) - 1n),
  axis(1, 0, 0),
  axis(0, 1, 0),
  axis(0, 0, 1),
  1,
);
assert.doesNotThrow(() => composeAssetFrames(firstLarge, secondLarge));
assert.equal(composeAssetFrames(firstLarge, secondLarge), null);
