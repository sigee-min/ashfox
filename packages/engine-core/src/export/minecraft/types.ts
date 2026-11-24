export type MinecraftAnimationScalar = number | string;
export type MinecraftAnimationVector = [
  MinecraftAnimationScalar,
  MinecraftAnimationScalar,
  MinecraftAnimationScalar,
];

export interface MinecraftAnimationKeyframe {
  vector?: MinecraftAnimationVector;
  pre?: MinecraftAnimationVector;
  post?: MinecraftAnimationVector;
  lerp_mode?: 'linear' | 'step' | 'catmullrom';
  easing?: string;
  easingArgs?: MinecraftAnimationScalar[];
}

export type MinecraftAnimationTimeline = Record<
  string,
  MinecraftAnimationVector | MinecraftAnimationKeyframe
>;

export type MinecraftAnimationChannel = MinecraftAnimationVector | MinecraftAnimationTimeline;

export interface MinecraftBoneAnimation {
  relative_to?: { rotation: 'entity' } | 'entity';
  position?: MinecraftAnimationChannel;
  rotation?: MinecraftAnimationChannel;
  scale?: MinecraftAnimationChannel;
}

export interface MinecraftAnimationEffect {
  effect: string;
  locator?: string;
  pre_effect_script?: string;
  bind_to_actor?: boolean;
}

export interface MinecraftActorAnimation {
  loop?: true | 'hold_on_last_frame';
  animation_length: number;
  start_delay?: string;
  loop_delay?: string;
  anim_time_update?: string;
  blend_weight?: MinecraftAnimationScalar;
  override_previous_animation?: boolean;
  bones?: Record<string, MinecraftBoneAnimation>;
  sound_effects?: Record<string, MinecraftAnimationEffect | MinecraftAnimationEffect[]>;
  particle_effects?: Record<string, MinecraftAnimationEffect | MinecraftAnimationEffect[]>;
  timeline?: Record<string, string | readonly string[]>;
}

export interface MinecraftActorAnimationFile {
  format_version: '1.8.0';
  animations: Record<string, MinecraftActorAnimation>;
}

export interface MinecraftAnimationCompileOptions {
  formatVersion: '1.8.0';
  dialect: 'bedrock' | 'geckolib5';
}
