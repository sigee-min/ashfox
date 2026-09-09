import type { ProjectDocument } from '@ashfox/engine-core';
import { applyAnimationPose } from '@ashfox/render-core/animationPose';
import { stageShowcase } from './showcaseStage';
import { createCaptureProjection } from '@ashfox/render-core/capture/projection';
import { requiredCaptureForward, waitForProjectionTextures } from '@ashfox/render-core/captureSurface';
import { createGifCaptureSurface, disposeGifCaptureSurface, encodeGifSurfaceFrame, finishGifCaptureSurface } from '@ashfox/render-core/capture/gifCaptureSurface';

/** Finished showcase poses use the same canonical sampler as the Workbench. */
export const renderShowcaseMotion = async (
  document: ProjectDocument,
  clipName: string
): Promise<Blob> => {
  const clip = Object.values(document.animations).find((value) => value.name === clipName);
  if (!clip) throw new Error(`Missing showcase motion: ${clipName}`);
  const surface = createGifCaptureSurface('studio', 'perspective', requiredCaptureForward(document));
  const projection = createCaptureProjection(document, {});
  surface.scene.add(projection.root);
  let disposeStage = () => {};
  try {
    await waitForProjectionTextures(projection, new AbortController().signal);
    disposeStage = stageShowcase(document, projection, surface);
    const count = Math.round(clip.durationSeconds * 10);
    for (let index = 0; index < count; index += 1) {
      applyAnimationPose(document, projection, clip.id, index / 10);
      encodeGifSurfaceFrame(surface);
    }
    return new Blob([Uint8Array.from(finishGifCaptureSurface(surface)).buffer], { type: 'image/gif' });
  } finally {
    disposeStage();
    projection.dispose();
    disposeGifCaptureSurface(surface);
  }
};
