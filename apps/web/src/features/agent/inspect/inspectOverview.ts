import {
  evaluateProductionReadiness,
  exportCompatibilityOptions,
  type AssetProject,
  type ProjectDocument,
  type ValidationReport
} from '@ashfox/engine-core';

import {
  boundedSuccess
} from '../boundedResult';
import {
  deriveInspectWorkflow
} from '../inspectWorkflow';
import type {
  VisualReviewReceipt
} from '../../../application/review';
import type {
  InspectResult
} from '../types';
import {
  DEFAULT_INSPECT_LIMIT
} from './inspectResult';

const targetPreflight = Object.freeze({
  availableTargets: Object.freeze(
    exportCompatibilityOptions().map(({ target }) => target)
  ),
  mode: 'on-demand' as const
});

/** The agent sees workspace/build identity and readiness, never source bytes. */
export const inspectOverview = (
  project: AssetProject,
  _selectedNodeId: string | null,
  report: ValidationReport,
  visualReviews: readonly VisualReviewReceipt[],
  _operationOwner: string | null
): InspectResult => {
  const document: ProjectDocument = project.document;
  const readiness = evaluateProductionReadiness(document, report);
  const workflow = deriveInspectWorkflow(
    project,
    report,
    readiness,
    visualReviews
  );
  return boundedSuccess(
    document.revision,
    {
      revision: document.revision,
      workspaceHash: project.build.workspaceHash,
      entry: project.entry,
      build: {
        packageName: project.build.packageName,
        entryName: project.build.entryName,
        path: project.build.path,
        closureHash: project.build.closureHash,
        buildKey: project.build.buildKey,
        compilerFingerprint: project.build.compilerFingerprint,
        productHash: project.build.productHash
      },
      counts: readiness.counts,
      readiness: {
        structurallyValid: readiness.structurallyValid,
        mechanicallyReady: readiness.mechanicallyReady,
      },
      blocker: workflow.blocker,
      nextActions: workflow.nextActions,
      workflow: {
        stage: workflow.stage,
        remainingVisualReviews: workflow.remainingVisualReviews,
        remainingVisualReviewCount: workflow.remainingVisualReviewCount,
        visualReviewsTruncated: workflow.visualReviewsTruncated
      },
      targetPreflight
    },
    DEFAULT_INSPECT_LIMIT
  );
};
