import {
  PIXEL_FRAME_EVIDENCE_ALGORITHM,
  type PixelFrameEvidence
} from '@ashfox/render-core/pixelFrameEvidence';

/** Dimension-bound SHA-256 of a one-pixel opaque-black RGBA frame. */
export const FRAME_EVIDENCE_FIXTURE: PixelFrameEvidence = {
  algorithm: PIXEL_FRAME_EVIDENCE_ALGORITHM,
  width: 1,
  height: 1,
  rgbaByteLength: 4,
  pixelHash:
    'sha256:c88126a751b13b74fd01cf2137159804d13772bd9904060980b9b2fc044138ba'
};
