import assert from 'node:assert/strict';

import { createValidationContext } from '../../src/validation/context';
import type { InvariantFinding } from '../../src/validation/contract';

const context = createValidationContext();
const source: InvariantFinding = {
  code: 'document.required_value',
  severity: 'error',
  message: 'first',
  path: 'first',
  entityIds: ['entity.first'],
};
context.add(source);
source.message = 'mutated outside';
source.entityIds = ['mutated.outside'];

const firstSnapshot = context.findings;
assert.equal(Object.isFrozen(firstSnapshot), true);
assert.equal(Object.isFrozen(firstSnapshot[0]), true);
assert.equal(Object.isFrozen(firstSnapshot[0]?.entityIds), true);
assert.deepEqual(
  firstSnapshot,
  [
    {
      code: 'document.required_value',
      severity: 'error',
      message: 'first',
      path: 'first',
      entityIds: ['entity.first'],
    },
  ],
  'the sink owns an immutable copy instead of the caller object',
);
assert.throws(
  () => {
    (firstSnapshot as InvariantFinding[]).push({
      code: 'document.required_value',
      severity: 'error',
      message: 'bypass',
      path: 'bypass',
    });
  },
  TypeError,
  'snapshot mutation cannot bypass the central sink',
);

context.registerId('same-id', 'scene.nodes.first');
context.registerId('same-id', 'scene.nodes.second');
const secondSnapshot = context.findings;
assert.equal(firstSnapshot.length, 1, 'earlier snapshots remain stable');
assert.deepEqual(
  secondSnapshot.map((finding) => [finding.code, finding.path]),
  [
    ['document.required_value', 'first'],
    ['identity.duplicate', 'scene.nodes.second'],
  ],
  'all producer paths retain one insertion-ordered diagnostic authority',
);
