import {
  blockingCanonicalAnimationPreviewIssues,
  canonicalJsonString,
  type ProjectDocument
} from '@ashfox/engine-core';
import {
  isDenseContractArray,
  hasExactContractKeys,
  isClosedContractRecord,
  isNonEmptyContractText
} from '@ashfox/internal-contracts';

import { isPixelFrameEvidence } from '../../rendering/pixelFrameEvidence';
import {
  VISUAL_REVIEW_CAMERAS,
  visualReviewChecksForCamera,
  type VisualReviewCamera,
  type VisualReviewObservation
} from './observation';
import { isReviewCheckArray } from './checks';

const OBSERVATION_KEYS = new Set(['ok', 'revision', 'data']);
const OBSERVATION_DATA_KEYS = new Set([
  'review',
  'purpose',
  'verdict',
  'issues',
  'acknowledgedCheckIds',
  'failedCheckIds',
  'frameNonce',
  'mode',
  'camera',
  'cameraMatrix',
  'frameEvidence',
  'clipId',
  'playing',
  'observedTimeSeconds',
  'completedCycles',
  'reviewChecks'
]);
const CAMERA_SET: ReadonlySet<unknown> = new Set(VISUAL_REVIEW_CAMERAS);

const isVisualReviewCamera = (
  value: unknown
): value is VisualReviewCamera => CAMERA_SET.has(value);

const isSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isFiniteNumberArray = (
  value: unknown,
  length: number
): value is readonly number[] =>
  isDenseContractArray(value) &&
  value.length === length &&
  value.every(isFiniteNumber);

export const isPendingVisualReviewObservation = (
  value: unknown,
  document: ProjectDocument
): value is VisualReviewObservation => {
  if (
    !isClosedContractRecord(value) ||
    !hasExactContractKeys(value, OBSERVATION_KEYS) ||
    value.ok !== true ||
    value.revision !== document.revision ||
    !isClosedContractRecord(value.data) ||
    !hasExactContractKeys(value.data, OBSERVATION_DATA_KEYS)
  ) {
    return false;
  }
  const data = value.data;
  const review = data.review;
  const clipId = data.clipId;
  const mode = data.mode;
  const camera = data.camera;
  if (
    (review !== 'next' && review !== 'preview') ||
    !(
      (review === 'next' && data.purpose === 'delivery') ||
      (review === 'preview' && data.purpose === 'preview')
    ) ||
    !(clipId === null || isNonEmptyContractText(clipId)) ||
    (mode !== 'frame' && mode !== 'cycle') ||
    !isVisualReviewCamera(camera)
  ) {
    return false;
  }
  const animation = clipId === null ? null : document.animations[clipId];
  const cycleIsValid = mode === 'cycle'
    ? animation !== undefined && animation !== null &&
      isSafeInteger(data.completedCycles) && data.completedCycles >= 1
    : clipId === null && data.completedCycles === 0;
  const previewPathIsValid = clipId === null ||
    (animation !== undefined && animation !== null &&
      blockingCanonicalAnimationPreviewIssues(animation).length === 0);
  const observationModeIsValid = review === 'preview'
    ? mode === 'frame' && clipId === null
    : mode === 'frame'
      ? clipId === null
      : camera === 'perspective';
  return data.verdict === 'pending' &&
    isDenseContractArray(data.issues) && data.issues.length === 0 &&
    isDenseContractArray(data.acknowledgedCheckIds) &&
      data.acknowledgedCheckIds.length === 0 &&
    isDenseContractArray(data.failedCheckIds) &&
      data.failedCheckIds.length === 0 &&
    isSafeInteger(data.frameNonce) && data.frameNonce > 0 &&
    isFiniteNumberArray(data.cameraMatrix, 16) &&
    isPixelFrameEvidence(data.frameEvidence) &&
    data.playing === false &&
    isFiniteNumber(data.observedTimeSeconds) &&
      data.observedTimeSeconds === 0 &&
    cycleIsValid &&
    previewPathIsValid &&
    observationModeIsValid &&
    isReviewCheckArray(data.reviewChecks) &&
    canonicalJsonString(data.reviewChecks) === canonicalJsonString(
      visualReviewChecksForCamera(camera)
    );
};
