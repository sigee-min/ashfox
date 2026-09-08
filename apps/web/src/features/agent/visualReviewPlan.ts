import {
  type AssetProject,
  type ProjectDocument,
  type ProductionReadinessReport
} from '@ashfox/engine-core';

import {
  deliveryVisualReviewsForRevision,
  isValidVisualReviewReceipt,
  visualReviewKey,
  visualReviewPlanItem,
  type VisualReviewCamera,
  type VisualReviewReceipt
} from '../../application/review';

export { visualReviewKey } from '../../application/review';

/* Reviews always cover canonical motion before an export adapter derives it. */
const animationReviewClipIds = (
  document: ProjectDocument
): readonly string[] =>
  Object.keys(document.animations).sort();

export interface VisualReviewPlanItem {
  mode: 'frame' | 'cycle';
  camera: VisualReviewCamera;
  clipId: string | null;
}

const STATIC_CAMERAS: readonly VisualReviewCamera[] = [
  'perspective',
  'native',
  'front',
  'left',
  'right',
  'top'
];

export const requiredVisualReviews = (
  document: ProjectDocument
): readonly VisualReviewPlanItem[] => [
  ...STATIC_CAMERAS.map((camera): VisualReviewPlanItem => ({
    mode: 'frame',
    camera,
    clipId: null
  })),
  ...animationReviewClipIds(document)
    .map((clipId): VisualReviewPlanItem => ({
      mode: 'cycle',
      camera: 'perspective',
      clipId
    }))
];

const completedVisualReviewKeys = (
  project: AssetProject,
  receipts: readonly VisualReviewReceipt[]
): ReadonlySet<string> =>
  new Set(
    deliveryVisualReviewsForRevision(
      receipts,
      project.id,
      project.revision
    ).flatMap((receipt) => {
      if (!isValidVisualReviewReceipt(receipt, project)) return [];
      if (receipt.decision.verdict !== 'accepted') return [];
      if (
        receipt.observation.data.mode === 'cycle' &&
        receipt.observation.data.completedCycles < 1
      ) {
        return [];
      }
      return [visualReviewKey(visualReviewPlanItem(receipt))];
    })
  );

export const remainingVisualReviews = (
  project: AssetProject,
  readiness: ProductionReadinessReport,
  receipts: readonly VisualReviewReceipt[]
): readonly VisualReviewPlanItem[] => {
  if (readiness.counts.visibleGeometry === 0) return [];
  const completed = completedVisualReviewKeys(project, receipts);
  return requiredVisualReviews(project.document).filter(
    (review) => !completed.has(visualReviewKey(review))
  );
};

export const nextVisualReview = (
  project: AssetProject,
  readiness: ProductionReadinessReport,
  receipts: readonly VisualReviewReceipt[]
): VisualReviewPlanItem | null =>
  remainingVisualReviews(project, readiness, receipts)[0] ?? null;
