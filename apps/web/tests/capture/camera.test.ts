import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  projectSignedViewFrame
} from '@ashfox/engine-core';

import {
  frameCaptureObject,
  type CaptureSurface
} from '@ashfox/render-core/captureSurface';

const axis = (values: readonly number[]): readonly number[] =>
  values.map((value) => {
    const rounded = Math.round(value);
    return rounded === 0 ? 0 : rounded;
  });

const surface = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 300),
  forward: 'east',
  signedView: 'left'
} as unknown as CaptureSurface;
const object = new THREE.Mesh(new THREE.BoxGeometry(14, 17, 21));

frameCaptureObject(surface, 'perspective', object);

const actualDepth = surface.camera.position
  .clone()
  .sub(new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()))
  .normalize();
assert.deepEqual(
  axis(actualDepth.toArray()),
  axis(projectSignedViewFrame('east', 'left').depth),
  'a signed capture surface must retain its exact proof depth while framing'
);

object.geometry.dispose();
console.log('signed capture framing uses the proof view');
