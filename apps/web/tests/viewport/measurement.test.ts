import assert from 'node:assert/strict';
import * as THREE from 'three';
import { measureSceneGeometry, type BoneNode, type CubeNode, type PlaneNode,
  type SceneNode } from '@ashfox/engine-core';
import { addNodeGeometry } from '@ashfox/render-core/sceneGeometry';
import { applyNodeTransform } from '@ashfox/render-core/sceneTransform';
import { createWorkbenchProject } from '../fixtures/project';

const face = { enabled: true, textureId: null };
const cube: CubeNode = {
  id: 'cube', name: 'cube', kind: 'cube', parentId: 'child', visible: true,
  transform: { pivot: [2, 3, -1], position: [1, -2, 3],
    rotation: [13, -27, 41], scale: [1.2, 0.8, 1.5] },
  geometryMode: 'axis-box', bounds: { from: [-3, 2, 1], to: [2, 7, 8] },
  inflate: 0.25, mirror: false, boxUv: false,
  faces: { north: face, south: face, east: face, west: face, up: face, down: face }
};
const root: BoneNode = { id: 'root', name: 'root', kind: 'bone', parentId: null, visible: true,
  transform: { pivot: [3, -1, 2], position: [7, 4, -5], rotation: [23, 45, -17], scale: [2, 1, 0.5] } };
const child: BoneNode = { ...root, id: 'child', parentId: 'root',
  transform: { pivot: [-1, 6, 4], position: [2, 1, 3], rotation: [-11, 32, 9], scale: [1, 1.5, 0.75] } };
const plane: PlaneNode = { id: 'plane', name: 'plane', kind: 'plane', parentId: 'child',
  visible: true, transform: cube.transform, size: [3, 5],
  basis: { uAxis: [0, 0, -1], vAxis: [0, 1, 0], normal: [1, 0, 0], orientation: 'normal' },
  coverageId: 'plane', sidedness: 'front', faces: { front: face, back: { ...face, enabled: false } } };
const oriented: CubeNode = { ...cube, geometryMode: 'oriented-box', bounds: undefined,
  orientedBox: { unrotatedFrom: [-3, 2, 1], unrotatedTo: [2, 7, 8], pivot: [1, -2, 3],
    rotation: { axis: 'y', angle22_5Units: 2 }, cornerDenominator: 1,
    cornerNumerators: [], cornerDigest: '', faceChartDigest: '', coverProofDigest: '' } };

// Use actual viewport geometry vertices and hierarchy matrices as an independent oracle.
// Box3.setFromObject alone is insufficient: transforming a local AABB can overestimate
// a twice-rotated primitive; measure every vertex in model space instead.
for (const primitive of [cube, oriented, plane]) {
  const nodes: Record<string, SceneNode> = { root, child, [primitive.id]: primitive };
  const document = { ...createWorkbenchProject().document, scene: { roots: ['root'], nodes } };
  const scene = new THREE.Group();
  const groups = new Map<string, THREE.Group>();
  const material = new THREE.MeshStandardMaterial();
  for (const node of [root, child, primitive]) {
    const group = new THREE.Group();
    groups.set(node.id, group);
    applyNodeTransform(document, node, group);
    (node.parentId === null ? scene : groups.get(node.parentId)!).add(group);
    if (node.kind !== 'bone') addNodeGeometry(node, group, {
      materials: { resolve: () => material, ready: Promise.resolve(), dispose: () => undefined },
      textures: {}, options: { assets: {}, showSkeleton: false, showWireframe: false }, selectable: []
    });
  }
  scene.updateMatrixWorld(true);
  const expected = new THREE.Box3();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const vertices = object.geometry.getAttribute('position');
    for (let index = 0; index < vertices.count; index += 1) {
      expected.expandByPoint(new THREE.Vector3().fromBufferAttribute(vertices, index).applyMatrix4(object.matrixWorld));
    }
    object.geometry.dispose();
    for (const owned of Array.isArray(object.material) ? object.material : [object.material]) owned.dispose();
  });
  material.dispose();
  for (const [nodeId, scope] of [[primitive.id, 'node'], ['root', 'subtree']] as const) {
    const actual = measureSceneGeometry(document, { nodeId, scope, groundY: 0, tolerance: 1e-5 });
    assert.ok(actual.ok);
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Math.abs(actual.value.bounds.min[axis]! - expected.min.getComponent(axis)) < 1e-5);
      assert.ok(Math.abs(actual.value.bounds.max[axis]! - expected.max.getComponent(axis)) < 1e-5);
    }
  }
}
console.log('measurement agrees with viewport vertices under nested nonuniform transforms');
