import assert from 'node:assert/strict';

import {
  canonicalRgbaDigest,
  encodeCanonicalPng,
  rasterizeCanonicalTexture
} from '../../src';
import {
  PRESERVE_RASTER_MAX_DETAILS,
  TEXTURE_MAX_RESOLUTION
} from '../../src/textures/limits';
import type { TextureComposition } from '../../src/textures/textureRecipe/types';

const composition = (
  overrides: Partial<TextureComposition> = {}
): TextureComposition => ({
  background: '#000000',
  backgroundAlpha: 0,
  canvasDetails: [],
  alphaMasks: [],
  ...overrides
});

const detail = (overrides: Partial<TextureComposition['canvasDetails'][number]> = {}) => ({
  id: 'detail',
  color: '#ffffff',
  alpha: 255 as const,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  ...overrides
});

for (const [width, height, label] of [
  [0, 1, 'zero width'],
  [1.5, 1, 'non-integer width'],
  [TEXTURE_MAX_RESOLUTION + 1, 1, 'width above the shared limit'],
  [1, Number.NaN, 'non-finite height']
] as const) {
  assert.throws(
    () => rasterizeCanonicalTexture(width, height, composition()),
    /dimensions must be safe integers/u,
    `${label} must fail closed before allocation`
  );
}

assert.throws(
  () => rasterizeCanonicalTexture(1, 1, composition({ background: '#bad' })),
  /exactly six hexadecimal digits/u,
  'invalid background colors must not become a renderer fallback color'
);

for (const [value, label] of [
  [detail({ color: '#bad' }), 'invalid detail color'],
  [detail({ x: -1 }), 'negative detail origin'],
  [detail({ x: 1 }), 'detail outside the right edge'],
  [detail({ width: 0 }), 'zero detail width'],
  [detail({ width: 1.5 }), 'non-integer detail width'],
  [detail({ alpha: 1 as unknown as 0 | 255 }), 'non-binary detail alpha']
] as const) {
  assert.throws(
    () => rasterizeCanonicalTexture(1, 1, composition({ canvasDetails: [value] })),
    Error,
    `${label} must not be clipped or normalized silently`
  );
}

assert.throws(
  () => rasterizeCanonicalTexture(2, 2, composition({
    alphaMasks: [{ id: 'mask', x: 0, y: 0, width: 2, height: 2, bits: '010' }]
  })),
  /exactly fill/u,
  'alpha masks must exactly cover their declared rectangle'
);

const validDetail = detail();
assert.throws(
  () => rasterizeCanonicalTexture(1, 1, composition({
    canvasDetails: Array.from(
      { length: PRESERVE_RASTER_MAX_DETAILS + 1 },
      () => validDetail
    )
  })),
  /bounded asset budget/u,
  'detail expansion must respect the shared raster budget'
);

const raster = rasterizeCanonicalTexture(1, 1, composition({
  background: '#102030',
  backgroundAlpha: 255,
  canvasDetails: [validDetail]
}));
assert.equal(Object.isFrozen(raster.rgba), true,
  'canonical RGBA output must be runtime immutable');
assert.equal('fill' in raster.rgba, false,
  'canonical RGBA output must not expose typed-array mutators');
assert.equal('subarray' in raster.rgba, false,
  'canonical RGBA output must not expose its backing buffer');
const mutableCopy = raster.rgba.copy();
mutableCopy[0] = 0;
assert.equal(raster.rgba.at(0), 255,
  'mutating an explicit copy must not mutate canonical RGBA authority');
assert.equal(raster.rgba.at(-1), undefined,
  'canonical RGBA indexing must reject negative indexes');
assert.deepEqual(Array.from(raster.rgba), [255, 255, 255, 255]);
assert.equal(canonicalRgbaDigest(raster), canonicalRgbaDigest(raster),
  'canonical RGBA digest must remain stable after a mutation attempt');

const malformedRaster = { width: 1, height: 1, rgba: [0, 0, 0] } as unknown as
  Parameters<typeof encodeCanonicalPng>[0];
assert.throws(
  () => encodeCanonicalPng(malformedRaster),
  /exactly four bytes/u,
  'PNG encoding must reject forged RGBA lengths'
);

console.log('raster/color fail-closed contracts ok');

// Freezing a caller-owned byte facade cannot certify its mutable backing data.
const foreignData = [1, 2, 3, 4];
const foreignBytes = Object.freeze({
  length: 4,
  at: (index: number) => foreignData[index],
  copy: () => Uint8Array.from(foreignData),
  *[Symbol.iterator]() { yield* foreignData; }
});
encodeCanonicalPng({ width: 1, height: 1, rgba: foreignBytes });
foreignData[0] = 256;
assert.throws(() => encodeCanonicalPng({ width: 1, height: 1, rgba: foreignBytes }), /exactly four bytes/);
assert.throws(() => encodeCanonicalPng({ width: 2, height: 1, rgba: raster.rgba }), /exactly four bytes/,
  'Constructor provenance does not bypass dimensions or byte count validation.');
