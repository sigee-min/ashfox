import {
  advanceCycleObservation,
  type CycleObservation
} from '../../agent/cycleObservation';
import { isDenseContractArray } from '@ashfox/internal-contracts';
import type {
  PresentSuccess,
  VisualReviewCheck,
  PresentResult,
  ViewPresentationRequest
} from '../../agent/types';
import type {
  CameraMode
} from '../../../rendering/cameraPresets';
import type {
  ViewportPresentationFrame
} from '../viewport/viewportTypes';
import {
  isPixelFrameEvidence,
  type PixelFrameEvidence
} from '../../../rendering/pixelFrameEvidence';

const FRAME_EPSILON_SECONDS = 0.000001;

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isFiniteCameraMatrix = (value: unknown): value is readonly number[] =>
  isDenseContractArray(value) &&
  value.length === 16 &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

export interface PresentationSession {
  nonce: number;
  projectId: string;
  revision: string;
  documentReference: object;
  lastFrameNonce: number | null;
  review: ViewPresentationRequest['review'];
  purpose: ViewPresentationRequest['purpose'];
  mode: ViewPresentationRequest['mode'];
  camera: CameraMode;
  clipId: string | null;
  timeSeconds: number;
  cycle: CycleObservation | null;
  phase: 'observing' | 'closing';
  reviewChecks: readonly VisualReviewCheck[];
}

export type PresentationPlaybackEffect =
  | 'none'
  | 'stop'
  | 'rewind'
  | 'stop_and_rewind';

export interface PresentationTransition {
  session: PresentationSession | null;
  result: PresentResult | null;
  playbackEffect: PresentationPlaybackEffect;
}

export const snapshotPresentationObservation = (
  result: PresentSuccess
): PresentSuccess => structuredClone(result);

const pending = (
  session: PresentationSession,
  playbackEffect: PresentationPlaybackEffect = 'none'
): PresentationTransition => ({
  session,
  result: null,
  playbackEffect
});

const failure = (
  revision: string,
  code: 'preview_unavailable' | 'stale_revision',
  path: string,
  expected: string
): PresentationTransition => ({
  session: null,
  result: {
    ok: false,
    revision,
    error: { code, path, expected }
  },
  playbackEffect: 'stop'
});

const success = (
  session: PresentationSession,
  frame: ViewportPresentationFrame,
  completedCycles: number,
  frameEvidence: PixelFrameEvidence
): PresentationTransition => ({
  session: null,
  result: {
    ok: true,
    revision: frame.revision,
    data: {
      review: session.review,
      purpose: session.purpose,
      verdict: 'pending',
      issues: [],
      acknowledgedCheckIds: [],
      failedCheckIds: [],
      frameNonce: frame.frameNonce,
      mode: session.mode,
      camera: frame.camera,
      cameraMatrix: frame.cameraMatrix,
      frameEvidence,
      clipId: frame.clipId,
      playing: frame.playing,
      observedTimeSeconds: frame.timeSeconds,
      completedCycles,
      reviewChecks: session.reviewChecks
    }
  },
  playbackEffect: 'none'
});

const missingFrameEvidence = (
  frame: ViewportPresentationFrame
): PresentationTransition => failure(
  frame.revision,
  'preview_unavailable',
  'frameEvidence',
  frame.frameEvidenceError ??
    'a SHA-256 fingerprint derived from the rendered RGBA viewport pixels'
);

export const observePresentationFrame = (
  session: PresentationSession,
  frame: ViewportPresentationFrame
): PresentationTransition => {
  if (session.nonce !== frame.presentationNonce) {
    return pending(session);
  }
  if (
    frame.projectId !== session.projectId ||
    frame.revision !== session.revision
  ) {
    return failure(
      frame.revision,
      'stale_revision',
      'revision',
      session.revision
    );
  }
  if (frame.documentReference !== session.documentReference) {
    // A previous presentation can report one late frame after the session
    // switches documents. Ignore it and wait for the exact document owned by
    // this session before acknowledging rendered evidence.
    return pending(session);
  }
  if (
    !isPositiveSafeInteger(frame.frameNonce) ||
    session.lastFrameNonce !== null &&
      frame.frameNonce <= session.lastFrameNonce
  ) {
    return pending(session);
  }
  const observedSession: PresentationSession = {
    ...session,
    lastFrameNonce: frame.frameNonce
  };
  if (frame.projectionStatus === 'failed') {
    return failure(
      frame.revision,
      'preview_unavailable',
      'textures',
      frame.projectionError ??
        'all viewport textures decoded successfully'
    );
  }
  if (
    frame.projectionStatus !== 'ready' ||
    frame.camera !== session.camera ||
    frame.clipId !== session.clipId
  ) {
    return pending(observedSession);
  }
  if (
    typeof frame.playing !== 'boolean' ||
    !Number.isFinite(frame.timeSeconds) ||
    !isFiniteCameraMatrix(frame.cameraMatrix)
  ) {
    return pending(observedSession);
  }
  if (session.mode === 'frame') {
    if (
      frame.playing ||
      Math.abs(frame.timeSeconds - session.timeSeconds) >
        FRAME_EPSILON_SECONDS
    ) {
      return pending(observedSession);
    }
    if (!isPixelFrameEvidence(frame.frameEvidence)) {
      return missingFrameEvidence(frame);
    }
    return success(observedSession, frame, 0, frame.frameEvidence);
  }
  if (observedSession.phase === 'closing') {
    if (frame.playing) return pending(observedSession);
    if (frame.timeSeconds > FRAME_EPSILON_SECONDS) {
      return pending(observedSession, 'rewind');
    }
    if (!isPixelFrameEvidence(frame.frameEvidence)) {
      return missingFrameEvidence(frame);
    }
    return success(observedSession, frame, 1, frame.frameEvidence);
  }
  if (!observedSession.cycle) return pending(observedSession);

  const advanced = advanceCycleObservation(
    observedSession.cycle,
    frame.timeSeconds
  );
  const next = {
    ...observedSession,
    cycle: advanced.observation
  };
  if (!frame.playing) {
    if (
      frame.timeSeconds +
        advanced.observation.toleranceSeconds <
          advanced.observation.durationSeconds ||
      !advanced.complete
    ) {
      return pending(next);
    }
    return pending(
      { ...next, phase: 'closing' },
      'rewind'
    );
  }
  if (!advanced.complete) return pending(next);
  return pending(
    { ...next, phase: 'closing' },
    'stop_and_rewind'
  );
};

export const presentationTimeoutResult = (
  session: PresentationSession,
  revision: string
): PresentResult => ({
  ok: false,
  revision,
  error: {
    code: 'render_timeout',
    path: '$',
    expected:
      session.mode === 'cycle'
        ? 'one observed animation cycle and closing frame'
        : 'a rendered viewport frame within 5 seconds'
  }
});

export const presentationCancellationResult = (
  revision: string,
  expected: string
): PresentResult => ({
  ok: false,
  revision,
  error: {
    code: 'invalid_state',
    path: '$',
    expected
  }
});

export const stalePresentationResult = (
  revision: string,
  expectedRevision: string
): PresentResult => ({
  ok: false,
  revision,
  error: {
    code: 'stale_revision',
    path: 'revision',
    expected: expectedRevision
  }
});
