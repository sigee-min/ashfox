import type { ProjectDocument } from '@ashfox/engine-core';

import type { ProjectAssets } from '@ashfox/render-core/assets';
import { applyAnimationPose } from '@ashfox/render-core/animationPose';
import type { CameraMode } from '@ashfox/render-core/cameraPresets';
import type { ProjectSceneProjection } from '@ashfox/render-core/sceneTypes';
import type { ViewportEnvironmentId } from '@ashfox/render-core/viewportEnvironment';
import { createBuildCapturePlan } from './buildCaptureTimeline';
import {
  throwIfCaptureAborted,
  yieldCaptureFrame
} from '@ashfox/render-core/captureAbort';
import {
  createGifCaptureSurface,
  disposeGifCaptureSurface,
  encodeGifSurfaceFrame,
  finishGifCaptureSurface,
  gifCaptureByteLength,
  type GifCaptureResult,
  type GifCaptureSurface
} from './gifCaptureSurface';
import {
  frameCaptureObject,
  requiredCaptureForward,
  waitForProjectionTextures
} from '@ashfox/render-core/captureSurface';
import { drawBuildFrameOverlay, drawShowcasePhase } from './gifFrameOverlay';
import { resolveBuildReviewClip } from './buildReviewClip';
import { createCaptureProjection } from './projection';

export interface BuildGifCaptureOptions {
  readonly document: ProjectDocument;
  readonly assets: ProjectAssets;
  readonly environment: ViewportEnvironmentId;
  readonly cameraMode: CameraMode;
  readonly signal: AbortSignal;
  readonly marketing?: boolean;
  readonly onProgress?: (completed: number, total: number) => void;
}

const MAX_BUILD_CAPTURE_BYTES = 32 * 1024 * 1024;

const setRenderableVisibility = (
  projection: ProjectSceneProjection,
  document: ProjectDocument,
  visible: boolean
): void => {
  for (const node of Object.values(document.scene.nodes)) {
    if (node.kind !== 'cube' && node.kind !== 'plane') continue;
    const object = projection.objectsByNodeId.get(node.id);
    if (object) object.visible = visible && node.visible;
  }
};

const showNode = (
  projection: ProjectSceneProjection,
  document: ProjectDocument,
  nodeId: string,
  visible: boolean
): void => {
  const node = document.scene.nodes[nodeId];
  const object = projection.objectsByNodeId.get(nodeId);
  if (object && node && (node.kind === 'cube' || node.kind === 'plane')) {
    object.visible = visible && node.visible;
  }
};

export const applyBuildCaptureFrame = (
  frame: ReturnType<typeof createBuildCapturePlan>['frames'][number],
  document: ProjectDocument,
  neutral: ProjectSceneProjection,
  textured: ProjectSceneProjection
): void => {
  if (frame.eventFrameIndex === 0) {
    const nodeId = frame.event.nodeId;
    if (frame.event.category === 'geometry' && nodeId) {
      showNode(neutral, document, nodeId, true);
      return;
    }
    if (frame.event.category === 'texture' && nodeId) {
      showNode(neutral, document, nodeId, false);
      showNode(textured, document, nodeId, true);
      return;
    }
    if (
      frame.event.category === 'motion' ||
      frame.event.category === 'complete'
    ) {
      setRenderableVisibility(neutral, document, false);
      setRenderableVisibility(textured, document, true);
      if (frame.event.category === 'complete') {
        applyAnimationPose(document, textured, null, 0);
      }
    }
  }
  if (frame.event.category !== 'motion') return;
  const clip = resolveBuildReviewClip(document);
  if (!clip) return;
  const denominator = Math.max(1, frame.event.holdFrames - 1);
  applyAnimationPose(
    document,
    textured,
    clip.id,
    clip.durationSeconds * frame.eventFrameIndex / denominator
  );
};

export const renderBuildGif = async (
  options: BuildGifCaptureOptions
): Promise<GifCaptureResult> => {
  const plan = createBuildCapturePlan(options.document);
  let surface: GifCaptureSurface | null = null;
  let neutral: ProjectSceneProjection | null = null;
  let textured: ProjectSceneProjection | null = null;

  try {
    surface = createGifCaptureSurface(
      options.environment,
      options.cameraMode,
      requiredCaptureForward(options.document)
    );
    neutral = createCaptureProjection(
      options.document,
      options.assets,
      { showTextures: false }
    );
    textured = createCaptureProjection(options.document, options.assets);
    frameCaptureObject(surface, options.cameraMode, textured.root);
    setRenderableVisibility(neutral, options.document, false);
    setRenderableVisibility(textured, options.document, false);
    surface.scene.add(neutral.root, textured.root);
    await Promise.all([
      waitForProjectionTextures(neutral, options.signal),
      waitForProjectionTextures(textured, options.signal)
    ]);
    for (const frame of plan.frames) {
      throwIfCaptureAborted(options.signal);
      applyBuildCaptureFrame(frame, options.document, neutral, textured);
      encodeGifSurfaceFrame(surface, (context) => {
        if (options.marketing) {
          drawShowcasePhase(context, { start: 'An idea takes shape', geometry: 'Taking shape', texture: 'Adding color', motion: 'Coming to life', complete: 'Ready for your game' }[frame.event.category] ?? 'Creating');
          return;
        }
        drawBuildFrameOverlay(
          context,
          frame.event.label,
          frame.eventIndex,
          plan.events.length,
          frame.progress
        );
      });
      const byteLength = gifCaptureByteLength(surface);
      if (byteLength > MAX_BUILD_CAPTURE_BYTES) {
        throw new Error(
          `Build replay produced more than ${MAX_BUILD_CAPTURE_BYTES} bytes. ` +
          'Reduce visible model detail.'
        );
      }
      options.onProgress?.(frame.index + 1, plan.frames.length);
      await yieldCaptureFrame(options.signal);
    }
    throwIfCaptureAborted(options.signal);
    const bytes = finishGifCaptureSurface(surface);
    if (bytes.byteLength > MAX_BUILD_CAPTURE_BYTES) {
      throw new Error(
        `Build replay produced ${bytes.byteLength} bytes; the exact limit is ` +
        `${MAX_BUILD_CAPTURE_BYTES}. Reduce visible model detail.`
      );
    }
    return {
      bytes,
      width: surface.width,
      height: surface.height,
      frameCount: plan.frames.length,
      eventCount: plan.events.length,
      fps: plan.fps
    };
  } finally {
    if (surface && neutral) surface.scene.remove(neutral.root);
    if (surface && textured) surface.scene.remove(textured.root);
    neutral?.dispose();
    textured?.dispose();
    if (surface) disposeGifCaptureSurface(surface);
  }
};
