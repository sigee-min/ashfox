import type {
  AnimationUpdate,
  SessionState,
  TrackedAnimation,
  TrackedAnimationChannel,
  TrackedAnimationTrigger,
} from '../types';
import { mergeChannelKeys, mergeTriggerKeys } from '../../domain/animation/keyframes';
import {
  cloneTrackedAnimation,
  cloneTrackedAnimationChannel,
  cloneTrackedAnimationTrigger,
} from '../clone';

export const addAnimation = (state: SessionState, anim: TrackedAnimation) => {
  state.animations.push(cloneTrackedAnimation(anim));
};

export const updateAnimation = (
  state: SessionState,
  name: string,
  updates: AnimationUpdate,
): boolean => {
  const anim = state.animations.find((a) => a.name === name);
  if (!anim) return false;
  if (updates.id) anim.id = updates.id;
  if (updates.newName && updates.newName !== anim.name) anim.name = updates.newName;
  if (typeof updates.length === 'number') anim.length = updates.length;
  if (typeof updates.loop === 'boolean') anim.loop = updates.loop;
  if (typeof updates.fps === 'number') anim.fps = updates.fps;
  return true;
};

export const removeAnimations = (state: SessionState, names: string[] | Set<string>): number => {
  const nameSet = names instanceof Set ? names : new Set(names);
  const before = state.animations.length;
  state.animations = state.animations.filter((a) => !nameSet.has(a.name));
  return before - state.animations.length;
};

export const upsertAnimationChannel = (
  state: SessionState,
  clip: string,
  channel: TrackedAnimationChannel,
) => {
  const anim = state.animations.find((a) => a.name === clip);
  if (!anim) return;
  const clonedChannel = cloneTrackedAnimationChannel(channel);
  anim.channels ??= [];
  const existingIndex = anim.channels.findIndex(
    (ch) => ch.bone === clonedChannel.bone && ch.channel === clonedChannel.channel,
  );
  if (existingIndex >= 0) {
    const existing = anim.channels[existingIndex];
    anim.channels[existingIndex] = {
      ...existing,
      ...clonedChannel,
      keys: mergeChannelKeys(existing.keys, clonedChannel.keys, state.animationTimePolicy),
    };
  } else {
    anim.channels.push(clonedChannel);
  }
};

export const upsertAnimationTrigger = (
  state: SessionState,
  clip: string,
  trigger: TrackedAnimationTrigger,
) => {
  const anim = state.animations.find((a) => a.name === clip);
  if (!anim) return;
  const clonedTrigger = cloneTrackedAnimationTrigger(trigger);
  anim.triggers ??= [];
  const existingIndex = anim.triggers.findIndex((tr) => tr.type === clonedTrigger.type);
  if (existingIndex >= 0) {
    const existing = anim.triggers[existingIndex];
    anim.triggers[existingIndex] = {
      ...existing,
      ...clonedTrigger,
      keys: mergeTriggerKeys(existing.keys, clonedTrigger.keys, state.animationTimePolicy),
    };
  } else {
    anim.triggers.push(clonedTrigger);
  }
};
