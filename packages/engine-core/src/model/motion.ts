import type { ChannelId, ClipId, EntityId, KeyframeId } from './identity';

export type TransformChannelProperty = 'position' | 'rotation' | 'scale';
export type KeyframeInterpolation = 'linear' | 'step' | 'catmullrom';
export type AnimationLoopMode = 'once' | 'loop' | 'hold_on_last_frame';

export interface MolangExpression {
  kind: 'molang';
  source: string;
}

export type AnimationScalar = number | MolangExpression;
export type AnimationVec3 = readonly [AnimationScalar, AnimationScalar, AnimationScalar];

export interface KeyframeEasing {
  type: string;
  arguments?: readonly AnimationScalar[];
}

export interface TransformKeyframe {
  id: KeyframeId;
  timeSeconds: number;
  value: AnimationVec3;
  preValue?: AnimationVec3;
  postValue?: AnimationVec3;
  interpolation: KeyframeInterpolation;
  easing?: KeyframeEasing;
}

export interface TransformChannel {
  id: ChannelId;
  targetNodeId: EntityId;
  property: TransformChannelProperty;
  rotationSpace?: 'bone' | 'entity';
  keys: readonly TransformKeyframe[];
}

export interface AnimationTriggerKeyframe<TValue> {
  id: KeyframeId;
  timeSeconds: number;
  value: TValue;
}

export interface AnimationEffect {
  effect: string;
  locatorId?: EntityId;
  preEffectScript?: MolangExpression;
  bindToActor?: boolean;
}

export type AnimationEffectValue = AnimationEffect | readonly AnimationEffect[];

export interface SoundTriggerTrack {
  id: ChannelId;
  type: 'sound';
  keys: readonly AnimationTriggerKeyframe<AnimationEffectValue>[];
}

export interface ParticleTriggerTrack {
  id: ChannelId;
  type: 'particle';
  keys: readonly AnimationTriggerKeyframe<AnimationEffectValue>[];
}

export interface TimelineTriggerTrack {
  id: ChannelId;
  type: 'timeline';
  keys: readonly AnimationTriggerKeyframe<string | readonly string[]>[];
}

export type AnimationTriggerTrack = SoundTriggerTrack | ParticleTriggerTrack | TimelineTriggerTrack;

export interface AnimationClip {
  id: ClipId;
  name: string;
  durationSeconds: number;
  fps: number;
  loop: AnimationLoopMode;
  startDelay?: MolangExpression;
  loopDelay?: MolangExpression;
  animationTimeUpdate?: MolangExpression;
  blendWeight?: AnimationScalar;
  overridePreviousAnimation?: boolean;
  channels: Readonly<Record<ChannelId, TransformChannel>>;
  triggers: Readonly<Record<ChannelId, AnimationTriggerTrack>>;
}
