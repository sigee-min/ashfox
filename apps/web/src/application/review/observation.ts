import type { CameraMode } from '../../rendering/cameraPresets';
import type { PixelFrameEvidence } from '../../rendering/pixelFrameEvidence';

/** Web-owned observation vocabulary; it does not enforce compiler aesthetics. */
export const VISUAL_REVIEW_ISSUES = Object.freeze([
  'silhouette', 'proportion', 'connection', 'clipping', 'feature_detail',
  'material', 'pivot', 'motion', 'other'
] as const);
export type VisualReviewIssue = (typeof VISUAL_REVIEW_ISSUES)[number];

export const VISUAL_REVIEW_CAMERAS = Object.freeze([
  'perspective', 'native', 'front', 'left', 'right', 'top'
] as const);
export type VisualReviewCamera =
  (typeof VISUAL_REVIEW_CAMERAS)[number];

export interface VisualReviewCheck {
  readonly id: string;
  readonly issue: VisualReviewIssue;
  readonly instruction: string;
}

export interface VisualReviewObservation {
  readonly ok: true;
  readonly revision: string;
  readonly data: {
    readonly review: 'next' | 'preview' | 'accept' | 'reject';
    readonly purpose: 'delivery' | 'preview';
    readonly verdict: 'pending' | 'accepted' | 'rejected';
    readonly issues: readonly VisualReviewIssue[];
    readonly acknowledgedCheckIds: readonly string[];
    readonly failedCheckIds: readonly string[];
    readonly frameNonce: number;
    readonly mode: 'frame' | 'cycle';
    readonly camera: CameraMode;
    readonly cameraMatrix: readonly number[];
    readonly frameEvidence: PixelFrameEvidence;
    readonly clipId: string | null;
    readonly playing: boolean;
    readonly observedTimeSeconds: number;
    readonly completedCycles: number;
    readonly reviewChecks: readonly VisualReviewCheck[];
  };
}

/**
 * The bilateral comparison is bound to the authored right view. The left
 * receipt remains independently reviewable, so a first left-side observation
 * never claims that an unobserved opposite frame was compared.
 */
const VISUAL_REVIEW_BILATERAL_CHECK: VisualReviewCheck = Object.freeze({
  id: 'source.bilateral-detail',
  issue: 'feature_detail',
  instruction:
    'Compare the authored left and right detail directly. Confirm deliberate asymmetry is preserved and every bilateral feature is intentional; do not infer a match from one side.'
});

export const VISUAL_REVIEW_CHECKS: readonly VisualReviewCheck[] = Object.freeze([
  Object.freeze({
    id: 'source.silhouette',
    issue: 'silhouette',
    instruction:
      'Inspect label-hidden front, left, right, top, and perspective views: the gameplay-size silhouette and primary read remain legible.'
  }),
  Object.freeze({
    id: 'source.element-economy',
    issue: 'other',
    instruction:
      'Check element economy in the authored source: every cube, plane, hierarchy edge, pivot, and rotation has a visible structural purpose.'
  }),
  Object.freeze({
    id: 'source.pixel-uv',
    issue: 'feature_detail',
    instruction:
      'Inspect native-size texture and UV evidence: model units and texels stay aligned, clusters are deliberate, and thin planes use explicit binary alpha.'
  }),
  Object.freeze({
    id: 'source.palette-shading',
    issue: 'material',
    instruction:
      'Check the authored palette and shading: restricted colors support form without noise, banding, pillow or pancake shading, or accidental dithering.'
  }),
  Object.freeze({
    id: 'source.pivot-motion',
    issue: 'pivot',
    instruction:
      'Inspect pivots and motion at joints or attachments: keyframed parts remain connected and the movement reads without pops or implausible arcs.'
  })
]);

export const visualReviewChecksForCamera = (
  camera: VisualReviewCamera
): readonly VisualReviewCheck[] => camera === 'right'
  ? Object.freeze([...VISUAL_REVIEW_CHECKS, VISUAL_REVIEW_BILATERAL_CHECK])
  : VISUAL_REVIEW_CHECKS;
