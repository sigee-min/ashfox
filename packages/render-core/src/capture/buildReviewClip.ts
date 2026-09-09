import {
  analyzeAnimationPreview,
  CANONICAL_IDLE_CLIP_NAME,
  type AnimationClip,
  type ProjectDocument
} from '@ashfox/engine-core';

export const resolveBuildReviewClip = (
  document: ProjectDocument
): AnimationClip | null => {
  const preferred = Object.values(document.animations).find(
    (clip) => clip.name === CANONICAL_IDLE_CLIP_NAME
  );
  if (
    !preferred ||
    Object.keys(preferred.channels).length === 0 ||
    analyzeAnimationPreview(preferred).length > 0
  ) {
    return null;
  }
  return preferred;
};
