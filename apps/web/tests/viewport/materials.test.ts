import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  configureTextureMap,
  createProjectMaterials,
  materialEmissionIntensity
} from '@ashfox/render-core/sceneMaterials';
import type { TextureAsset } from '@ashfox/engine-core';
import { createWorkbenchProject } from '../fixtures/project';

assert.equal(materialEmissionIntensity('default'), 0);
assert.equal(materialEmissionIntensity('emissive'), 1.15);
assert.equal(materialEmissionIntensity('additive'), 1.15);
assert.equal(materialEmissionIntensity('default', 15), 2.5);
assert.equal(materialEmissionIntensity('emissive', 10), 10 / 6);
assert.equal(materialEmissionIntensity('default', -1), 0);

const texture = (
  sampling: TextureAsset['sampling']
): TextureAsset => ({
  id: `texture-${sampling}`,
  name: `${sampling} texture`,
  width: 16,
  height: 16,
  source: {
    bucket: 'local',
    key: 'texture.png',
    contentType: 'image/png',
    contentHash: 'sha256:test'
  },
  visible: true,
  sampling,
  colorSpace: 'srgb',
  renderMode: 'default',
  renderSides: 'auto'
});

const preservedMap = configureTextureMap(
  new THREE.Texture(),
  texture('nearest')
);
assert.equal(preservedMap.magFilter, THREE.NearestFilter);
assert.equal(
  preservedMap.minFilter,
  THREE.NearestMipmapNearestFilter
);
assert.equal(
  preservedMap.generateMipmaps,
  true,
  'preserved texture sampling behavior must remain unchanged'
);

export const test = (async (): Promise<void> => {
  const document = createWorkbenchProject().document;
  const materials = createProjectMaterials(
    document,
    {},
    '#b59a74',
    false
  );
  await materials.ready;
  const textureId = Object.keys(document.textures)[0] ?? 'missing';
  const neutral = materials.resolve(textureId);
  assert.ok(neutral instanceof THREE.MeshStandardMaterial);
  assert.equal(neutral.color.getHexString(), 'b59a74');
  materials.dispose();
})();
