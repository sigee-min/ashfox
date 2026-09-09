import * as THREE from 'three';

import {
  pixelFrameEvidenceFromRgba,
  type PixelFrameEvidence
} from '@ashfox/render-core/pixelFrameEvidence';

export type ViewportFrameEvidenceCapture =
  | { ok: true; evidence: PixelFrameEvidence }
  | { ok: false; error: string };

export const captureViewportFrameEvidence = async (
  renderer: THREE.WebGLRenderer
): Promise<ViewportFrameEvidenceCapture> => {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const width = Math.floor(size.x);
  const height = Math.floor(size.y);
  if (width <= 0 || height <= 0) {
    return {
      ok: false,
      error: 'the viewport drawing buffer has no pixels'
    };
  }

  const context = renderer.getContext();
  if (context.isContextLost()) {
    return {
      ok: false,
      error: 'the viewport WebGL context is lost'
    };
  }

  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (context.getError() === context.NO_ERROR) break;
    }
    const pixels = new Uint8Array(width * height * 4);
    context.readPixels(
      0,
      0,
      width,
      height,
      context.RGBA,
      context.UNSIGNED_BYTE,
      pixels
    );
    const error = context.getError();
    if (error !== context.NO_ERROR) {
      return {
        ok: false,
        error: `WebGL readPixels failed with error ${error}`
      };
    }
    return {
      ok: true,
      evidence: await pixelFrameEvidenceFromRgba(width, height, pixels)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error
        ? error.message
        : 'the viewport pixels could not be captured'
    };
  }
};
