import type { MutableRefObject } from 'react';
import type { Camera, WebGLRenderer } from 'three';
import type { ProjectSceneProjection } from '../../../rendering/sceneTypes';

import { captureViewportFrameEvidence } from './evidence';
import type {
  ViewportPresentationFrame
} from './viewportTypes';

const REVIEW_FRAME_EPSILON_SECONDS = 0.000001;

export interface ViewportPresentationState {
  projectId: string;
  revision: string;
  documentReference: object;
  camera: ViewportPresentationFrame['camera'];
  clipId: string | null;
  playing: boolean;
  timeSeconds: number;
}

interface ReportViewportFrameInput {
  frameNonce: number;
  presentationNonce: number | null;
  presentation: ViewportPresentationState;
  runtime: {
    readonly projection: ProjectSceneProjection | null;
    readonly camera: Pick<Camera, 'matrixWorld'>;
    readonly renderer: WebGLRenderer;
  } | null;
  evidenceCaptureRef: MutableRefObject<number | null>;
  onPresented: (frame: ViewportPresentationFrame) => void;
}

export const reportViewportFrame = ({
  frameNonce,
  presentationNonce,
  presentation,
  runtime,
  evidenceCaptureRef,
  onPresented
}: ReportViewportFrameInput): void => {
  if (presentationNonce === null) return;
  const projection = runtime?.projection;
  const projectionDocumentReference = projection?.documentReference ??
    presentation.documentReference;
  const projectionMatchesPresentation =
    projectionDocumentReference === presentation.documentReference;
  const readiness = projection?.readiness;
  const frame = {
    presentationNonce,
    frameNonce,
    ...presentation,
    documentReference: projectionDocumentReference,
    cameraMatrix: runtime?.camera.matrixWorld.elements.slice() ?? [],
    projectionStatus: projectionMatchesPresentation
      ? readiness?.status ?? 'pending'
      : 'pending',
    projectionError: projectionMatchesPresentation
      ? readiness?.error ?? null
      : null
  } as const;
  if (!projectionMatchesPresentation) {
    onPresented({
      ...frame,
      frameEvidence: null,
      frameEvidenceError: null
    });
    return;
  }
  const requiresEvidence =
    runtime !== null &&
    readiness?.status === 'ready' &&
    !presentation.playing &&
    Math.abs(presentation.timeSeconds) <= REVIEW_FRAME_EPSILON_SECONDS;
  if (!requiresEvidence) {
    onPresented({
      ...frame,
      frameEvidence: null,
      frameEvidenceError: null
    });
    return;
  }
  if (evidenceCaptureRef.current === presentationNonce) return;
  evidenceCaptureRef.current = presentationNonce;
  void captureViewportFrameEvidence(runtime.renderer).then((capture) => {
    if (evidenceCaptureRef.current === presentationNonce) {
      evidenceCaptureRef.current = null;
    }
    onPresented({
      ...frame,
      frameEvidence: capture.ok ? capture.evidence : null,
      frameEvidenceError: capture.ok ? null : capture.error
    });
  });
};
