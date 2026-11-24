import type {
  SessionState,
  TrackedAnimation,
  TrackedAnimationChannel,
  TrackedAnimationTrigger,
  TrackedBone,
  TrackedCube,
  TrackedMesh,
  TrackedTexture,
} from './types';
import type { AnimationUpdate, BoneUpdate, CubeUpdate, MeshUpdate, TextureUpdate } from './types';
import {
  addAnimation,
  addBone,
  addCube,
  addMesh,
  addTexture,
  removeAnimations,
  removeBones,
  removeCubes,
  removeMeshes,
  removeTextures,
  updateAnimation,
  updateBone,
  updateCube,
  updateMesh,
  updateTexture,
  upsertAnimationChannel,
  upsertAnimationTrigger,
} from './mutators';

export type SessionMutation =
  | { type: 'add_bone'; bone: TrackedBone }
  | { type: 'update_bone'; name: string; updates: BoneUpdate }
  | { type: 'remove_bones'; names: string[] | Set<string> }
  | { type: 'add_cube'; cube: TrackedCube }
  | { type: 'update_cube'; name: string; updates: CubeUpdate }
  | { type: 'remove_cubes'; names: string[] | Set<string> }
  | { type: 'add_mesh'; mesh: TrackedMesh }
  | { type: 'update_mesh'; name: string; updates: MeshUpdate }
  | { type: 'remove_meshes'; names: string[] | Set<string> }
  | { type: 'add_texture'; texture: TrackedTexture }
  | { type: 'update_texture'; name: string; updates: TextureUpdate }
  | { type: 'remove_textures'; names: string[] | Set<string> }
  | { type: 'add_animation'; animation: TrackedAnimation }
  | { type: 'update_animation'; name: string; updates: AnimationUpdate }
  | { type: 'remove_animations'; names: string[] | Set<string> }
  | { type: 'upsert_animation_channel'; clip: string; channel: TrackedAnimationChannel }
  | { type: 'upsert_animation_trigger'; clip: string; trigger: TrackedAnimationTrigger };

type MutationOf<TType extends SessionMutation['type']> = Extract<SessionMutation, { type: TType }>;
type RemovalResult = { removedBones: number; removedCubes: number };
type SessionMutationResult = boolean | number | RemovalResult | void;

export function applySessionMutation(state: SessionState, mutation: MutationOf<'add_bone'>): void;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'update_bone'>,
): boolean;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'remove_bones'>,
): RemovalResult;
export function applySessionMutation(state: SessionState, mutation: MutationOf<'add_cube'>): void;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'update_cube'>,
): boolean;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'remove_cubes'>,
): number;
export function applySessionMutation(state: SessionState, mutation: MutationOf<'add_mesh'>): void;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'update_mesh'>,
): boolean;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'remove_meshes'>,
): number;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'add_texture'>,
): void;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'update_texture'>,
): boolean;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'remove_textures'>,
): number;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'add_animation'>,
): void;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'update_animation'>,
): boolean;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'remove_animations'>,
): number;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'upsert_animation_channel'>,
): void;
export function applySessionMutation(
  state: SessionState,
  mutation: MutationOf<'upsert_animation_trigger'>,
): void;
export function applySessionMutation(
  state: SessionState,
  mutation: SessionMutation,
): SessionMutationResult;
export function applySessionMutation(
  state: SessionState,
  mutation: SessionMutation,
): SessionMutationResult {
  switch (mutation.type) {
    case 'add_bone':
      addBone(state, mutation.bone);
      return;
    case 'update_bone':
      return updateBone(state, mutation.name, mutation.updates);
    case 'remove_bones':
      return removeBones(state, mutation.names);
    case 'add_cube':
      addCube(state, mutation.cube);
      return;
    case 'update_cube':
      return updateCube(state, mutation.name, mutation.updates);
    case 'remove_cubes':
      return removeCubes(state, mutation.names);
    case 'add_mesh':
      addMesh(state, mutation.mesh);
      return;
    case 'update_mesh':
      return updateMesh(state, mutation.name, mutation.updates);
    case 'remove_meshes':
      return removeMeshes(state, mutation.names);
    case 'add_texture':
      addTexture(state, mutation.texture);
      return;
    case 'update_texture':
      return updateTexture(state, mutation.name, mutation.updates);
    case 'remove_textures':
      return removeTextures(state, mutation.names);
    case 'add_animation':
      addAnimation(state, mutation.animation);
      return;
    case 'update_animation':
      return updateAnimation(state, mutation.name, mutation.updates);
    case 'remove_animations':
      return removeAnimations(state, mutation.names);
    case 'upsert_animation_channel':
      upsertAnimationChannel(state, mutation.clip, mutation.channel);
      return;
    case 'upsert_animation_trigger':
      upsertAnimationTrigger(state, mutation.clip, mutation.trigger);
      return;
    default:
      return;
  }
}
