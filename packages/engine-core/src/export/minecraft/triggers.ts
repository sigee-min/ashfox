import type {
  AnimationEffect,
  AnimationEffectValue,
  AnimationTriggerTrack,
  ProjectDocument,
} from '../../model';
import type {
  MinecraftActorAnimation,
  MinecraftAnimationCompileOptions,
  MinecraftAnimationEffect,
} from './types';
import { formatAnimationTimestamp } from './values';

const isAnimationEffect = (value: unknown): value is AnimationEffect =>
  typeof value === 'object' &&
  value !== null &&
  'effect' in value &&
  typeof value.effect === 'string';

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isAnimationEffectArray = (
  value: AnimationEffectValue | string | readonly string[],
): value is readonly AnimationEffect[] =>
  Array.isArray(value) && value.every((entry) => isAnimationEffect(entry));

const resolveLocatorName = (
  document: ProjectDocument,
  locatorId: string | undefined,
  visibleNodeIds: ReadonlySet<string>,
): string | undefined => {
  if (!locatorId || !visibleNodeIds.has(locatorId)) return undefined;
  const locator = document.scene.nodes[locatorId];
  return locator?.kind === 'locator' ? locator.name : undefined;
};

const compileEffect = (
  document: ProjectDocument,
  effect: AnimationEffect,
  visibleNodeIds: ReadonlySet<string>,
): MinecraftAnimationEffect | undefined => {
  const locator = resolveLocatorName(document, effect.locatorId, visibleNodeIds);
  if (effect.locatorId && !locator)
    throw new Error(
      `Validated Minecraft animation effect locator "${effect.locatorId}" is missing or hidden.`,
    );
  return {
    effect: effect.effect,
    ...(locator ? { locator } : {}),
    ...(effect.preEffectScript ? { pre_effect_script: effect.preEffectScript.source } : {}),
    ...(effect.bindToActor !== undefined ? { bind_to_actor: effect.bindToActor } : {}),
  };
};

const compileEffectValue = (
  document: ProjectDocument,
  value: AnimationEffectValue,
  visibleNodeIds: ReadonlySet<string>,
): MinecraftAnimationEffect | MinecraftAnimationEffect[] | undefined => {
  if (!isAnimationEffectArray(value)) {
    return compileEffect(document, value, visibleNodeIds);
  }
  const effects = value
    .map((effect) => compileEffect(document, effect, visibleNodeIds))
    .filter((effect): effect is MinecraftAnimationEffect => effect !== undefined);
  return effects.length > 0 ? effects : undefined;
};

type CompiledEffects = Record<string, MinecraftAnimationEffect | MinecraftAnimationEffect[]>;
type CompiledTimeline = Record<string, string | readonly string[]>;
type TriggerValue = AnimationTriggerTrack['keys'][number]['value'];

const keyframeEffect = (
  document: ProjectDocument,
  value: TriggerValue,
  visibleNodeIds: ReadonlySet<string>,
): MinecraftAnimationEffect | MinecraftAnimationEffect[] | undefined => {
  if (!isAnimationEffect(value) && !isAnimationEffectArray(value)) return undefined;
  return compileEffectValue(document, value, visibleNodeIds);
};

const timelineValue = (
  value: TriggerValue,
  options: MinecraftAnimationCompileOptions,
): string | readonly string[] => {
  if (isStringArray(value)) return options.dialect === 'bedrock' ? value : value.join('\n');
  return typeof value === 'string' ? value : '';
};

export const compileMinecraftAnimationTriggers = (
  document: ProjectDocument,
  tracks: readonly AnimationTriggerTrack[],
  options: MinecraftAnimationCompileOptions,
  visibleNodeIds: ReadonlySet<string>,
): Pick<MinecraftActorAnimation, 'sound_effects' | 'particle_effects' | 'timeline'> => {
  const soundEffects: CompiledEffects = {};
  const particleEffects: CompiledEffects = {};
  const timeline: CompiledTimeline = {};
  const effectRecords: Partial<Record<AnimationTriggerTrack['type'], CompiledEffects>> = {
    sound: soundEffects,
    particle: particleEffects,
  };

  for (const track of tracks) {
    const effects = effectRecords[track.type];
    for (const keyframe of track.keys) {
      const timestamp = formatAnimationTimestamp(keyframe.timeSeconds);
      if (!effects) {
        timeline[timestamp] = timelineValue(keyframe.value, options);
        continue;
      }
      const effect = keyframeEffect(document, keyframe.value, visibleNodeIds);
      if (effect) effects[timestamp] = effect;
    }
  }

  return {
    ...(Object.keys(soundEffects).length > 0 ? { sound_effects: soundEffects } : {}),
    ...(Object.keys(particleEffects).length > 0 ? { particle_effects: particleEffects } : {}),
    ...(Object.keys(timeline).length > 0 ? { timeline } : {}),
  };
};
