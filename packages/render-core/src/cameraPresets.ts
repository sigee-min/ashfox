import * as THREE from 'three';

import {
  projectSignedViewFrame,
  type ProjectAxisVector,
  type ProjectForwardDirection,
  type ProjectSignedView
} from '@ashfox/engine-core';

export type CameraMode =
  | 'perspective'
  | 'native'
  | 'front'
  | 'left'
  | 'right'
  | 'top';

const CAMERA_TARGET = new THREE.Vector3(0, 16, 0);
const CAMERA_PADDING = 1.18;
/** `native` is gameplay framing; capture pixel dimensions stay independent. */
const NATIVE_GAMEPLAY_PADDING = 2.35;

type UnsignedCameraMode = Extract<CameraMode, 'perspective' | 'native'>;

const cameraDirection = (): THREE.Vector3 =>
  new THREE.Vector3(41, 13, -52).normalize();

const frameDimensions = (
  mode: UnsignedCameraMode,
  size: THREE.Vector3
): readonly [number, number, number] => {
  switch (mode) {
    case 'perspective':
    case 'native':
      return [size.x, size.y, size.z];
  }
};

const objectFrame = (
  camera: THREE.PerspectiveCamera,
  mode: UnsignedCameraMode,
  object: THREE.Object3D | undefined
): { target: THREE.Vector3; distance: number } | null => {
  if (!object) return null;
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return null;

  const target = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const [width, height, depth] = frameDimensions(mode, size);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(
    Math.tan(verticalFov / 2) * camera.aspect
  );
  const widthDistance = width / 2 / Math.tan(horizontalFov / 2);
  const heightDistance = height / 2 / Math.tan(verticalFov / 2);
  const distance = Math.max(
    12,
    (Math.max(widthDistance, heightDistance) + depth / 2) *
      (mode === 'native' ? NATIVE_GAMEPLAY_PADDING : CAMERA_PADDING)
  );
  return { target, distance };
};

const spanAlong = (
  size: THREE.Vector3,
  axis: ProjectAxisVector
): number => Math.abs(axis[0]) * size.x + Math.abs(axis[1]) * size.y +
  Math.abs(axis[2]) * size.z;

const signedObjectFrame = (
  camera: THREE.PerspectiveCamera,
  view: ProjectSignedView,
  object: THREE.Object3D | undefined,
  forward: ProjectForwardDirection
): { target: THREE.Vector3; distance: number } | null => {
  if (!object) return null;
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return null;
  const target = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const axes = projectSignedViewFrame(forward, view);
  const width = spanAlong(size, axes.inline);
  const height = spanAlong(size, axes.cross);
  const depth = spanAlong(size, axes.depth);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(
    Math.tan(verticalFov / 2) * camera.aspect
  );
  const widthDistance = width / 2 / Math.tan(horizontalFov / 2);
  const heightDistance = height / 2 / Math.tan(verticalFov / 2);
  return { target, distance: Math.max(12,
    (Math.max(widthDistance, heightDistance) + depth / 2) * CAMERA_PADDING) };
};

export const applyCameraPreset = (
  camera: THREE.PerspectiveCamera,
  mode: CameraMode,
  object?: THREE.Object3D,
  forward: ProjectForwardDirection = 'north'
): THREE.Vector3 => {
  const signedView = mode === 'front'
    ? 'front'
    : mode === 'left'
      ? 'left'
      : mode === 'right'
        ? 'right'
        : mode === 'top'
          ? 'up'
          : null;
  if (signedView !== null) {
    return applySignedProjectViewPreset(
      camera,
      signedView,
      object,
      forward
    );
  }
  if (mode !== 'perspective' && mode !== 'native') {
    throw new Error(`Unsupported camera mode: ${mode}`);
  }
  const frame = objectFrame(camera, mode, object);
  const target = frame?.target ?? CAMERA_TARGET;
  camera.up.set(0, 1, 0);
  const direction = cameraDirection();
  const distance = frame?.distance ?? direction.length() * 68;
  camera.position.copy(target).add(
    direction.multiplyScalar(distance)
  );
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return target.clone();
};

/**
 * Applies one exact signed semantic view using the shared project frame.
 */
export const applySignedProjectViewPreset = (
  camera: THREE.PerspectiveCamera,
  view: ProjectSignedView,
  object?: THREE.Object3D,
  forward: ProjectForwardDirection = 'north'
): THREE.Vector3 => {
  const axes = projectSignedViewFrame(forward, view);
  const frame = signedObjectFrame(camera, view, object, forward);
  const target = frame?.target ?? CAMERA_TARGET;
  camera.up.set(...axes.cross);
  const direction = new THREE.Vector3(...axes.depth);
  const distance = frame?.distance ?? direction.length() * 68;
  camera.position.copy(target).add(direction.multiplyScalar(distance));
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return target.clone();
};
