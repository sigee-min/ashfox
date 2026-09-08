import assert from 'node:assert/strict';

import {
  VISUAL_REVIEW_CHECKS
} from '../../src/application/review';
import { parsePresentRequest } from '../../src/features/agent/parsePresentRequest';
assert.equal(
  VISUAL_REVIEW_CHECKS.length,
  5,
  'the live visual checklist must cover the current review dimensions'
);
assert.equal(
  parsePresentRequest({ review: 'preview', camera: 'side' }).ok,
  false,
  'the retired ambiguous side camera is rejected'
);
assert.equal(
  parsePresentRequest({ review: 'preview', camera: 'left' }).ok,
  true,
  'left is an explicit signed camera'
);
assert.equal(
  parsePresentRequest({ review: 'preview', camera: 'right' }).ok,
  true,
  'right is an explicit signed camera'
);
assert.ok(VISUAL_REVIEW_CHECKS.every((check) => check.instruction.length > 0),
  'each live visual check carries an agent-readable instruction');
assert.equal(new Set(VISUAL_REVIEW_CHECKS.map((check) => check.id)).size,
  VISUAL_REVIEW_CHECKS.length);
assert.ok(VISUAL_REVIEW_CHECKS.every((check) =>
  Object.keys(check).sort().join(',') ===
  'id,instruction,issue'
));

const decoratedCheckIds = ['source.silhouette'];
Object.defineProperty(decoratedCheckIds, 'decorative', {
  configurable: true,
  enumerable: true,
  value: true
});
assert.equal(
  parsePresentRequest({
    review: 'accept',
    frameNonce: 1,
    checkIds: decoratedCheckIds
  }).ok,
  false,
  'presentation requests reject decorated check arrays'
);

const decoratedIssues = ['silhouette'];
Object.defineProperty(decoratedIssues, 'decorative', {
  configurable: true,
  enumerable: true,
  value: true
});
assert.equal(
  parsePresentRequest({
    review: 'reject',
    frameNonce: 1,
    issues: decoratedIssues,
    failedCheckIds: []
  }).ok,
  false,
  'presentation requests reject decorated issue arrays'
);

console.log('authored review presentation ok');
