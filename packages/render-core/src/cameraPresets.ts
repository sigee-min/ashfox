import * as THREE from 'three';

import {
  projectSignedViewFrame,
  type ProjectAxisVector,
  type ProjectForwardDirection,
  type ProjectSignedView,
} from '@ashfox/engine-core';

export type CameraMode = 'perspective' | 'native' | 'front' | 'left' | 'right' | 'top';

const CAMERA_TARGET = new THREE.Vector3(0, 16, 0);
const CAMERA_PADDING = 1.18;
/** `native` is gameplay framing; capture pixel dimensions stay independent. */
const NATIVE_GAMEPLAY_PADDING = 2.35;

type UnsignedCameraMode = Extract<CameraMode, 'perspective' | 'native'>;

const cameraDirection = (): THREE.Vector3 => new THREE.Vector3(41, 13, -52).normalize();

const frameDimensions = (
  mode: UnsignedCameraMode,
  size: THREE.Vector3,
): readonly [number, number, number] => {
  switch (mode) {
    case 'perspective':
    case 'native':
      return [size.x, size.y, size.z];
  }
};

const computeFrameDistance = (
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  depth: number,
  padding: number,
): number => {
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const widthDistance = width / 2 / Math.tan(horizontalFov / 2);
  const heightDistance = height / 2 / Math.tan(verticalFov / 2);
  return Math.max(12, (Math.max(widthDistance, heightDistance) + depth / 2) * padding);
};

const BOX_CORNER_SIGNS: readonly [number, number, number][] = [
  [-1, -1, -1],
  [1, -1, -1],
  [-1, 1, -1],
  [1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [-1, 1, 1],
  [1, 1, 1],
];

const computeCornerFrameDistance = (
  camera: THREE.PerspectiveCamera,
  size: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  dir: THREE.Vector3,
  padding: number,
): number => {
  const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const tanHalfH = tanHalfV * camera.aspect;
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  let minDistance = 0;
  for (const [cx, cy, cz] of BOX_CORNER_SIGNS) {
    const sx = cx * hx;
    const sy = cy * hy;
    const sz = cz * hz;
    const rx = sx * right.x + sy * right.y + sz * right.z;
    const ry = sx * up.x + sy * up.y + sz * up.z;
    const rz = sx * dir.x + sy * dir.y + sz * dir.z;
    minDistance = Math.max(
      minDistance,
      rz + Math.max(Math.abs(rx) / tanHalfH, Math.abs(ry) / tanHalfV),
    );
  }
  return Math.max(4, minDistance * 1.15 * padding);
};

const resolveSubjectBounds = (
  subject: THREE.Object3D | THREE.Box3 | undefined,
): THREE.Box3 | null => {
  if (!subject) return null;
  if (subject instanceof THREE.Box3) return subject;
  subject.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(subject);
  return bounds.isEmpty() ? null : bounds;
};

const objectFrame = (
  camera: THREE.PerspectiveCamera,
  mode: UnsignedCameraMode,
  subject: THREE.Object3D | THREE.Box3 | undefined,
): { target: THREE.Vector3; distance: number } | null => {
  const bounds = resolveSubjectBounds(subject);
  if (!bounds) return null;

  const target = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const [width, height, depth] = frameDimensions(mode, size);
  const padding = mode === 'native' ? NATIVE_GAMEPLAY_PADDING : CAMERA_PADDING;
  return { target, distance: computeFrameDistance(camera, width, height, depth, padding) };
};

const spanAlong = (size: THREE.Vector3, axis: ProjectAxisVector): number =>
  Math.abs(axis[0]) * size.x + Math.abs(axis[1]) * size.y + Math.abs(axis[2]) * size.z;

const signedObjectFrame = (
  camera: THREE.PerspectiveCamera,
  view: ProjectSignedView,
  subject: THREE.Object3D | THREE.Box3 | undefined,
  forward: ProjectForwardDirection,
): { target: THREE.Vector3; distance: number } | null => {
  const bounds = resolveSubjectBounds(subject);
  if (!bounds) return null;
  const target = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const axes = projectSignedViewFrame(forward, view);
  const width = spanAlong(size, axes.inline);
  const height = spanAlong(size, axes.cross);
  const depth = spanAlong(size, axes.depth);
  return { target, distance: computeFrameDistance(camera, width, height, depth, CAMERA_PADDING) };
};

export const applyCameraPreset = (
  camera: THREE.PerspectiveCamera,
  mode: CameraMode,
  object?: THREE.Object3D | THREE.Box3,
  forward: ProjectForwardDirection = 'north',
): THREE.Vector3 => {
  const signedView =
    mode === 'front'
      ? 'front'
      : mode === 'left'
        ? 'left'
        : mode === 'right'
          ? 'right'
          : mode === 'top'
            ? 'up'
            : null;
  if (signedView !== null) {
    return applySignedProjectViewPreset(camera, signedView, object, forward);
  }
  if (mode !== 'perspective' && mode !== 'native') {
    throw new Error(`Unsupported camera mode: ${mode}`);
  }
  const frame = objectFrame(camera, mode, object);
  const target = frame?.target ?? CAMERA_TARGET;
  camera.up.set(0, 1, 0);
  const direction = cameraDirection();
  const distance = frame?.distance ?? direction.length() * 68;
  camera.far = Math.max(camera.far, Math.ceil(distance * 4));
  camera.position.copy(target).add(direction.multiplyScalar(distance));
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
  object?: THREE.Object3D | THREE.Box3,
  forward: ProjectForwardDirection = 'north',
): THREE.Vector3 => {
  const axes = projectSignedViewFrame(forward, view);
  const frame = signedObjectFrame(camera, view, object, forward);
  const target = frame?.target ?? CAMERA_TARGET;
  camera.up.set(...axes.cross);
  const direction = new THREE.Vector3(...axes.depth);
  const distance = frame?.distance ?? direction.length() * 68;
  camera.far = Math.max(camera.far, Math.ceil(distance * 4));
  camera.position.copy(target).add(direction.multiplyScalar(distance));
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return target.clone();
};

/** Frames an arbitrary world-space Box3 at explicit orbit angles and FOV. */
export const frameBoxAtAngles = (
  camera: THREE.PerspectiveCamera,
  bounds: THREE.Box3,
  azimuthDeg: number,
  elevationDeg: number,
  zoom = 1,
  fov = 42,
  padding = CAMERA_PADDING,
): THREE.Vector3 => {
  const target = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const a = THREE.MathUtils.degToRad(azimuthDeg);
  const e = THREE.MathUtils.degToRad(elevationDeg);
  const dir = new THREE.Vector3(
    Math.sin(a) * Math.cos(e),
    Math.sin(e),
    -Math.cos(a) * Math.cos(e),
  ).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  camera.fov = fov;
  camera.up.set(0, 1, 0);
  const distance = computeCornerFrameDistance(camera, size, right, up, dir, padding) / zoom;
  camera.near = 0.1;
  camera.far = Math.max(camera.far, Math.ceil(distance * 4), 256);
  camera.position.copy(target).add(dir.multiplyScalar(distance));
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return target;
};

/** Places the camera at eye level inside a room looking toward a focal target. */
export const applyEyeLevelCamera = (
  camera: THREE.PerspectiveCamera,
  eye: readonly [number, number, number],
  lookAt: readonly [number, number, number],
  fov = 65,
): void => {
  camera.fov = fov;
  camera.near = 0.08;
  camera.far = 160;
  camera.up.set(0, 1, 0);
  camera.position.set(eye[0], eye[1], eye[2]);
  camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
  camera.updateProjectionMatrix();
};
