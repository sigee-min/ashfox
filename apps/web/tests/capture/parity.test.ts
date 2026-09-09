import assert from 'node:assert/strict';

import * as THREE from 'three';

import {
  sampleComposedNumericTransformChannel,
  type TransformChannel
} from '@ashfox/engine-core';

import {
  applyAnimationPose
} from '@ashfox/render-core/animationPose';
import {
  createBuildCapturePlan
} from '@ashfox/render-core/capture/buildCaptureTimeline';
import {
  applyBuildCaptureFrame
} from '@ashfox/render-core/capture/renderBuildGif';
import {
  createWorkbenchProject
} from '../fixtures/project';

const assertArrayClose = (
  actual: readonly number[],
  expected: readonly number[],
  message: string
): void => {
  assert.equal(actual.length, expected.length, message);
  expected.forEach((value, index) => {
    assert.ok(
      Math.abs((actual[index] ?? Number.NaN) - value) < 0.000001,
      `${message}: component ${index}`
    );
  });
};

const document = structuredClone(createWorkbenchProject().document);
const nodeId = document.scene.roots[0];
const node = document.scene.nodes[nodeId];
node.transform = {
  position: [4, 8, 12],
  rotation: [10, 20, 30],
  scale: [2, 3, 4],
  pivot: [0, 0, 0]
};
const animationValues = {
  position: [1, 2, 3],
  rotation: [4, 5, 6],
  scale: [1.5, 0.5, 2]
} as const;
const createChannel = (
  property: TransformChannel['property']
): TransformChannel => ({
  id: `channel-preview-${property}`,
  targetNodeId: nodeId,
  property,
  keys: [{
    id: `key-preview-${property}`,
    timeSeconds: 0,
    value: animationValues[property],
    interpolation: 'linear'
  }]
});
const channels = {
  'channel-preview-position': createChannel('position'),
  'channel-preview-rotation': createChannel('rotation'),
  'channel-preview-scale': createChannel('scale')
};
document.animations = {
  idle: {
    id: 'idle',
    name: 'idle',
    durationSeconds: 1,
    fps: 20,
    loop: 'loop',
    channels,
    triggers: {}
  }
};

const object = new THREE.Group();
applyAnimationPose(
  document,
  {
    documentReference: document,
    root: new THREE.Group(),
    objectsByNodeId: new Map([[nodeId, object]]),
    selectable: [],
    readiness: {
      status: 'ready',
      error: null
    },
    ready: Promise.resolve(),
    dispose: () => undefined
  },
  'idle',
  0
);

assertArrayClose(
  object.position.toArray(),
  [5, 10, 15],
  'viewport translation must add animation to the non-identity rest pose'
);
assertArrayClose(
  object.scale.toArray(),
  [3, 1.5, 8],
  'viewport scale must multiply the non-identity rest pose'
);
const composedRotation =
  sampleComposedNumericTransformChannel(
    channels['channel-preview-rotation'],
    0,
    { restValue: [10, 20, 30] }
  );
if (!composedRotation) {
  throw new Error('Expected composed viewport rotation.');
}
assertArrayClose(
  [
    THREE.MathUtils.radToDeg(object.rotation.x),
    THREE.MathUtils.radToDeg(object.rotation.y),
    THREE.MathUtils.radToDeg(object.rotation.z)
  ],
  composedRotation,
  'viewport must consume the engine rest-rotation authority'
);

const projection = (
  target: THREE.Group
) => ({
  documentReference: document,
  root: new THREE.Group(),
  objectsByNodeId: new Map([[nodeId, target]]),
  selectable: [],
  readiness: { status: 'ready' as const, error: null },
  ready: Promise.resolve(),
  dispose: () => undefined
});
const replayNeutral = projection(new THREE.Group());
const replayTarget = new THREE.Group();
const replayTextured = projection(replayTarget);
applyAnimationPose(document, replayTextured, null, 0);
const buildPlan = createBuildCapturePlan(document);
const finalMotionFrame = [...buildPlan.frames].reverse().find(
  (frame) => frame.event.category === 'motion'
);
const completeFrame = buildPlan.frames.find(
  (frame) => frame.event.category === 'complete'
);
if (!finalMotionFrame || !completeFrame) {
  throw new Error('Build fixture requires motion and complete frames.');
}
applyBuildCaptureFrame(
  finalMotionFrame,
  document,
  replayNeutral,
  replayTextured
);
assertArrayClose(
  replayTarget.position.toArray(),
  [5, 10, 15],
  'every motion hold frame must advance the authored pose'
);
applyBuildCaptureFrame(
  completeFrame,
  document,
  replayNeutral,
  replayTextured
);
assertArrayClose(
  replayTarget.position.toArray(),
  [4, 8, 12],
  'the complete hold must restore the canonical rest pose'
);
assertArrayClose(
  replayTarget.scale.toArray(),
  [2, 3, 4],
  'the complete hold must restore the canonical rest scale'
);

const texturedNodeId = Object.values(document.scene.nodes).find((candidate) =>
  (candidate.kind === 'cube' || candidate.kind === 'plane') &&
  Object.values(candidate.faces).some(
    (face) => face.enabled && face.textureId !== null
  )
)?.id;
if (!texturedNodeId) {
  throw new Error('Build fixture requires textured geometry.');
}
const geometryFrame = buildPlan.frames.find(
  (frame) =>
    frame.event.category === 'geometry' &&
    frame.event.nodeId === texturedNodeId
);
const textureFrame = buildPlan.frames.find(
  (frame) =>
    frame.event.category === 'texture' &&
    frame.event.nodeId === texturedNodeId
);
if (!geometryFrame || !textureFrame) {
  throw new Error('Build fixture requires geometry and texture steps.');
}
const neutralElement = new THREE.Group();
const texturedElement = new THREE.Group();
neutralElement.visible = false;
texturedElement.visible = false;
const elementNeutral = {
  ...projection(new THREE.Group()),
  objectsByNodeId: new Map([[texturedNodeId, neutralElement]])
};
const elementTextured = {
  ...projection(new THREE.Group()),
  objectsByNodeId: new Map([[texturedNodeId, texturedElement]])
};
applyBuildCaptureFrame(
  geometryFrame,
  document,
  elementNeutral,
  elementTextured
);
assert.equal(neutralElement.visible, true);
assert.equal(texturedElement.visible, false);
applyBuildCaptureFrame(
  textureFrame,
  document,
  elementNeutral,
  elementTextured
);
assert.equal(neutralElement.visible, false);
assert.equal(
  texturedElement.visible,
  true,
  'one texture event must atomically replace the neutral element'
);
