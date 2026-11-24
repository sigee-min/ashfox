import assert from 'node:assert/strict';

import { canonicalRasterFaceIsOpaque } from '../../src/export/occlusion/cube';
import type { CubeFace } from '../../src/model';
import { rasterizeCanonicalTexture } from '../../src/textures/textureRecipe/raster';

const raster = rasterizeCanonicalTexture(4, 4, {
  background: '#505a64',
  backgroundAlpha: 255,
  canvasDetails: [],
  alphaMasks: [],
});
const transparentRaster = rasterizeCanonicalTexture(4, 4, {
  background: '#505a64',
  backgroundAlpha: 255,
  canvasDetails: [],
  alphaMasks: [{ id: 'transparent', x: 1, y: 1, width: 1, height: 1, bits: '0' }],
});
const face = (uv: readonly [number, number, number, number] | undefined): CubeFace => ({
  enabled: true,
  textureId: 'atlas',
  ...(uv === undefined ? {} : { uv: [...uv] as [number, number, number, number] }),
  rotation: 90,
});

assert.equal(canonicalRasterFaceIsOpaque(raster, face([0, 0, 2, 2])), true);
assert.equal(
  canonicalRasterFaceIsOpaque(raster, face([2, 2, 0, 0])),
  true,
  'Reversed UV endpoints own the same half-open texel footprint.',
);
assert.equal(canonicalRasterFaceIsOpaque(transparentRaster, face([0, 0, 2, 2])), false);
assert.equal(canonicalRasterFaceIsOpaque(transparentRaster, face([2, 2, 0, 0])), false);
assert.equal(
  canonicalRasterFaceIsOpaque(raster, face([2, 2, 4, 4])),
  true,
  'Transparent texels outside the cube face footprint must not poison it.',
);
assert.equal(canonicalRasterFaceIsOpaque(raster, face(undefined)), false);
assert.equal(canonicalRasterFaceIsOpaque(raster, face([0.5, 0, 2, 2])), false);
assert.equal(canonicalRasterFaceIsOpaque(raster, face([-1, 0, 2, 2])), false);
assert.equal(canonicalRasterFaceIsOpaque(raster, face([0, 0, 0, 2])), false);
console.log('per-face canonical alpha occlusion ok');
