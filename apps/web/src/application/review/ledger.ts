import { canonicalJsonString } from '@ashfox/engine-core';

import type { VisualReviewObservation } from './observation';
import type { VisualReviewReceipt } from './schema';

export const visualReviewKey = (
  review: Pick<VisualReviewObservation['data'], 'mode' | 'camera' | 'clipId'>
): string => review.clipId === null
  ? `${review.mode}:${review.camera}`
  : `${review.mode}:${review.camera}:${review.clipId}`;

const receiptKey = (receipt: VisualReviewReceipt): string => {
  const data = receipt.observation.data;
  return JSON.stringify([
    data.purpose,
    visualReviewKey(data)
  ]);
};

const receiptOrder = (
  left: VisualReviewReceipt,
  right: VisualReviewReceipt
): number => {
  const byTime = left.recordedAt.localeCompare(right.recordedAt);
  if (byTime !== 0) return byTime;
  const byFrame = left.observation.data.frameNonce -
    right.observation.data.frameNonce;
  return byFrame !== 0
    ? byFrame
    : left.evidenceFingerprint.localeCompare(right.evidenceFingerprint);
};

export const recordVisualReview = (
  receipts: readonly VisualReviewReceipt[],
  receipt: VisualReviewReceipt
): readonly VisualReviewReceipt[] => {
  const active = receipts.filter(
    (candidate) =>
      candidate.projectId === receipt.projectId &&
      candidate.revision === receipt.revision
  );
  const matching = active.find(
    (candidate) => receiptKey(candidate) === receiptKey(receipt)
  );
  const winner = matching && receiptOrder(matching, receipt) > 0
    ? matching
    : structuredClone(receipt);
  return [
    ...active.filter(
      (candidate) => receiptKey(candidate) !== receiptKey(receipt)
    ),
    winner
  ].sort((left, right) => receiptKey(left).localeCompare(receiptKey(right)));
};

export const areVisualReviewLedgersEqual = (
  left: readonly VisualReviewReceipt[],
  right: readonly VisualReviewReceipt[]
): boolean => canonicalJsonString(left) === canonicalJsonString(right);

export const visualReviewPlanItem = (
  receipt: VisualReviewReceipt
): Pick<VisualReviewObservation['data'], 'mode' | 'camera' | 'clipId'> => ({
  mode: receipt.observation.data.mode,
  camera: receipt.observation.data.camera,
  clipId: receipt.observation.data.clipId
});

export const visualReviewsForRevision = (
  receipts: readonly VisualReviewReceipt[],
  projectId: string,
  revision: string
): readonly VisualReviewReceipt[] =>
  receipts.filter(
    (receipt) =>
      receipt.projectId === projectId && receipt.revision === revision
  );

export const deliveryVisualReviewsForRevision = (
  receipts: readonly VisualReviewReceipt[],
  projectId: string,
  revision: string
): readonly VisualReviewReceipt[] =>
  visualReviewsForRevision(receipts, projectId, revision).filter(
    (receipt) => receipt.observation.data.purpose === 'delivery'
  );

export const rejectedVisualReviewsForRevision = (
  receipts: readonly VisualReviewReceipt[],
  projectId: string,
  revision: string
): readonly VisualReviewReceipt[] =>
  deliveryVisualReviewsForRevision(receipts, projectId, revision).filter(
    (receipt) => receipt.decision.verdict === 'rejected'
  );
