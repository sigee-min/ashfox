import {
  evaluateProductionReadiness,
  type AssetProject,
  type ValidationReport
} from '@ashfox/engine-core';

import {
  isValidVisualReviewReceipt,
  type VisualReviewReceipt
} from '../../application/review';
import type {
  PresentRequest,
  PresentResult,
  VisualReviewDecisionRequest,
  ViewPresentationRequest
} from './types';
import {
  visualReviewChecksForCamera
} from '../../application/review';
import {
  nextVisualReview
} from './visualReviewPlan';

interface PresentAgentProjectInput {
  request: PresentRequest;
  project: AssetProject;
  report: ValidationReport;
  visualReviews: readonly VisualReviewReceipt[];
  review: (
    request: VisualReviewDecisionRequest
  ) => Promise<PresentResult>;
  present: (
    request: ViewPresentationRequest,
    document?: AssetProject['document']
  ) => Promise<PresentResult>;
  candidatePreview?: (token: string) => AssetProject | null;
}

const previewCamera = (
  request: Extract<PresentRequest, { review: 'preview' }>
): ViewPresentationRequest['camera'] => request.camera ?? 'perspective';

export const presentAgentProject = ({
  request,
  project,
  report,
  visualReviews,
  review,
  present,
  candidatePreview
}: PresentAgentProjectInput): Promise<PresentResult> => {
  const document = project.document;
  if (request.review === 'accept' || request.review === 'reject') {
    return review(request);
  }
  if (request.review === 'preview') {
    const previewProject = request.previewToken === undefined
      ? project
      : candidatePreview?.(request.previewToken) ?? null;
    if (previewProject === null) {
      return Promise.resolve({
        ok: false,
        revision: document.revision,
        error: {
          code: 'not_found',
          path: 'previewToken',
          expected: 'an active candidate preview token from workspace inspect'
        }
      });
    }
    const previewDocument = previewProject.document;
    const readiness = previewProject === project
      ? evaluateProductionReadiness(previewDocument, report)
      : evaluateProductionReadiness(previewDocument);
    if (previewDocument.scene.roots.length === 0) {
      return Promise.resolve({
        ok: false,
        revision: document.revision,
        error: {
          code: 'invalid_state',
          path: 'scene',
          expected: 'visible canonical scene geometry before preview'
        }
      });
    }
    if (readiness.counts.visibleGeometry === 0) {
      return Promise.resolve({
        ok: false,
        revision: document.revision,
        error: {
          code: 'invalid_state',
          path: 'model',
          expected: 'visible canonical geometry before preview'
        }
      });
    }
    const camera = previewCamera(request);
    return present({
      review: 'preview',
      purpose: 'preview',
      mode: 'frame',
      camera,
      clipId: null,
      timeSeconds: 0,
      reviewChecks: visualReviewChecksForCamera(camera)
    }, previewDocument);
  }
  const readiness = evaluateProductionReadiness(document, report);
  if (!readiness.mechanicallyReady) {
    return Promise.resolve({
      ok: false,
      revision: document.revision,
      error: {
        code: 'invalid_state',
        path: readiness.firstBlockingFinding?.path ?? '$',
        expected:
          readiness.firstBlockingFinding?.fix ??
          'mechanically ready project before visual review'
      }
    });
  }
  const rejected = visualReviews.find(
    (receipt) =>
      isValidVisualReviewReceipt(receipt, project) &&
      receipt.observation.data.purpose === 'delivery' &&
      receipt.decision.verdict === 'rejected'
  );
  if (rejected) {
    return Promise.resolve({
      ok: false,
      revision: document.revision,
      error: {
        code: 'invalid_state',
        path: 'review',
        expected:
          `revise rejected visual issues: ${rejected.decision.issues.join(', ')}`
      }
    });
  }
  const nextReview = nextVisualReview(
    project,
    readiness,
    visualReviews
  );
  if (!nextReview) {
    return Promise.resolve({
      ok: false,
      revision: document.revision,
      error: {
        code: 'invalid_state',
        path: 'review',
        expected:
          'a remaining revision-bound visual review from inspect'
      }
    });
  }
  return present({
    review: 'next',
    purpose: 'delivery',
    ...nextReview,
    timeSeconds: 0,
    reviewChecks: visualReviewChecksForCamera(nextReview.camera)
  });
};
