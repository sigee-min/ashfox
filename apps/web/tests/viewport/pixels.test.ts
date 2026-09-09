import assert from 'node:assert/strict';

import {
  isPixelFrameEvidence,
  pixelFrameEvidenceFromRgba
} from '@ashfox/render-core/pixelFrameEvidence';
import { FRAME_EVIDENCE_FIXTURE } from '../fixtures/frame';

export const test = (async (): Promise<void> => {
  const opaqueBlack = await pixelFrameEvidenceFromRgba(
    1,
    1,
    new Uint8Array([0, 0, 0, 255])
  );
  assert.deepEqual(
    opaqueBlack,
    FRAME_EVIDENCE_FIXTURE,
    'frame evidence hashes the complete RGBA buffer with its dimensions'
  );

  const onePixelChanged = await pixelFrameEvidenceFromRgba(
    1,
    1,
    new Uint8Array([0, 0, 1, 255])
  );
  assert.notEqual(
    onePixelChanged.pixelHash,
    opaqueBlack.pixelHash,
    'a single rendered channel change must produce different evidence'
  );

  const twoPixels = await pixelFrameEvidenceFromRgba(
    2,
    1,
    new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255])
  );
  const samePixelsDifferentShape = await pixelFrameEvidenceFromRgba(
    1,
    2,
    new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255])
  );
  assert.notEqual(
    twoPixels.pixelHash,
    samePixelsDifferentShape.pixelHash,
    'the drawing-buffer dimensions are part of the pixel fingerprint'
  );

  assert.equal(isPixelFrameEvidence(opaqueBlack), true);
  assert.equal(
    isPixelFrameEvidence({
      ...opaqueBlack,
      rgbaByteLength: 3
    }),
    false,
    'evidence byte length must match width x height x RGBA'
  );
  assert.equal(
    isPixelFrameEvidence({ ...opaqueBlack, unbound: true }),
    false,
    'pixel evidence is a closed contract'
  );

  await assert.rejects(
    pixelFrameEvidenceFromRgba(
      1,
      1,
      new Uint8Array([0, 0, 0])
    ),
    RangeError
  );
})();
