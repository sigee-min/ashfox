'use client';

import type {
  AssetProject,
  ProjectDocument
} from '@ashfox/engine-core';

import type {
  VisualReviewReceipt
} from '../../../application/review';
import type {
  PresentResult,
  VisualReviewDecisionRequest,
  ViewPresentationRequest
} from '../../agent/types';
import {
  usePresentationSession
} from '../presentation/session';
import {
  useVisualReviewController
} from '../presentation/review';
import type {
  ViewportPresentationFrame
} from '../viewport/viewportTypes';

interface PresentationViewRequest {
  clipId: string | null;
  camera: ViewPresentationRequest['camera'];
}

interface UseAgentPresentationInput {
  project: AssetProject;
  visualReviews: readonly VisualReviewReceipt[];
  onRecordVisualReview: (receipt: VisualReviewReceipt) => void;
  prepareView: (request: PresentationViewRequest) => void;
  setPlayhead: (timeSeconds: number) => void;
  setPlaying: (playing: boolean) => void;
}

interface AgentPresentationController {
  viewportDocument: Readonly<ProjectDocument>;
  presentationNonce: number;
  present: (
    request: ViewPresentationRequest,
    document?: ProjectDocument
  ) => Promise<PresentResult>;
  review: (
    request: VisualReviewDecisionRequest
  ) => Promise<PresentResult>;
  onPresented: (frame: ViewportPresentationFrame) => void;
  getVisualReviews: (
    projectId: string,
    revision: string
  ) => readonly VisualReviewReceipt[];
}

export const useAgentPresentation = ({
  project,
  visualReviews,
  onRecordVisualReview,
  prepareView,
  setPlayhead,
  setPlaying
}: UseAgentPresentationInput): AgentPresentationController => {
  const document = project.document;
  const session = usePresentationSession({
    document,
    prepareView,
    setPlayhead,
    setPlaying
  });
  const reviews = useVisualReviewController({
    project,
    visualReviews,
    observations: session.observations,
    onRecordVisualReview
  });

  return {
    viewportDocument: session.presentationDocument,
    presentationNonce: session.presentationNonce,
    present: session.present,
    review: reviews.review,
    onPresented: session.onPresented,
    getVisualReviews: reviews.getVisualReviews
  };
};
