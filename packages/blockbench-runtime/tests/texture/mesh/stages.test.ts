import assert from 'node:assert/strict';

import type { PaintMeshFacePayload } from '@ashfox/blockbench-contracts/types/internal';
import {
  normalizePaintMeshFaceRequest,
  rasterizeMeshFacePaint,
  validateMeshPaintGeometry,
} from '../../../src/usecases/textureTools/mesh';

const payload: PaintMeshFacePayload = {
  textureName: 'atlas',
  target: { meshId: 'mesh-wing', faceId: 'front' },
  op: {
    op: 'fill_rect',
    x: 0,
    y: 0,
    width: 2,
    height: 2,
    color: '#ff0000',
  },
};

const normalized = normalizePaintMeshFaceRequest(payload);
if (!normalized.ok) throw new Error(normalized.error.message);
assert.equal(normalized.ok, true);
assert.deepEqual(normalized.value, {
  target: {
    meshId: 'mesh-wing',
    meshName: undefined,
    faceId: 'front',
    scope: 'single_face',
  },
  coordSpace: 'face',
  mapping: 'stretch',
  op: payload.op,
});

const outside = validateMeshPaintGeometry(
  'texture',
  { op: 'set_pixel', x: 3, y: 3, color: '#ff0000' },
  [{ x1: 0, y1: 0, x2: 2, y2: 2 }],
  { x1: 0, y1: 0, x2: 2, y2: 2 },
  { sourceWidth: 4, sourceHeight: 4 },
);
assert.equal(outside.ok, false, 'geometry rejects ops outside selected UVs');

const current = new Uint8ClampedArray(4 * 4 * 4);
for (let index = 3; index < current.length; index += 4) current[index] = 255;
const before = new Uint8ClampedArray(current);
const raster = rasterizeMeshFacePaint({
  textureWidth: 4,
  textureHeight: 4,
  sourceWidth: 2,
  sourceHeight: 2,
  currentPixels: current,
  rects: [{ x1: 0, y1: 0, x2: 2, y2: 2 }],
  op: payload.op,
  coordSpace: 'face',
  mapping: 'stretch',
  textureLabel: 'atlas',
});
if (!raster.ok) throw new Error(raster.error.message);
assert.equal(raster.ok, true);
assert.deepEqual(current, before, 'raster stage never mutates host-owned pixels');
assert.notDeepEqual(raster.value.pixels, before);
assert.equal(raster.value.pixels[(3 * 4 + 3) * 4], 0);
assert.equal(raster.value.changedPixels > 0, true);
