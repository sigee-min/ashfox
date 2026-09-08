import assert from 'node:assert/strict';

import {
  createCycleObservation
} from '../../src/features/agent/cycleObservation';
import {
  observePresentationFrame,
  presentationCancellationResult,
  snapshotPresentationObservation,
  presentationTimeoutResult,
  stalePresentationResult,
  type PresentationSession
} from '../../src/features/workbench/presentation/state';
import type {
  ViewportPresentationFrame
} from '../../src/features/workbench/viewport/viewportTypes';
import { FRAME_EVIDENCE_FIXTURE } from '../fixtures/frame';

const documentReference = {};

const session = (
  mode: PresentationSession['mode'] = 'frame',
  review: PresentationSession['review'] = 'next'
): PresentationSession => ({
  nonce: 7,
  projectId: 'project-test',
  revision: 'local-0001',
  documentReference,
  lastFrameNonce: null,
  review,
  purpose: review === 'next' ? 'delivery' : 'preview',
  mode,
  camera: 'front',
  clipId: mode === 'cycle' ? 'clip-idle' : null,
  timeSeconds: 0,
  cycle:
    mode === 'cycle'
      ? createCycleObservation(1, 20)
      : null,
  phase: 'observing',
  reviewChecks: [{
    id: 'source.mechanic.role-read',
    issue: 'feature_detail',
    instruction: 'Read the mechanic role.'
  }]
});

const frame = (
  values: Partial<ViewportPresentationFrame> = {}
): ViewportPresentationFrame => ({
  presentationNonce: 7,
  frameNonce: 11,
  projectId: 'project-test',
  revision: 'local-0001',
  documentReference,
  camera: 'front',
  cameraMatrix: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ],
  frameEvidence: structuredClone(FRAME_EVIDENCE_FIXTURE),
  frameEvidenceError: null,
  clipId: null,
  playing: false,
  timeSeconds: 0,
  projectionStatus: 'ready',
  projectionError: null,
  ...values
});

const frameResult = observePresentationFrame(
  session(),
  frame()
);
assert.equal(frameResult.session, null);
assert.equal(frameResult.result?.ok, true);
if (frameResult.result?.ok) {
  assert.equal(frameResult.result.data.review, 'next');
  assert.equal(frameResult.result.data.purpose, 'delivery');
  assert.equal(frameResult.result.data.verdict, 'pending');
  assert.equal(frameResult.result.data.completedCycles, 0);
  assert.deepEqual(
    frameResult.result.data.frameEvidence,
    FRAME_EVIDENCE_FIXTURE
  );
  assert.deepEqual(
    frameResult.result.data.reviewChecks.map((check) => check.id),
    ['source.mechanic.role-read']
  );
  const snapshot = snapshotPresentationObservation(
    frameResult.result
  );
  Object.defineProperty(frameResult.result.data.reviewChecks[0], 'id', {
    configurable: true,
    value: 'mutated.by.caller'
  });
  Object.defineProperty(frameResult.result.data.frameEvidence, 'pixelHash', {
    configurable: true,
    value: 'sha256:forged'
  });
  assert.equal(
    snapshot.data.reviewChecks[0].id,
    'source.mechanic.role-read',
    'the stored observation must not share mutable result data'
  );
  assert.equal(
    snapshot.data.frameEvidence.pixelHash,
    FRAME_EVIDENCE_FIXTURE.pixelHash,
    'the stored observation must not share mutable frame evidence'
  );
}

const missingEvidence = observePresentationFrame(
  session(),
  frame({ frameEvidence: null })
);
assert.equal(missingEvidence.session, null);
assert.equal(missingEvidence.result?.ok, false);
if (missingEvidence.result && !missingEvidence.result.ok) {
  assert.equal(missingEvidence.result.error.code, 'preview_unavailable');
  assert.equal(missingEvidence.result.error.path, 'frameEvidence');
}

const previewResult = observePresentationFrame(
  session('frame', 'preview'),
  frame()
);
assert.equal(previewResult.result?.ok, true);
if (previewResult.result?.ok) {
  assert.equal(previewResult.result.data.review, 'preview');
  assert.equal(previewResult.result.data.purpose, 'preview');
}

const wrongCamera = observePresentationFrame(
  session(),
  frame({ camera: 'right', frameNonce: 12 })
);
assert.equal(wrongCamera.result, null);
assert.equal(wrongCamera.session?.lastFrameNonce, 12);

const candidateDocument = {};
const candidateFrame = observePresentationFrame(
  session(),
  frame({ documentReference: candidateDocument, frameNonce: 13 })
);
assert.ok(candidateFrame.session);
assert.equal(candidateFrame.result, null);
const canonicalAfterCandidate = observePresentationFrame(
  session(),
  frame({ frameNonce: 14 })
);
assert.equal(
  canonicalAfterCandidate.result?.ok,
  true,
  'a canonical delivery presentation accepts only its canonical viewport document'
);

const invalidFrameNonce = observePresentationFrame(
  session(),
  frame({ frameNonce: 0 })
);
assert.equal(invalidFrameNonce.result, null);
assert.equal(invalidFrameNonce.session?.lastFrameNonce, null);

const invalidCameraMatrix = observePresentationFrame(
  session(),
  frame({ cameraMatrix: [1, 0, 0, 0] })
);
assert.equal(invalidCameraMatrix.result, null);
assert.equal(invalidCameraMatrix.session?.lastFrameNonce, 11);

const sparseCameraMatrix = new Array(16) as number[];
const sparseFrame = frame();
Object.defineProperty(sparseFrame, 'cameraMatrix', {
  configurable: true,
  value: sparseCameraMatrix
});
const invalidSparseCameraMatrix = observePresentationFrame(
  session(),
  sparseFrame
);
assert.equal(invalidSparseCameraMatrix.result, null);
assert.equal(invalidSparseCameraMatrix.session?.lastFrameNonce, 11);

const firstCycleFrame = observePresentationFrame(
  session('cycle'),
  frame({
    clipId: 'clip-idle',
    frameNonce: 30,
    playing: true,
    timeSeconds: 0
  })
);
assert.ok(firstCycleFrame.session);
const repeatedCycleFrame = observePresentationFrame(
  firstCycleFrame.session as PresentationSession,
  frame({
    clipId: 'clip-idle',
    frameNonce: 30,
    playing: true,
    timeSeconds: 0.25
  })
);
assert.equal(repeatedCycleFrame.result, null);
assert.equal(
  repeatedCycleFrame.session?.cycle?.previousTimeSeconds,
  0,
  'a repeated frame nonce cannot advance cycle evidence'
);

const stale = observePresentationFrame(
  session(),
  frame({ revision: 'local-0002' })
);
assert.equal(stale.session, null);
assert.equal(stale.playbackEffect, 'stop');
assert.equal(stale.result?.ok, false);
if (stale.result && !stale.result.ok) {
  assert.equal(stale.result.error.code, 'stale_revision');
}

const projectionFailure = observePresentationFrame(
  session(),
  frame({
    projectionStatus: 'failed',
    projectionError: 'texture decode failed'
  })
);
assert.equal(projectionFailure.session, null);
assert.equal(projectionFailure.result?.ok, false);
if (projectionFailure.result && !projectionFailure.result.ok) {
  assert.equal(
    projectionFailure.result.error.code,
    'preview_unavailable'
  );
}

let cycle = session('cycle');
for (const [index, timeSeconds] of [0, 0.25, 0.5, 0.75].entries()) {
  const transition = observePresentationFrame(
    cycle,
    frame({
      clipId: 'clip-idle',
      frameNonce: 20 + index,
      playing: true,
      timeSeconds
    })
  );
  assert.equal(transition.result, null);
  assert.ok(transition.session);
  cycle = transition.session;
}
const completed = observePresentationFrame(
  cycle,
  frame({
    clipId: 'clip-idle',
    frameNonce: 24,
    playing: true,
    timeSeconds: 1
  })
);
assert.equal(completed.result, null);
assert.equal(completed.playbackEffect, 'stop_and_rewind');
assert.equal(completed.session?.phase, 'closing');

const closed = observePresentationFrame(
  completed.session as PresentationSession,
  frame({
    clipId: 'clip-idle',
    frameNonce: 25,
    playing: false,
    timeSeconds: 0
  })
);
assert.equal(closed.session, null);
assert.equal(closed.result?.ok, true);
if (closed.result?.ok) {
  assert.equal(closed.result.data.completedCycles, 1);
}

const timeout = presentationTimeoutResult(
  session('cycle'),
  'local-0001'
);
assert.equal(timeout.ok, false);
if (!timeout.ok) assert.equal(timeout.error.code, 'render_timeout');

const cancelled = presentationCancellationResult(
  'local-0001',
  'mounted viewport'
);
assert.equal(cancelled.ok, false);
if (!cancelled.ok) assert.equal(cancelled.error.code, 'invalid_state');

const revisionChanged = stalePresentationResult(
  'local-0002',
  'local-0001'
);
assert.equal(revisionChanged.ok, false);
if (!revisionChanged.ok) {
  assert.equal(revisionChanged.error.code, 'stale_revision');
  assert.equal(revisionChanged.error.expected, 'local-0001');
}
