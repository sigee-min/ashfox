/// <reference path="../gifenc.d.ts" />
import {
  GIFEncoder,
  applyPalette,
  quantize
} from 'gifenc';

import type { ProjectForwardDirection } from '@ashfox/engine-core';

import type { CameraMode } from '@ashfox/render-core/cameraPresets';
import type { ViewportEnvironmentId } from '@ashfox/render-core/viewportEnvironment';
import {
  createCaptureSurface,
  disposeCaptureSurface,
  renderCaptureSurface,
  type CaptureDimensions,
  type CaptureSurface
} from '@ashfox/render-core/captureSurface';
import { BUILD_CAPTURE_FPS } from './buildCaptureTimeline';

export const GIF_CAPTURE_WIDTH = 640;
export const GIF_CAPTURE_HEIGHT = 360;

export interface GifCaptureSurface extends CaptureSurface {
  outputContext: CanvasRenderingContext2D;
  encoder: ReturnType<typeof GIFEncoder>;
  frameCount: number;
}

export interface GifCaptureResult extends CaptureDimensions {
  bytes: Uint8Array;
  frameCount: number;
  eventCount: number;
  fps: number;
}

export type GifFrameOverlay = (
  context: CanvasRenderingContext2D
) => void;

export const createGifCaptureSurface = (
  environmentId: ViewportEnvironmentId,
  cameraMode: CameraMode,
  forward?: ProjectForwardDirection
): GifCaptureSurface => {
  const outputCanvas = window.document.createElement('canvas');
  outputCanvas.width = GIF_CAPTURE_WIDTH;
  outputCanvas.height = GIF_CAPTURE_HEIGHT;
  const outputContext = outputCanvas.getContext('2d', {
    willReadFrequently: true
  });
  if (!outputContext) {
    throw new Error('GIF capture canvas is unavailable.');
  }

  return {
    ...createCaptureSurface({
      width: GIF_CAPTURE_WIDTH,
      height: GIF_CAPTURE_HEIGHT,
      environment: environmentId,
      cameraMode,
      forward
    }),
    outputContext,
    encoder: GIFEncoder(),
    frameCount: 0
  };
};

export const encodeGifSurfaceFrame = (
  surface: GifCaptureSurface,
  overlay?: GifFrameOverlay
): void => {
  renderCaptureSurface(surface);
  surface.outputContext.clearRect(
    0,
    0,
    GIF_CAPTURE_WIDTH,
    GIF_CAPTURE_HEIGHT
  );
  surface.outputContext.drawImage(
    surface.renderCanvas,
    0,
    0,
    GIF_CAPTURE_WIDTH,
    GIF_CAPTURE_HEIGHT
  );
  overlay?.(surface.outputContext);

  const rgba = surface.outputContext.getImageData(
    0,
    0,
    GIF_CAPTURE_WIDTH,
    GIF_CAPTURE_HEIGHT
  ).data;
  const palette = quantize(rgba, 128, {
    format: 'rgba4444',
    oneBitAlpha: false
  });
  const indexed = applyPalette(rgba, palette, 'rgba4444');
  surface.encoder.writeFrame(
    indexed,
    GIF_CAPTURE_WIDTH,
    GIF_CAPTURE_HEIGHT,
    {
      palette,
      delay: 1000 / BUILD_CAPTURE_FPS,
      repeat: surface.frameCount === 0 ? 0 : undefined
    }
  );
  surface.frameCount += 1;
};

export const finishGifCaptureSurface = (
  surface: GifCaptureSurface
): Uint8Array => {
  surface.encoder.finish();
  return surface.encoder.bytes();
};

export const gifCaptureByteLength = (
  surface: GifCaptureSurface
): number => surface.encoder.bytesView().byteLength;

export const disposeGifCaptureSurface = (
  surface: GifCaptureSurface
): void => {
  disposeCaptureSurface(surface);
};
