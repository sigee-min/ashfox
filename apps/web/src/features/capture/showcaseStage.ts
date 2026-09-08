import * as THREE from 'three';
import type { ProjectDocument } from '@ashfox/engine-core';
import { applyAnimationPose } from '../../rendering/animationPose';
import type { ProjectSceneProjection } from '../../rendering/sceneTypes';
import { frameCaptureObject, type CaptureSurface } from './captureSurface';

/** Frame every authored pose once, and place a shadow receiver at the rest feet. */
export const stageShowcase = (
  document: ProjectDocument,
  projection: ProjectSceneProjection,
  surface: CaptureSurface
): (() => void) => {
  applyAnimationPose(document, projection, null, 0);
  projection.root.updateMatrixWorld(true);
  const rest = new THREE.Box3().setFromObject(projection.root);
  const bounds = rest.clone();
  const corners: THREE.Vector3[] = [];
  const rememberPose = () => projection.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox;
    if (!box) return;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      corners.push(new THREE.Vector3(x, y, z).applyMatrix4(object.matrixWorld));
    }
  });
  rememberPose();
  for (const motion of Object.values(document.animations)) {
    for (let sample = 0; sample <= 48; sample += 1) {
      applyAnimationPose(document, projection, motion.id, motion.durationSeconds * sample / 48);
      projection.root.updateMatrixWorld(true);
      bounds.union(new THREE.Box3().setFromObject(projection.root));
      rememberPose();
    }
  }
  applyAnimationPose(document, projection, null, 0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(...bounds.getSize(new THREE.Vector3()).toArray()));
  frame.position.copy(bounds.getCenter(new THREE.Vector3()));
  frameCaptureObject(surface, 'perspective', frame);
  const target = bounds.getCenter(new THREE.Vector3());
  for (let attempt = 0; attempt < 60; attempt += 1) {
    surface.camera.updateMatrixWorld(true);
    if (corners.every((corner) => {
      const point = corner.clone().project(surface.camera);
      return Math.abs(point.x) <= 0.92 && Math.abs(point.y) <= 0.92;
    })) break;
    surface.camera.position.sub(target).multiplyScalar(1.04).add(target);
    surface.camera.lookAt(target);
  }
  frame.geometry.dispose();
  (frame.material as THREE.Material).dispose();
  const size = bounds.getSize(new THREE.Vector3());
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(size.x, size.z) * 6, Math.max(size.x, size.z) * 6), new THREE.ShadowMaterial({ opacity: 0.32 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(rest.getCenter(new THREE.Vector3()).x, rest.min.y - 0.015, rest.getCenter(new THREE.Vector3()).z);
  floor.receiveShadow = true;
  surface.scene.add(floor);
  return () => {
    surface.scene.remove(floor);
    floor.geometry.dispose();
    floor.material.dispose();
  };
};
