import {
  CUBE_FACE_DIRECTIONS,
  type CubeFaceDirection,
} from '@ashfox/blockbench-contracts/types/internal';
import { isClosedContractRecord } from '@ashfox/internal-contracts';

import type {
  SessionState,
  TrackedAnimation,
  TrackedAnimationChannel,
  TrackedAnimationTrigger,
  TrackedBone,
  TrackedCube,
  TrackedCubeFace,
  TrackedMesh,
  TrackedTexture,
} from './types';

const cloneUnknownValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneUnknownValue);
  if (!isClosedContractRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneUnknownValue(entry)]),
  );
};

const cloneTriggerValue = (
  value: TrackedAnimationTrigger['keys'][number]['value'],
): TrackedAnimationTrigger['keys'][number]['value'] => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return [...value];
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneUnknownValue(entry)]),
  );
};

export const cloneTrackedBone = (bone: TrackedBone): TrackedBone => ({
  ...bone,
  pivot: [...bone.pivot],
  ...(bone.rotation ? { rotation: [...bone.rotation] } : {}),
  ...(bone.scale ? { scale: [...bone.scale] } : {}),
});

const cloneCubeFace = (face: TrackedCubeFace): TrackedCubeFace => ({
  ...face,
  ...(face.uv ? { uv: [...face.uv] } : {}),
});

const cloneCubeFaces = (faces: TrackedCube['faces']): TrackedCube['faces'] => {
  if (!faces) return undefined;
  const cloned: Partial<Record<CubeFaceDirection, TrackedCubeFace>> = {};
  for (const direction of CUBE_FACE_DIRECTIONS) {
    const face = faces[direction];
    if (face) cloned[direction] = cloneCubeFace(face);
  }
  return cloned;
};

export const cloneTrackedCube = (cube: TrackedCube): TrackedCube => ({
  ...cube,
  from: [...cube.from],
  to: [...cube.to],
  ...(cube.origin ? { origin: [...cube.origin] } : {}),
  ...(cube.rotation ? { rotation: [...cube.rotation] } : {}),
  ...(cube.uv ? { uv: [...cube.uv] } : {}),
  ...(cube.uvOffset ? { uvOffset: [...cube.uvOffset] } : {}),
  ...(cube.faces ? { faces: cloneCubeFaces(cube.faces) } : {}),
});

export const cloneTrackedMesh = (mesh: TrackedMesh): TrackedMesh => ({
  ...mesh,
  ...(mesh.origin ? { origin: [...mesh.origin] } : {}),
  ...(mesh.rotation ? { rotation: [...mesh.rotation] } : {}),
  ...(mesh.uvPolicy ? { uvPolicy: { ...mesh.uvPolicy } } : {}),
  vertices: mesh.vertices.map((vertex) => ({
    ...vertex,
    pos: [...vertex.pos],
  })),
  faces: mesh.faces.map((face) => ({
    ...face,
    vertices: [...face.vertices],
    ...(face.uv
      ? {
          uv: face.uv.map((entry) => ({
            ...entry,
            uv: [...entry.uv],
          })),
        }
      : {}),
  })),
});

export const cloneTrackedTexture = (texture: TrackedTexture): TrackedTexture => ({ ...texture });

export const cloneTrackedAnimationChannel = (
  channel: TrackedAnimationChannel,
): TrackedAnimationChannel => ({
  ...channel,
  keys: channel.keys.map((key) => ({
    ...key,
    value: [...key.value],
  })),
});

export const cloneTrackedAnimationTrigger = (
  trigger: TrackedAnimationTrigger,
): TrackedAnimationTrigger => ({
  ...trigger,
  keys: trigger.keys.map((key) => ({
    ...key,
    value: cloneTriggerValue(key.value),
  })),
});

export const cloneTrackedAnimation = (animation: TrackedAnimation): TrackedAnimation => ({
  ...animation,
  ...(animation.channels ? { channels: animation.channels.map(cloneTrackedAnimationChannel) } : {}),
  ...(animation.triggers ? { triggers: animation.triggers.map(cloneTrackedAnimationTrigger) } : {}),
});

export const cloneAnimations = (animations: readonly TrackedAnimation[]): TrackedAnimation[] =>
  animations.map(cloneTrackedAnimation);

export const cloneSessionState = (snapshot: SessionState): SessionState => ({
  ...snapshot,
  bones: snapshot.bones.map(cloneTrackedBone),
  cubes: snapshot.cubes.map(cloneTrackedCube),
  ...(snapshot.meshes ? { meshes: snapshot.meshes.map(cloneTrackedMesh) } : {}),
  textures: snapshot.textures.map(cloneTrackedTexture),
  animations: cloneAnimations(snapshot.animations),
  animationTimePolicy: { ...snapshot.animationTimePolicy },
});

export interface SessionStateCloner {
  readonly state: typeof cloneSessionState;
  readonly bone: typeof cloneTrackedBone;
  readonly cube: typeof cloneTrackedCube;
  readonly mesh: typeof cloneTrackedMesh;
  readonly texture: typeof cloneTrackedTexture;
  readonly animation: typeof cloneTrackedAnimation;
  readonly animationChannel: typeof cloneTrackedAnimationChannel;
  readonly animationTrigger: typeof cloneTrackedAnimationTrigger;
}

export const sessionStateCloner: SessionStateCloner = Object.freeze({
  state: cloneSessionState,
  bone: cloneTrackedBone,
  cube: cloneTrackedCube,
  mesh: cloneTrackedMesh,
  texture: cloneTrackedTexture,
  animation: cloneTrackedAnimation,
  animationChannel: cloneTrackedAnimationChannel,
  animationTrigger: cloneTrackedAnimationTrigger,
});
