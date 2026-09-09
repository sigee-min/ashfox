import * as THREE from 'three';

import type { ProjectDocument } from '@ashfox/engine-core';

import { addNodeGeometry } from './sceneGeometry';
import {
  createProjectMaterials,
  disposeMaterial
} from './sceneMaterials';
import { applyNodeTransform } from './sceneTransform';
import type {
  ProjectSceneOptions,
  ProjectSceneProjection
} from './sceneTypes';

const disposeObject = (object: THREE.Object3D): void => {
  const mesh = object as THREE.Mesh;
  mesh.geometry?.dispose();
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : mesh.material
      ? [mesh.material]
      : [];
  if (object.userData.ownsMaterial) {
    for (const material of materials) material.dispose();
    return;
  }
  if (!object.userData.overlay) return;
  for (const material of materials) disposeMaterial(material);
};

const orderedSceneNodes = (document: ProjectDocument) =>
  Object.values(document.scene.nodes).sort((left, right) =>
    left.id.localeCompare(right.id)
  );

/** Project-to-Three projection boundary owned by the renderer. */
export const projectToThreeScene = (
  document: ProjectDocument,
  options: ProjectSceneOptions
): ProjectSceneProjection => {
  const root = new THREE.Group();
  root.name = 'ashfoxProjectScene';
  const objectsByNodeId = new Map<string, THREE.Group>();
  const selectable: THREE.Object3D[] = [];
  const materials = createProjectMaterials(
    document,
    options.assets,
    options.untexturedColor,
    options.showTextures !== false
  );
  const readiness: ProjectSceneProjection['readiness'] = {
    status: 'pending',
    error: null
  };
  const ready = materials.ready.then(() => {
    readiness.status = 'ready';
  }).catch((error: unknown) => {
    readiness.status = 'failed';
    readiness.error =
      error instanceof Error ? error.message : String(error);
  });
  const orderedNodes = orderedSceneNodes(document);

  for (const node of orderedNodes) {
    const group = new THREE.Group();
    group.name = node.name;
    group.visible = node.visible;
    group.userData.nodeId = node.id;
    group.userData.kind = node.kind;
    // PlaneNode basis is the signed chart authority. Its retired Euler
    // rotation is retained for Bedrock lowering only; applying both here
    // would rotate the basis a second time and mirror east/west patches.
    const webTransform = node.kind === 'plane' && node.basis
      ? { ...node.transform, rotation: [0, 0, 0] as const }
      : node.transform;
    applyNodeTransform(document, node, group, webTransform);
    objectsByNodeId.set(node.id, group);
    addNodeGeometry(node, group, {
      materials,
      textures: document.textures,
      options,
      selectable
    });
  }

  for (const node of orderedNodes) {
    const group = objectsByNodeId.get(node.id);
    if (!group) continue;
    const parent =
      node.parentId === null ? root : objectsByNodeId.get(node.parentId);
    (parent ?? root).add(group);
  }

  return {
    documentReference: document,
    root,
    objectsByNodeId,
    selectable,
    readiness,
    ready,
    dispose: () => {
      root.traverse(disposeObject);
      materials.dispose();
    }
  };
};
