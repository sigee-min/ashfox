import {
  canonicalJsonString,
  isAssetProjectAuthorityValid,
  type AssetProject
} from '@ashfox/engine-core';
import {
  hasExactContractKeys,
  isCanonicalIsoDate,
  isClosedContractRecord,
  isNonEmptyContractText
} from '@ashfox/internal-contracts';

import { VISUAL_REVIEW_RENDERER_IDENTIFIER } from '@ashfox/render-core/rendererIdentifier';
import type { VisualReviewObservation } from './observation';
import {
  VISUAL_REVIEW_RECEIPT_SCHEMA_VERSION,
  type UnsignedVisualReviewReceipt,
  type VisualReviewReceipt,
  type VisualReviewReceiptMetadata
} from './schema';
import { visualReviewEvidenceFingerprint } from './fingerprint';
import {
  isPendingVisualReviewObservation
} from './reader';
import { isVisualReviewDecision } from './decision';

const RECEIPT_KEYS = new Set([
  'schemaVersion',
  'projectId',
  'revision',
  'observation',
  'decision',
  'recordedAt',
  'rendererIdentifier',
  'actorId',
  'evidenceFingerprint'
]);

export const visualReviewReceiptFrom = (
  project: AssetProject,
  observation: VisualReviewObservation,
  reviewed: VisualReviewObservation,
  metadata: VisualReviewReceiptMetadata
): VisualReviewReceipt | null => {
  try {
    const reconstructedObservation: VisualReviewObservation = {
      ...reviewed,
      data: {
        ...reviewed.data,
        review: observation.data.review,
        verdict: 'pending',
        issues: [],
        acknowledgedCheckIds: [],
        failedCheckIds: []
      }
    };
    if (
      observation.data.verdict !== 'pending' ||
      reviewed.data.verdict === 'pending' ||
      observation.revision !== reviewed.revision ||
      canonicalJsonString(reconstructedObservation) !==
        canonicalJsonString(observation) ||
      project.id.length === 0 ||
      project.revision !== observation.revision ||
      observation.data.purpose !== 'delivery' ||
      reviewed.data.purpose !== 'delivery'
    ) {
      return null;
    }
    const receipt: UnsignedVisualReviewReceipt = {
      schemaVersion: VISUAL_REVIEW_RECEIPT_SCHEMA_VERSION,
      projectId: project.id,
      revision: project.revision,
      observation: structuredClone(observation),
      decision: {
        verdict: reviewed.data.verdict,
        issues: [...reviewed.data.issues],
        acknowledgedCheckIds: [...reviewed.data.acknowledgedCheckIds],
        failedCheckIds: [...reviewed.data.failedCheckIds]
      },
      recordedAt: metadata.recordedAt,
      rendererIdentifier: VISUAL_REVIEW_RENDERER_IDENTIFIER,
      actorId: metadata.actorId
    };
    const complete: VisualReviewReceipt = {
      ...receipt,
      evidenceFingerprint: visualReviewEvidenceFingerprint(project, receipt)
    };
    return isValidVisualReviewReceipt(complete, project) ? complete : null;
  } catch {
    return null;
  }
};

export const isValidVisualReviewReceipt = (
  value: unknown,
  project: AssetProject
): value is VisualReviewReceipt => {
  if (
    !isAssetProjectAuthorityValid(project) ||
    !isClosedContractRecord(value) ||
    !hasExactContractKeys(value, RECEIPT_KEYS) ||
    value.schemaVersion !== VISUAL_REVIEW_RECEIPT_SCHEMA_VERSION ||
    value.projectId !== project.id ||
    value.revision !== project.revision ||
    !isPendingVisualReviewObservation(value.observation, project.document) ||
    value.observation.data.purpose !== 'delivery' ||
    !isVisualReviewDecision(value.decision, value.observation) ||
    !isCanonicalIsoDate(value.recordedAt) ||
    value.rendererIdentifier !== VISUAL_REVIEW_RENDERER_IDENTIFIER ||
    !isNonEmptyContractText(value.actorId) ||
    typeof value.evidenceFingerprint !== 'string'
  ) {
    return false;
  }
  const receipt: UnsignedVisualReviewReceipt = {
    schemaVersion: VISUAL_REVIEW_RECEIPT_SCHEMA_VERSION,
    projectId: project.id,
    revision: project.revision,
    observation: value.observation,
    decision: value.decision,
    recordedAt: value.recordedAt,
    rendererIdentifier: VISUAL_REVIEW_RENDERER_IDENTIFIER,
    actorId: value.actorId
  };
  return value.evidenceFingerprint ===
    visualReviewEvidenceFingerprint(project, receipt);
};
