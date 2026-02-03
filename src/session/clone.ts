import type {
  FacePaintIntent,
  ProjectMeta,
  TrackedAnimation,
  TrackedAnimationChannel,
  TrackedAnimationTrigger
} from './types';

const cloneAnimationChannel = (channel: TrackedAnimationChannel): TrackedAnimationChannel => ({
  ...channel,
  keys: [...channel.keys]
});

const cloneAnimationTrigger = (trigger: TrackedAnimationTrigger): TrackedAnimationTrigger => ({
  ...trigger,
  keys: [...trigger.keys]
});

const cloneAnimation = (anim: TrackedAnimation): TrackedAnimation => ({
  ...anim,
  channels: anim.channels ? anim.channels.map(cloneAnimationChannel) : undefined,
  triggers: anim.triggers ? anim.triggers.map(cloneAnimationTrigger) : undefined
});

export const cloneAnimations = (animations: TrackedAnimation[]): TrackedAnimation[] => animations.map(cloneAnimation);

const cloneFacePaintIntent = (intent: FacePaintIntent): FacePaintIntent => ({
  material: intent.material,
  palette: intent.palette ? [...intent.palette] : undefined,
  seed: intent.seed,
  cubeIds: intent.cubeIds ? [...intent.cubeIds] : undefined,
  cubeNames: intent.cubeNames ? [...intent.cubeNames] : undefined,
  faces: intent.faces ? [...intent.faces] : undefined,
  scope: intent.scope,
  mapping: intent.mapping,
  padding: intent.padding,
  anchor: intent.anchor ? ([intent.anchor[0], intent.anchor[1]] as [number, number]) : undefined
});

export const cloneProjectMeta = (meta?: ProjectMeta): ProjectMeta | undefined => {
  if (!meta) return undefined;
  return {
    facePaint: meta.facePaint ? meta.facePaint.map(cloneFacePaintIntent) : undefined
  };
};
