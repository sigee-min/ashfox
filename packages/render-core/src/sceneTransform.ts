import * as THREE from 'three';

import type {
  ProjectDocument,
  SceneNode,
  Transform,
  Vec3
} from '@ashfox/engine-core';

export const subtractVectors = (
  left: Vec3,
  right: Vec3
): [number, number, number] => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2]
];

const addVectors = (
  left: Vec3,
  right: Vec3
): [number, number, number] => [
  left[0] + right[0],
  left[1] + right[1],
  left[2] + right[2]
];

const parentOrigin = (
  document: ProjectDocument,
  node: SceneNode
): [number, number, number] => {
  if (node.parentId === null) return [0, 0, 0];
  const parent = document.scene.nodes[node.parentId];
  if (!parent || parent.kind !== 'bone') return [0, 0, 0];
  return addVectors(parent.transform.pivot, parent.transform.position);
};

export const localNodePosition = (
  document: ProjectDocument,
  node: SceneNode,
  position: Vec3 = node.transform.position
): [number, number, number] => {
  if (node.kind === 'locator') {
    return [position[0], position[1], position[2]];
  }
  return subtractVectors(
    addVectors(node.transform.pivot, position),
    parentOrigin(document, node)
  );
};

export const applyNodeTransform = (
  document: ProjectDocument,
  node: SceneNode,
  object: THREE.Object3D,
  transform: Transform = node.transform
): void => {
  object.position.fromArray(
    localNodePosition(document, node, transform.position)
  );
  object.rotation.order = 'XYZ';
  object.rotation.set(
    THREE.MathUtils.degToRad(transform.rotation[0]),
    THREE.MathUtils.degToRad(transform.rotation[1]),
    THREE.MathUtils.degToRad(transform.rotation[2])
  );
  object.scale.fromArray(transform.scale);
};
