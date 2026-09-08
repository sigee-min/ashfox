import type {
  AssetProject,
  ProductionReadinessReport,
  ValidationReport
} from '@ashfox/engine-core';

import {
  isValidVisualReviewReceipt,
  rejectedVisualReviewsForRevision,
  visualReviewPlanItem,
  type VisualReviewReceipt
} from '../../../application/review';
import {
  remainingVisualReviews,
  visualReviewKey
} from '../visualReviewPlan';
import {
  classifyWorkflowFindings,
  isBlockingFinding,
  type ClassifiedWorkflowFindings
} from './finding';
import {
  deriveWorkflowActions,
  fallbackWorkflowFix
} from './actions';
import type {
  InspectWorkflowBlocker,
  InspectWorkflowGuidance,
  InspectWorkflowStage,
  ReadinessFinding
} from './inspectWorkflowTypes';

const VISUAL_REVIEW_RESPONSE_LIMIT = 6;

interface WorkflowPosition {
  stage: InspectWorkflowStage;
  blocker: ReadinessFinding | null;
}

const workflowPosition = (
  findings: ClassifiedWorkflowFindings,
  readiness: ProductionReadinessReport,
  hasRejectedReview: boolean,
  remainingReviewCount: number
): WorkflowPosition => {
  if (findings.startup) {
    return { stage: 'start', blocker: findings.startup };
  }
  if (!readiness.mechanicallyReady) {
    return {
      stage: 'model',
      blocker: readiness.firstBlockingFinding
    };
  }
  if (hasRejectedReview || remainingReviewCount > 0) {
    return { stage: 'review', blocker: null };
  }
  return { stage: 'deliver', blocker: null };
};

export const deriveInspectWorkflow = (
  project: AssetProject,
  report: ValidationReport,
  readiness: ProductionReadinessReport,
  visualReviews: readonly VisualReviewReceipt[] = []
): InspectWorkflowGuidance => {
  const document = project.document;
  const findings: readonly ReadinessFinding[] = [
    ...report.findings.filter(isBlockingFinding),
    ...readiness.findings
  ];
  const classified = classifyWorkflowFindings(findings);
  const remaining = remainingVisualReviews(
    project,
    readiness,
    visualReviews
  );
  const rejected = rejectedVisualReviewsForRevision(
    visualReviews,
    document.id,
    document.revision
  ).find((receipt) => isValidVisualReviewReceipt(receipt, project)) ?? null;
  const { stage, blocker } = workflowPosition(
    classified,
    readiness,
    rejected !== null,
    remaining.length
  );
  const { exactOperation, nextActions } = deriveWorkflowActions(
    document,
    stage,
    blocker,
    rejected
  );
  const workflowBlocker: InspectWorkflowBlocker | null = rejected
    ? {
        code: 'review.rejected',
        path: `review.${visualReviewKey(visualReviewPlanItem(rejected))}`,
        fix:
          `Revise the rejected visual issues: ${rejected.decision.issues.join(', ')}.`
      }
    : blocker
      ? {
          code: blocker.code,
          path: blocker.path,
          fix:
            exactOperation
              ? fallbackWorkflowFix(stage, nextActions)
              : blocker.fix ??
                fallbackWorkflowFix(stage, nextActions)
        }
      : null;

  return {
    stage,
    blocker: workflowBlocker,
    nextActions,
    remainingVisualReviews: remaining
      .slice(0, VISUAL_REVIEW_RESPONSE_LIMIT)
      .map(visualReviewKey),
    remainingVisualReviewCount: remaining.length,
    visualReviewsTruncated:
      remaining.length > VISUAL_REVIEW_RESPONSE_LIMIT
  };
};
