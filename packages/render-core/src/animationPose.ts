import * as THREE from 'three';

import type { ProjectDocument, TransformChannel } from '@ashfox/engine-core';
import {
  isExpressionVariantNode,
  sampleComposedNumericTransformChannel,
  type NumericAnimationVec3,
} from '@ashfox/engine-core';

import { applyNodeTransform, localNodePosition } from './sceneTransform';
import type { ProjectSceneProjection } from './sceneTypes';

const interpolateQuatKeys = (
  keys: TransformChannel['keys'],
  timeSeconds: number,
): THREE.Quaternion => {
  if (timeSeconds <= keys[0]!.timeSeconds) return new THREE.Quaternion(...keys[0]!.quaternion!);
  const last = keys[keys.length - 1]!;
  if (timeSeconds >= last.timeSeconds) return new THREE.Quaternion(...last.quaternion!);
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (timeSeconds > b.timeSeconds) continue;
    const qa = new THREE.Quaternion(...a.quaternion!);
    if (a.interpolation === 'step' || b.timeSeconds <= a.timeSeconds) return qa;
    const qb = new THREE.Quaternion(...b.quaternion!);
    return new THREE.Quaternion().slerpQuaternions(
      qa,
      qb,
      (timeSeconds - a.timeSeconds) / (b.timeSeconds - a.timeSeconds),
    );
  }
  return new THREE.Quaternion(...last.quaternion!);
};

const sampleQuatChannel = (
  channel: TransformChannel,
  timeSeconds: number,
  restEulerDeg: NumericAnimationVec3,
): THREE.Quaternion | null => {
  const keys = channel.keys;
  if (keys.length === 0 || !keys.every((k) => k.quaternion !== undefined)) return null;
  const rel = interpolateQuatKeys(keys, timeSeconds);
  const restEuler = new THREE.Euler(
    THREE.MathUtils.degToRad(restEulerDeg[0]),
    THREE.MathUtils.degToRad(restEulerDeg[1]),
    THREE.MathUtils.degToRad(restEulerDeg[2]),
    'XYZ',
  );
  return new THREE.Quaternion().setFromEuler(restEuler).multiply(rel);
};

const applyChannelSample = (
  object: THREE.Object3D,
  property: 'position' | 'rotation' | 'scale',
  value: NumericAnimationVec3,
): void => {
  if (property === 'position') {
    object.position.fromArray(value);
  } else if (property === 'rotation') {
    object.rotation.order = 'XYZ';
    object.rotation.set(
      THREE.MathUtils.degToRad(value[0]),
      THREE.MathUtils.degToRad(value[1]),
      THREE.MathUtils.degToRad(value[2]),
    );
  } else {
    object.scale.fromArray(value);
  }
};

const restChannelValue = (
  document: ProjectDocument,
  node: ProjectDocument['scene']['nodes'][string],
  property: 'position' | 'rotation' | 'scale',
): NumericAnimationVec3 => {
  if (property === 'position') return localNodePosition(document, node);
  if (property === 'rotation') return node.transform.rotation;
  return isExpressionVariantNode(node) ? [1, 1, 1] : node.transform.scale;
};

const applyNodeClipChannel = (
  document: ProjectDocument,
  projection: ProjectSceneProjection,
  channel: TransformChannel,
  timeSeconds: number,
): void => {
  const object = projection.objectsByNodeId.get(channel.targetNodeId);
  const node = document.scene.nodes[channel.targetNodeId];
  if (!object || !node) return;
  const restValue = restChannelValue(document, node, channel.property);
  if (channel.property === 'rotation') {
    const quat = sampleQuatChannel(channel, timeSeconds, restValue);
    if (quat) {
      object.quaternion.copy(quat);
      return;
    }
  }
  const value = sampleComposedNumericTransformChannel(channel, timeSeconds, { restValue });
  if (value) applyChannelSample(object, channel.property, value);
};

export const applyAnimationPose = (
  document: ProjectDocument,
  projection: ProjectSceneProjection,
  clipId: string | null,
  timeSeconds: number,
): void => {
  for (const node of Object.values(document.scene.nodes)) {
    const object = projection.objectsByNodeId.get(node.id);
    if (object) applyNodeTransform(document, node, object);
  }
  const clip = clipId ? document.animations[clipId] : undefined;
  if (!clip) return;
  for (const channel of Object.values(clip.channels)) {
    applyNodeClipChannel(document, projection, channel, timeSeconds);
  }
};
