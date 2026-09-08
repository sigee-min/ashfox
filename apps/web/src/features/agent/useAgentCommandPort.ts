'use client';

import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type {
  AssetProject,
  CommandReceipt,
  ProjectDocument,
  ValidationReport
} from '@ashfox/engine-core';
import type { CommandOutcome } from '../../application/commandOutcome';
import type { HistoryAction } from '../../application/historyReducer';
import type { OperationLease, OperationLeaseToken } from '../../application/operationLease';
import type { ProjectAssets } from '../../application/projectAssets';
import type { ArtifactFile } from '../files/artifactFile';
import type { CaptureArtifactRequest } from '../files/capture';
import type { FileOperationRunResult } from '../files/useFileOperation';
import { useLatestValue } from '../../hooks/useLatestValue';
import { AgentCommandPort, type AgentCommandPortStatus } from './AgentCommandPort';
import { inspectProject } from './inspect';
import { presentAgentProject } from './presentAgentProject';
import { useAgentCommandSubmission } from './port/submission';
import type { VisualReviewReceipt } from '../../application/review';
import type {
  AgentCaptureRequest,
  InspectRequest,
  PresentResult,
  VisualReviewDecisionRequest,
  ViewPresentationRequest
} from './types';
import { captureAgentProject } from './captureAgentProject';
import { candidatePreviewFor } from './candidatePreview';

interface UseAgentCommandPortInput {
  project: AssetProject;
  projectGeneration: number;
  assets: ProjectAssets;
  activity: readonly CommandReceipt[];
  commandOutcomes: readonly CommandOutcome[];
  selectedNodeId: string | null;
  report: ValidationReport;
  dispatch: Dispatch<HistoryAction>;
  onFocusEntity: (nodeId: string) => void;
  onPresent: (request: ViewPresentationRequest, document?: ProjectDocument) => Promise<PresentResult>;
  onReview: (request: VisualReviewDecisionRequest) => Promise<PresentResult>;
  onCapture: (request: CaptureArtifactRequest, lease: OperationLeaseToken) => Promise<FileOperationRunResult<ArtifactFile>>;
  getVisualReviews: (projectId: string, revision: string) => readonly VisualReviewReceipt[];
  operationLease: OperationLease;
}

export const useAgentCommandPort = ({
  project,
  projectGeneration,
  assets,
  activity,
  commandOutcomes,
  selectedNodeId,
  report,
  dispatch,
  onFocusEntity,
  onPresent,
  onReview,
  onCapture,
  getVisualReviews,
  operationLease
}: UseAgentCommandPortInput): AgentCommandPortStatus => {
  const [status, setStatus] = useState<AgentCommandPortStatus>('connecting');
  const mountedRef = useRef(true);
  const projectRef = useLatestValue(project);
  const projectGenerationRef = useLatestValue(projectGeneration);
  const activityRef = useLatestValue(activity);
  const assetsRef = useLatestValue(assets);
  const selectedNodeIdRef = useLatestValue(selectedNodeId);
  const reportRef = useLatestValue(report);
  const onPresentRef = useLatestValue(onPresent);
  const onReviewRef = useLatestValue(onReview);
  const onCaptureRef = useLatestValue(onCapture);
  const getVisualReviewsRef = useLatestValue(getVisualReviews);
  const { submit, cancelPending } = useAgentCommandSubmission({
    project,
    commandOutcomes,
    dispatch,
    onFocusEntity
  });

  const port = useMemo<AgentCommandPort>(() => new AgentCommandPort({
    inspect: (request?: InspectRequest) => {
      const current = projectRef.current;
      const result = inspectProject(
        current,
        selectedNodeIdRef.current,
        reportRef.current,
        request,
        activityRef.current,
        assetsRef.current,
        getVisualReviewsRef.current(current.id, current.revision),
        operationLease.currentOwner()
      );
      return result;
    },
    currentProjectId: () => projectRef.current.id,
    currentProjectSession: () => `${projectGenerationRef.current}:${projectRef.current.id}`,
    currentRevision: () => projectRef.current.revision,
    submit,
    operationLease,
    present: (request) => {
      const current = projectRef.current;
      return presentAgentProject({
        request,
        project: current,
        report: reportRef.current,
        visualReviews: getVisualReviewsRef.current(current.id, current.revision),
        review: onReviewRef.current,
        present: (viewRequest, presentationDocument) =>
          onPresentRef.current(viewRequest, presentationDocument),
        candidatePreview: (token) => candidatePreviewFor(current, token)
      });
    },
    capture: (request: AgentCaptureRequest, lease: OperationLeaseToken) => {
      const current = projectRef.current;
      return captureAgentProject({
        request,
        project: current,
        report: reportRef.current,
        visualReviews: getVisualReviewsRef.current(current.id, current.revision),
        currentProject: () => projectRef.current,
        capture: onCaptureRef.current,
        lease
      });
    },
    onStatusChange: (nextStatus) => {
      if (mountedRef.current) setStatus(nextStatus);
    }
  }), [operationLease, submit]);

  useEffect(() => {
    mountedRef.current = true;
    setStatus('connecting');
    let disconnect: (() => void) | null = null;
    try {
      disconnect = port.connect(window);
      setStatus('connected');
    } catch {
      setStatus('disconnected');
    }
    return () => {
      mountedRef.current = false;
      disconnect?.();
      cancelPending();
    };
  }, [cancelPending, port]);

  return status;
};
