import * as THREE from 'three';

import type {
  ProjectDocument
} from '@ashfox/engine-core';
import {
  sampleComposedNumericTransformChannel,
  type NumericAnimationVec3
} from '@ashfox/engine-core';

import {
  applyNodeTransform,
  localNodePosition
} from './sceneTransform';
import type { ProjectSceneProjection } from './sceneTypes';

export const applyAnimationPose = (
  document: ProjectDocument,
  projection: ProjectSceneProjection,
  clipId: string | null,
  timeSeconds: number
): void => {
  for (const node of Object.values(document.scene.nodes)) {
    const object = projection.objectsByNodeId.get(node.id);
    if (object) applyNodeTransform(document, node, object);
  }

  if (!clipId) return;
  const clip = document.animations[clipId];
  if (!clip) return;

  for (const channel of Object.values(clip.channels)) {
    const object = projection.objectsByNodeId.get(channel.targetNodeId);
    const node = document.scene.nodes[channel.targetNodeId];
    if (!object || !node) continue;

    const restValue: NumericAnimationVec3 =
      channel.property === 'position'
        ? localNodePosition(document, node)
        : channel.property === 'rotation'
          ? node.transform.rotation
          : node.transform.scale;
    const value = sampleComposedNumericTransformChannel(
      channel,
      timeSeconds,
      { restValue }
    );
    if (!value) continue;
    if (channel.property === 'position') {
      object.position.fromArray(value);
    } else if (channel.property === 'rotation') {
      object.rotation.order = 'XYZ';
      object.rotation.set(
        THREE.MathUtils.degToRad(value[0]),
        THREE.MathUtils.degToRad(value[1]),
        THREE.MathUtils.degToRad(value[2])
      );
    } else {
      object.scale.fromArray(value);
    }
  }
};
