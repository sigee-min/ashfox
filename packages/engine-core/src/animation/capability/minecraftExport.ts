import type { AnimationClip, AnimationTriggerTrack, TransformChannel } from '../../model';
import { exportIssue, sortedById, timestampCollisionIndexes } from './shared';
import type { AnimationExportIssue } from './types';

type MinecraftTarget = 'minecraft.bedrock' | 'minecraft.java.geckolib5';

interface TriggerKeyRef {
  readonly trigger: AnimationTriggerTrack;
  readonly keyIndex: number;
}

const bedrockEasingIssues = (
  clip: AnimationClip,
  targetId: MinecraftTarget,
  channel: TransformChannel,
  channelPath: string,
): readonly AnimationExportIssue[] => {
  if (targetId !== 'minecraft.bedrock') return [];
  return channel.keys
    .filter((keyframe) => keyframe.interpolation === 'step' || keyframe.easing !== undefined)
    .map((keyframe) =>
      exportIssue(
        targetId,
        clip,
        'easing',
        `${channelPath}.keys.${keyframe.id}`,
        'Bedrock animation 1.8.0 supports linear or Catmull-Rom keys, not STEP or GeckoLib easing.',
        { channelId: channel.id, keyframeId: keyframe.id },
      ),
    );
};

const channelCollisionIssues = (
  clip: AnimationClip,
  targetId: MinecraftTarget,
  channel: TransformChannel,
  channelPath: string,
): readonly AnimationExportIssue[] =>
  timestampCollisionIndexes(channel.keys.map((keyframe) => keyframe.timeSeconds)).map((index) => {
    const keyframe = channel.keys[index];
    return exportIssue(
      targetId,
      clip,
      'timestamp_collision',
      `${channelPath}.keys.${keyframe.id}.timeSeconds`,
      'Minecraft timestamp rounding would overwrite another transform key.',
      { channelId: channel.id, keyframeId: keyframe.id },
    );
  });

const geckolibMultiValueIssues = (
  clip: AnimationClip,
  targetId: MinecraftTarget,
  trigger: AnimationTriggerTrack,
  clipPath: string,
): readonly AnimationExportIssue[] => {
  if (targetId !== 'minecraft.java.geckolib5') return [];
  return trigger.keys
    .filter((keyframe) => Array.isArray(keyframe.value))
    .map((keyframe) =>
      exportIssue(
        targetId,
        clip,
        'geckolib_multi_value',
        `${clipPath}.triggers.${trigger.id}.keys.${keyframe.id}.value`,
        `GeckoLib 5 ${trigger.type} timestamps require one decoded value.`,
        { triggerId: trigger.id, keyframeId: keyframe.id },
      ),
    );
};

const triggerCollisionIssues = (
  clip: AnimationClip,
  targetId: MinecraftTarget,
  entries: readonly TriggerKeyRef[],
  clipPath: string,
): readonly AnimationExportIssue[] =>
  timestampCollisionIndexes(
    entries.map(({ trigger, keyIndex }) => trigger.keys[keyIndex].timeSeconds),
  ).map((index) => {
    const { trigger, keyIndex } = entries[index];
    const keyframe = trigger.keys[keyIndex];
    return exportIssue(
      targetId,
      clip,
      'timestamp_collision',
      `${clipPath}.triggers.${trigger.id}.keys.${keyframe.id}.timeSeconds`,
      'Minecraft timestamp rounding would overwrite another effect key of the same type.',
      { triggerId: trigger.id, keyframeId: keyframe.id },
    );
  });

const triggerIssues = (
  clip: AnimationClip,
  targetId: MinecraftTarget,
  clipPath: string,
): readonly AnimationExportIssue[] => {
  const issues: AnimationExportIssue[] = [];
  const triggerTimesByType = new Map<AnimationTriggerTrack['type'], TriggerKeyRef[]>();
  for (const trigger of sortedById(Object.values(clip.triggers))) {
    const entries = triggerTimesByType.get(trigger.type) ?? [];
    entries.push(...trigger.keys.map((_, keyIndex) => ({ trigger, keyIndex })));
    triggerTimesByType.set(trigger.type, entries);
    issues.push(...geckolibMultiValueIssues(clip, targetId, trigger, clipPath));
  }
  for (const entries of triggerTimesByType.values()) {
    issues.push(...triggerCollisionIssues(clip, targetId, entries, clipPath));
  }
  return issues;
};

export const analyzeMinecraftClip = (
  clip: AnimationClip,
  targetId: MinecraftTarget,
): readonly AnimationExportIssue[] => {
  const clipPath = `animations.${clip.id}`;
  const channelIssues = sortedById(Object.values(clip.channels)).flatMap((channel) => {
    const channelPath = `${clipPath}.channels.${channel.id}`;
    return [
      ...bedrockEasingIssues(clip, targetId, channel, channelPath),
      ...channelCollisionIssues(clip, targetId, channel, channelPath),
    ];
  });
  return [...channelIssues, ...triggerIssues(clip, targetId, clipPath)];
};
