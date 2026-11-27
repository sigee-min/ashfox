import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { TextureAsset } from '@ashfox/engine-core';
import { buildStandardMaterial } from '@ashfox/render-core';

const makeTexture = (overrides: Partial<TextureAsset>): TextureAsset => ({
  id: 'tex:test',
  name: 'test',
  width: 64,
  height: 64,
  source: {
    bucket: 'inline',
    key: 'test.png',
    contentType: 'image/png',
    contentHash: 'sha256:test',
  },
  visible: true,
  sampling: 'nearest',
  colorSpace: 'srgb',
  renderMode: 'default',
  renderSides: 'auto',
  ...overrides,
});

const baseDetails = [
  {
    id: 'fill',
    color: '#8899aa',
    alpha: 255,
    x: 0,
    y: 0,
    width: 4,
    height: 4,
  },
] as const;

// 1. Binary cutout atlas (backgroundAlpha === 0, !additive, !softAlpha) must match glTF MASK.
for (const alphaMode of [undefined, 'binary'] as const) {
  const mat = buildStandardMaterial(
    {
      texture: makeTexture({
        renderSides: 'double',
        raster: {
          background: '#000000',
          backgroundAlpha: 0,
          ...(alphaMode ? { alphaMode } : {}),
          canvasDetails: baseDetails,
        },
      }),
      map: null,
      mrMap: null,
    },
    0,
  );
  assert.ok(mat instanceof THREE.MeshStandardMaterial);
  assert.equal(mat.alphaTest, 0.5);
  assert.equal(mat.transparent, false);
  assert.equal(mat.depthWrite, true);
  assert.equal(mat.side, THREE.DoubleSide);
  mat.dispose();
}

// 2. Soft-alpha atlas must preserve transparent blending with depthWrite disabled.
{
  const mat = buildStandardMaterial(
    {
      texture: makeTexture({
        raster: {
          background: '#000000',
          backgroundAlpha: 0,
          alphaMode: 'soft',
          canvasDetails: baseDetails,
        },
      }),
      map: null,
      mrMap: null,
    },
    0,
  );
  assert.ok(mat instanceof THREE.MeshStandardMaterial);
  assert.equal(mat.transparent, true);
  assert.equal(mat.depthWrite, false);
  assert.equal(mat.alphaTest, 0);
  mat.dispose();
}

// 3. Additive atlas (renderMode or metadata) must use additive unlit blending with depthWrite disabled.
for (const overrides of [
  { renderMode: 'additive' as const },
  { metadata: { ashfoxBlendMode: 'additive' } },
]) {
  const mat = buildStandardMaterial(
    {
      texture: makeTexture({
        ...overrides,
        raster: {
          background: '#000000',
          backgroundAlpha: 0,
          canvasDetails: baseDetails,
        },
      }),
      map: null,
      mrMap: null,
    },
    0,
  );
  assert.ok(mat instanceof THREE.MeshBasicMaterial);
  assert.equal(mat.transparent, true);
  assert.equal(mat.depthWrite, false);
  assert.equal(mat.blending, THREE.AdditiveBlending);
  mat.dispose();
}

// 4. Opaque atlas remains opaque with depthWrite enabled and zero alphaTest.
{
  const mat = buildStandardMaterial(
    {
      texture: makeTexture({
        raster: {
          background: '#222222',
          backgroundAlpha: 255,
          canvasDetails: baseDetails,
        },
      }),
      map: null,
      mrMap: null,
    },
    0,
  );
  assert.ok(mat instanceof THREE.MeshStandardMaterial);
  assert.equal(mat.transparent, false);
  assert.equal(mat.depthWrite, true);
  assert.equal(mat.alphaTest, 0);
  mat.dispose();
}

console.log('render-core binary cutout depthWrite tests ok');
