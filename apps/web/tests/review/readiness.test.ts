import assert from 'node:assert/strict';

import {
  validateProjectDocument
} from '@ashfox/engine-core';

import {
  presentCreationStatus
} from '../../src/features/workbench/presentation/status';
import {
  isValidVisualReviewReceipt,
  visualReviewChecksForCamera,
  visualReviewReceiptFrom
} from '../../src/application/review';
import {
  createHistoryState
} from '../../src/application/historyReducer';
import {
  createProjectSnapshot
} from '../../src/application/snapshot';
import {
  isPendingVisualReviewObservation
} from '../../src/application/review/reader';
import {
  presentExportAvailability
} from '../../src/features/workbench/exportAvailability';
import {
  requiredVisualReviews
} from '../../src/features/agent/visualReviewPlan';
import {
  createWorkbenchProject
} from '../fixtures/project';
import {
  createVisualReviewReceiptFixture
} from '../fixtures/review';
import {
  FRAME_EVIDENCE_FIXTURE
} from '../fixtures/frame';
import {
  createProjectSessionState,
  projectSessionReducer
} from '../../src/features/workbench/state/session';

const compiled = createWorkbenchProject();
const compiledReport = validateProjectDocument(compiled.document);
const reviewing = presentCreationStatus(
  compiled,
  compiledReport,
  [],
  'saving'
);
assert.equal(reviewing.state, 'reviewing');
assert.match(reviewing.detail, /visual checks remaining/);

const reviews = requiredVisualReviews(compiled.document).map((review, index) =>
  createVisualReviewReceiptFixture(compiled, {
    mode: review.mode,
    camera: review.camera,
    clipId: review.clipId,
    frameNonce: index + 1
  })
);
const required = requiredVisualReviews(compiled.document);
assert.deepEqual(
  required.slice(0, 6).map((review) => review.camera),
  ['perspective', 'native', 'front', 'left', 'right', 'top'],
  'delivery review covers every static camera'
);
assert.deepEqual(
  required.slice(6).map((review) => [
    review.mode,
    review.camera,
    review.clipId
  ]),
  Object.keys(compiled.document.animations).sort().map((clipId) => [
    'cycle',
    'perspective',
    clipId
  ]),
  'delivery review covers every canonical animation clip'
);
const leftReceipt = reviews.find(
  (receipt) => receipt.observation.data.camera === 'left'
);
const rightReceipt = reviews.find(
  (receipt) => receipt.observation.data.camera === 'right'
);
assert.ok(leftReceipt && rightReceipt);
assert.equal(
  leftReceipt.observation.data.reviewChecks.length,
  visualReviewChecksForCamera('left').length,
  'left review remains independently bound to its observed checks'
);
assert.equal(
  leftReceipt.observation.data.reviewChecks.some(
    (check) => check.id === 'source.bilateral-detail'
  ),
  false,
  'left review does not claim an unobserved bilateral comparison'
);
assert.ok(
  rightReceipt.observation.data.reviewChecks.some(
    (check) => check.id === 'source.bilateral-detail'
  ),
  'right review explicitly compares authored bilateral detail'
);
const swappedChecklists = structuredClone(rightReceipt.observation);
Object.defineProperty(swappedChecklists.data, 'reviewChecks', {
  configurable: true,
  value: visualReviewChecksForCamera('left')
});
assert.equal(
  isPendingVisualReviewObservation(swappedChecklists, compiled.document),
  false,
  'a right frame cannot carry the left checklist'
);
const ready = presentCreationStatus(
  compiled,
  compiledReport,
  reviews,
  'saved'
);
assert.equal(ready.state, 'ready');
assert.deepEqual(
  presentExportAvailability(compiled, compiledReport, reviews),
  {
    allowed: true,
    message: 'Canonical asset and visual review are ready for delivery.'
  }
);

const firstReceipt = reviews[0]!;
assert.equal(isValidVisualReviewReceipt(firstReceipt, compiled), true);
assert.equal(isValidVisualReviewReceipt(firstReceipt, {
  ...compiled,
  build: {
    ...compiled.build,
    workspaceHash: `sha256:${'0'.repeat(64)}`
  }
}), false, 'visual review receipts bind the complete compiler build identity');
const swappedReviewWorkspace = structuredClone(compiled.workspace);
const swappedReviewFile = swappedReviewWorkspace.files[0];
if (!swappedReviewFile) throw new Error('review fixture workspace is empty');
Object.defineProperty(swappedReviewFile, 'source', {
  configurable: true,
  value: `${swappedReviewFile.source}\n`
});
assert.equal(isValidVisualReviewReceipt(firstReceipt, {
  ...compiled,
  workspace: swappedReviewWorkspace
}), false, 'visual review receipts bind the exact workspace authority');
const cyclicObservation = structuredClone(firstReceipt.observation);
(cyclicObservation.data.reviewChecks as unknown as unknown[]).push(
  cyclicObservation.data.reviewChecks
);
const reviewedObservation = {
  ...firstReceipt.observation,
  data: {
    ...firstReceipt.observation.data,
    review: 'accept' as const,
    verdict: 'accepted' as const,
    acknowledgedCheckIds: firstReceipt.observation.data.reviewChecks.map(
      (check) => check.id
    )
  }
};
assert.equal(
  visualReviewReceiptFrom(
    compiled,
    cyclicObservation,
    reviewedObservation,
    {
      actorId: 'test-agent',
      recordedAt: '2026-08-09T00:00:00.000Z'
    }
  ),
  null,
  'cyclic review observations fail closed without throwing'
);
const forgedCamera = structuredClone(firstReceipt);
Object.defineProperty(forgedCamera.observation.data, 'camera', {
  configurable: true,
  value: 'side'
});
assert.equal(
  isValidVisualReviewReceipt(forgedCamera, compiled),
  false,
  'changing the observed camera invalidates the receipt fingerprint'
);
const forgedOppositeFrame = structuredClone(rightReceipt);
Object.defineProperty(forgedOppositeFrame.observation.data, 'camera', {
  configurable: true,
  value: 'left'
});
assert.equal(
  isValidVisualReviewReceipt(forgedOppositeFrame, compiled),
  false,
  'an opposite camera label cannot reuse an exact frame receipt'
);
const forgedRevision = structuredClone(firstReceipt);
Object.defineProperty(forgedRevision, 'revision', {
  configurable: true,
  value: 'local-forged'
});
assert.equal(
  isValidVisualReviewReceipt(forgedRevision, compiled),
  false,
  'a receipt from another source revision is rejected'
);
const initialSession = createProjectSessionState(
  createHistoryState(compiled)
);
const forgedSession = projectSessionReducer(initialSession, {
  type: 'replace',
  record: createProjectSnapshot(
    compiled,
    '2026-08-09T00:00:00.000Z',
    [],
    [forgedCamera]
  )
});
assert.deepEqual(
  forgedSession.visualReviews,
  [],
  'session hydration rejects a forged visual review receipt'
);
const hydratedSession = projectSessionReducer(initialSession, {
  type: 'replace',
  record: createProjectSnapshot(
    compiled,
    '2026-08-09T00:00:00.000Z',
    [],
    [structuredClone(firstReceipt)]
  )
});
assert.equal(
  hydratedSession.visualReviews.length,
  1,
  'session hydration preserves a valid revision-bound receipt'
);
const hydratedInput = structuredClone(firstReceipt);
const isolatedSession = projectSessionReducer(initialSession, {
  type: 'replace',
  record: createProjectSnapshot(
    compiled,
    '2026-08-09T00:00:00.000Z',
    [],
    [hydratedInput]
  )
});
Object.defineProperty(hydratedInput.observation.data.frameEvidence, 'pixelHash', {
  configurable: true,
  value: 'sha256:forged'
});
assert.equal(
  isolatedSession.visualReviews[0]?.observation.data.frameEvidence.pixelHash,
  FRAME_EVIDENCE_FIXTURE.pixelHash,
  'session hydration isolates mutable receipt evidence'
);
const forgedReviews = reviews.map((receipt) => {
  const forged = structuredClone(receipt);
  Object.defineProperty(forged, 'evidenceFingerprint', {
    configurable: true,
    value: 'sha256:forged'
  });
  return forged;
});
assert.equal(
  presentExportAvailability(compiled, compiledReport, forgedReviews).allowed,
  false,
  'delivery gating ignores receipts with invalid evidence fingerprints'
);
const obsoleteObservationField = structuredClone(firstReceipt.observation);
Object.defineProperty(obsoleteObservationField.data, 'previewIssues', {
  configurable: true,
  value: []
});
assert.equal(
  isPendingVisualReviewObservation(obsoleteObservationField, compiled.document),
  false,
  'the pending observation contract rejects removed no-op fields'
);
const sparseObservation = structuredClone(firstReceipt.observation);
Object.defineProperty(sparseObservation.data, 'cameraMatrix', {
  configurable: true,
  value: new Array(16)
});
assert.equal(
  isPendingVisualReviewObservation(sparseObservation, compiled.document),
  false,
  'the pending observation contract rejects sparse camera matrices'
);
const decoratedObservation = structuredClone(firstReceipt.observation);
Object.defineProperty(decoratedObservation.data.reviewChecks, 'decorative', {
  configurable: true,
  enumerable: true,
  value: true
});
assert.equal(
  isPendingVisualReviewObservation(decoratedObservation, compiled.document),
  false,
  'the pending observation contract rejects decorated check arrays'
);
assert.equal(
  presentExportAvailability(
    compiled,
    compiledReport,
    reviews.slice(0, -1)
  ).allowed,
  false,
  'delivery remains gated until every camera and animation review is accepted'
);
assert.equal(
  presentExportAvailability(
    compiled,
    compiledReport,
    reviews.filter((receipt) => receipt.observation.data.camera !== 'left')
  ).allowed,
  false,
  'missing left evidence cannot be satisfied by the opposite view'
);
assert.equal(
  presentExportAvailability(
    compiled,
    compiledReport,
    reviews.filter((receipt) => receipt.observation.data.camera !== 'right')
  ).allowed,
  false,
  'missing right evidence cannot be satisfied by the opposite view'
);
