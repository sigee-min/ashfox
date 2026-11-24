'use strict';

const assert = require('node:assert/strict');
const { canonical, compareReports, exampleInputs } = require('./products');

const report = (inputs) => ({ format: 'ashfox-product-oracle', version: 1, inputs });
const built = (input, sha) => ({ input, ok: true, files: [{ path: 'assets/a.png', sha256: sha }] });

assert.deepEqual(canonical({ b: 1, a: [new Uint8Array([1])] }), {
  a: [{ bytes: '4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a' }],
  b: 1,
});
assert.equal(JSON.stringify(canonical({ b: 1, a: 2 })), '{"a":2,"b":1}');

assert.deepEqual(compareReports(report([built('x', '1')]), report([built('x', '1')])), []);
assert.deepEqual(compareReports(report([built('x', '1')]), report([built('x', '2')])), [
  'x: output changed (assets/a.png)',
]);
assert.deepEqual(compareReports(report([built('x', '1')]), report([])), [
  'x: missing from current build',
]);
assert.deepEqual(compareReports(report([]), report([built('y', '1')])), [
  'y: new input not in baseline',
]);
assert.deepEqual(
  compareReports(
    report([{ input: 'z', ok: false, code: 'a' }]),
    report([{ input: 'z', ok: false, code: 'b' }]),
  ),
  ['z: output changed'],
);

const inputs = exampleInputs();
assert.ok(inputs.includes('examples/game-assets/.ashfoxworkspace'));
assert.ok(inputs.includes('examples/fox/creatures/fox.ashfox'));
assert.deepEqual(inputs, [...inputs].sort());

console.log('ashfox product oracle tests ok');
