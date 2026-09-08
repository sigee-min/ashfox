import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  applyCameraPreset,
  applySignedProjectViewPreset
} from '../../src/rendering/cameraPresets';
import {
  PROJECT_SIGNED_VIEWS,
  projectSignedViewFrame,
  type ProjectForwardDirection
} from '@ashfox/engine-core';

const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 300);
const canonicalAxis = (values: readonly number[]): readonly number[] =>
  values.map((value) => {
    const rounded = Math.round(value);
    return rounded === 0 ? 0 : rounded;
  });
const compactModel = new THREE.Mesh(
  new THREE.BoxGeometry(14, 17, 21)
);
const compactTarget = applyCameraPreset(
  camera,
  'perspective',
  compactModel
);
const compactDistance = camera.position.distanceTo(compactTarget);

const tallModel = new THREE.Mesh(
  new THREE.BoxGeometry(14, 40, 14)
);
const tallTarget = applyCameraPreset(
  camera,
  'perspective',
  tallModel
);
const tallDistance = camera.position.distanceTo(tallTarget);

const nativeTarget = applyCameraPreset(
  camera,
  'native',
  compactModel
);
const nativeDistance = camera.position.distanceTo(nativeTarget);
assert.ok(
  nativeDistance > compactDistance,
  'native is a gameplay framing preset, independent of capture resolution'
);

assert.ok(
  compactDistance < tallDistance,
  'compact assets should be framed closer than tall assets'
);

for (const forward of ['north', 'south', 'east', 'west'] as const satisfies
  readonly ProjectForwardDirection[]) for (const view of PROJECT_SIGNED_VIEWS) {
  const target = applySignedProjectViewPreset(
    camera, view, compactModel, forward
  );
  const actualDepth = camera.position.clone().sub(target).normalize();
  const expected = projectSignedViewFrame(forward, view);
  const actualInline = new THREE.Vector3(1, 0, 0)
    .applyQuaternion(camera.quaternion).normalize();
  const actualCross = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(camera.quaternion).normalize();
  assert.deepEqual(
    canonicalAxis(actualDepth.toArray()),
    canonicalAxis(expected.depth),
    `${forward}/${view} capture must use the exact proof depth axis`
  );
  assert.deepEqual(canonicalAxis(camera.up.toArray()),
    canonicalAxis(expected.cross),
    `${forward}/${view} capture must preserve the signed proof cross axis`);
  assert.deepEqual(canonicalAxis(actualInline.toArray()),
    canonicalAxis(expected.inline),
    `${forward}/${view} screen right must equal the proof inline axis`);
  assert.deepEqual(canonicalAxis(actualCross.toArray()),
    canonicalAxis(expected.cross),
    `${forward}/${view} screen up must equal the proof cross axis`);
}

const eastLeftTarget = applySignedProjectViewPreset(
  camera, 'left', compactModel, 'east'
);
const eastLeftDirection = camera.position.clone().sub(eastLeftTarget).normalize();
assert.ok(eastLeftDirection.z < -0.999,
  'authored left must not collapse to the legacy east-facing +Z side camera');
assert.ok(
  compactDistance < 50,
  'tractor-sized assets should fill more of the viewport'
);

const eastRightTarget = applyCameraPreset(
  camera,
  'right',
  compactModel,
  'east'
);
const eastRightDirection = camera.position.clone().sub(eastRightTarget).normalize();
assert.ok(
  Math.abs(eastRightDirection.x) < 1e-6 && eastRightDirection.z > 0.999,
  'right view must remain side-relative when the semantic forward axis is east'
);

for (const forward of ['north', 'south', 'east', 'west'] as const) {
  for (const view of ['left', 'right'] as const) {
    const target = applyCameraPreset(camera, view, compactModel, forward);
    const actualDepth = camera.position.clone().sub(target).normalize();
    assert.deepEqual(
      canonicalAxis(actualDepth.toArray()),
      canonicalAxis(projectSignedViewFrame(forward, view).depth),
      `${forward}/${view} UI camera must use the exact proof depth axis`
    );
  }
}

compactModel.geometry.dispose();
tallModel.geometry.dispose();
