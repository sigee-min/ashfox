import assert from 'node:assert/strict';
import * as THREE from 'three';

import type { SceneNode } from '@ashfox/engine-core';

import { addNodeGeometry } from '@ashfox/render-core/sceneGeometry';

const node: Extract<SceneNode, { kind: 'plane' }> = {
  id: 'cutout', kind: 'plane', name: 'cutout', parentId: null,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], pivot: [0, 0, 0] },
  visible: true, size: [2, 2],
  basis: { normal: [0, 0, 1], uAxis: [1, 0, 0], vAxis: [0, 1, 0], orientation: 'normal' },
  sidedness: 'front', coverageId: 'main',
  faces: { front: { enabled: true, textureId: null }, back: { enabled: false, textureId: null } }
};
const sourceMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff' });
const group = new THREE.Group();
addNodeGeometry(node, group, {
  materials: {
    resolve: () => sourceMaterial,
    ready: Promise.resolve(),
    dispose: () => undefined
  },
  textures: {},
  options: { assets: {}, showSkeleton: false, showWireframe: false },
  selectable: []
});
const mesh = group.children[0];
assert.ok(mesh instanceof THREE.Mesh);
if (mesh instanceof THREE.Mesh) {
  assert.ok(mesh.material instanceof THREE.MeshStandardMaterial);
  if (mesh.material instanceof THREE.MeshStandardMaterial) {
    assert.equal(mesh.material.alphaTest, 0.5);
    assert.equal(mesh.material.transparent, false);
    assert.equal(mesh.material.depthWrite, true);
  }
}

const doubleNode: Extract<SceneNode, { kind: 'plane' }> = {
  ...node,
  id: 'double-cutout',
  sidedness: 'double',
  faces: { front: { enabled: true, textureId: null }, back: { enabled: true, textureId: null } }
};
const doubleGroup = new THREE.Group();
addNodeGeometry(doubleNode, doubleGroup, {
  materials: {
    resolve: () => sourceMaterial,
    ready: Promise.resolve(),
    dispose: () => undefined
  },
  textures: {},
  options: { assets: {}, showSkeleton: false, showWireframe: false },
  selectable: []
});
assert.equal(doubleGroup.children.length, 1,
  'double-sided cutouts must use one depth-writing mesh');
const doubleMesh = doubleGroup.children[0];
assert.ok(doubleMesh instanceof THREE.Mesh);
if (doubleMesh instanceof THREE.Mesh && doubleMesh.material instanceof THREE.MeshStandardMaterial) {
  assert.equal(doubleMesh.material.side, THREE.DoubleSide);
  assert.equal(doubleMesh.material.depthWrite, true);
}
sourceMaterial.dispose();
mesh?.traverse((object) => {
  if (object instanceof THREE.Mesh) object.geometry.dispose();
});
doubleMesh?.traverse((object) => {
  if (object instanceof THREE.Mesh) {
    object.geometry.dispose();
    if (object.material instanceof THREE.Material) object.material.dispose();
  }
});

console.log('plane cutout depth contract ok');
