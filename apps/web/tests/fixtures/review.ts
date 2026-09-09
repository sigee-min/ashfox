import type { AssetProject } from '@ashfox/engine-core';

import {
  visualReviewChecksForCamera,
  visualReviewReceiptFrom,
  type VisualReviewReceipt
} from '../../src/application/review';
import type {
  PresentSuccess,
  VisualReviewCheck,
  VisualReviewIssue
} from '../../src/features/agent/types';
import type {
  PixelFrameEvidence
} from '@ashfox/render-core/pixelFrameEvidence';
import { FRAME_EVIDENCE_FIXTURE } from './frame';

const IDENTITY_MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
] as const;

interface VisualReviewReceiptFixtureInput {
  revision?: string;
  purpose?: 'delivery' | 'preview';
  mode?: 'frame' | 'cycle';
  camera?: PresentSuccess['data']['camera'];
  cameraMatrix?: readonly number[];
  frameEvidence?: PixelFrameEvidence;
  clipId?: string | null;
  observedTimeSeconds?: number;
  completedCycles?: number;
  frameNonce?: number;
  verdict?: 'accepted' | 'rejected';
  issues?: readonly VisualReviewIssue[];
  reviewChecks?: readonly VisualReviewCheck[];
  failedCheckIds?: readonly string[];
  recordedAt?: string;
}

export const createVisualReviewReceiptFixture = (
  sourceProject: AssetProject,
  input: VisualReviewReceiptFixtureInput = {}
): VisualReviewReceipt => {
  const revision = input.revision ?? sourceProject.revision;
  const project = revision === sourceProject.revision
    ? sourceProject
    : {
        ...sourceProject,
        revision,
        document: { ...sourceProject.document, revision }
      };
  const document = project.document;
  const purpose = input.purpose ?? 'delivery';
  const mode = input.mode ?? 'frame';
  const frameNonce = input.frameNonce ?? 1;
  const camera = input.camera ?? 'perspective';
  const clipId = mode === 'cycle'
    ? input.clipId ?? Object.keys(document.animations)[0] ?? 'clip-idle'
    : null;
  const reviewChecks = input.reviewChecks ?? visualReviewChecksForCamera(camera);
  const verdict = input.verdict ?? 'accepted';
  const failedCheckIds = verdict === 'rejected'
    ? input.failedCheckIds ?? reviewChecks.slice(0, 1).map((check) => check.id)
    : [];
  const issues = verdict === 'rejected'
    ? input.issues ?? (
        failedCheckIds.length > 0
          ? reviewChecks
              .filter((check) => failedCheckIds.includes(check.id))
              .map((check) => check.issue)
          : ['other']
      )
    : [];
  const observation: PresentSuccess = {
    ok: true,
    revision,
    data: {
      review: purpose === 'delivery' ? 'next' : 'preview',
      purpose,
      verdict: 'pending',
      issues: [],
      acknowledgedCheckIds: [],
      failedCheckIds: [],
      frameNonce,
      mode,
      camera,
      cameraMatrix: input.cameraMatrix ?? IDENTITY_MATRIX,
      frameEvidence:
        input.frameEvidence ?? structuredClone(FRAME_EVIDENCE_FIXTURE),
      clipId,
      playing: false,
      observedTimeSeconds: input.observedTimeSeconds ?? 0,
      completedCycles: mode === 'cycle'
        ? input.completedCycles ?? 1
        : 0,
      reviewChecks
    }
  };
  const acknowledgedCheckIds = verdict === 'accepted'
    ? reviewChecks.map((check) => check.id)
    : failedCheckIds;
  const reviewed: PresentSuccess = {
    ...observation,
    data: {
      ...observation.data,
      review: verdict === 'accepted' ? 'accept' : 'reject',
      verdict,
      issues,
      acknowledgedCheckIds,
      failedCheckIds
    }
  };
  const receipt = visualReviewReceiptFrom(
    project,
    observation,
    reviewed,
    {
      actorId: 'test-agent',
      recordedAt: input.recordedAt ?? new Date(
        Date.UTC(2026, 7, 6, 0, 0, 0, Math.min(frameNonce, 999))
      ).toISOString()
    }
  );
  if (!receipt) throw new Error('Visual review fixture is invalid.');
  return receipt;
};
