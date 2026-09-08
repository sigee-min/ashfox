import assert from 'node:assert/strict';
import { Group, PerspectiveCamera } from 'three';

import {
  observePresentationFrame,
  type PresentationSession
} from '../../src/features/workbench/presentation/state';
import {
  reportViewportFrame,
  type ViewportPresentationState
} from '../../src/features/workbench/viewport/reportViewportFrame';

const presentationDocument = {};
const staleProjectionDocument = {};

const presentation: ViewportPresentationState = {
  projectId: 'project-test',
  revision: 'local-0001',
  documentReference: presentationDocument,
  camera: 'front',
  clipId: null,
  playing: false,
  timeSeconds: 0
};

const session: PresentationSession = {
  nonce: 7,
  projectId: presentation.projectId,
  revision: presentation.revision,
  documentReference: presentation.documentReference,
  lastFrameNonce: null,
  review: 'next',
  purpose: 'delivery',
  mode: 'frame',
  camera: presentation.camera,
  clipId: null,
  timeSeconds: 0,
  cycle: null,
  phase: 'observing',
  reviewChecks: []
};

const runtime = {
  projection: {
    documentReference: staleProjectionDocument,
    root: new Group(), objectsByNodeId: new Map(), selectable: [],
    ready: Promise.resolve(), dispose: () => undefined,
    readiness: { status: 'ready' as const, error: null }
  },
  camera: new PerspectiveCamera(),
  get renderer(): never { throw new Error('Stale projections must not capture pixels.'); }
};

const frames: Parameters<Parameters<typeof reportViewportFrame>[0]['onPresented']>[0][] = [];
reportViewportFrame({
  frameNonce: 11,
  presentationNonce: session.nonce,
  presentation,
  runtime,
  evidenceCaptureRef: { current: null },
  onPresented: (frame) => frames.push(frame)
});

assert.equal(frames.length, 1);
const staleFrame = frames[0];
assert.ok(staleFrame);
assert.equal(
  staleFrame.documentReference,
  staleProjectionDocument,
  'frame ownership must come from the projection that was actually rendered'
);
assert.equal(staleFrame.projectionStatus, 'pending');
assert.equal(staleFrame.frameEvidence, null);
assert.equal(
  observePresentationFrame(session, staleFrame).result,
  null,
  'a stale projection must not certify a newer presentation'
);
