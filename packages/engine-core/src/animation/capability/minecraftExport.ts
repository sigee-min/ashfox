import type { AnimationClip, AnimationTriggerTrack } from '../../model';
import { exportIssue, timestampCollisionIndexes } from './shared';
import type { AnimationExportIssue } from './types';

export const analyzeMinecraftClip = (
  clip: AnimationClip,
  targetId: 'minecraft.bedrock' | 'minecraft.java.geckolib5',
): readonly AnimationExportIssue[] => {
  const issues: AnimationExportIssue[] = [];
  const clipPath = `animations.${clip.id}`;
  for (const channel of Object.values(clip.channels).sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const channelPath = `${clipPath}.channels.${channel.id}`;
    if (targetId === 'minecraft.bedrock') {
      for (const keyframe of channel.keys) {
        if (keyframe.interpolation === 'step' || keyframe.easing !== undefined) {
          issues.push(
            exportIssue(
              targetId,
              clip,
              'easing',
              `${channelPath}.keys.${keyframe.id}`,
              'Bedrock animation 1.8.0 supports linear or Catmull-Rom keys, not STEP or GeckoLib easing.',
              { channelId: channel.id, keyframeId: keyframe.id },
            ),
          );
        }
      }
    }
    for (const index of timestampCollisionIndexes(
      channel.keys.map((keyframe) => keyframe.timeSeconds),
    )) {
      const keyframe = channel.keys[index];
      issues.push(
        exportIssue(
          targetId,
          clip,
          'timestamp_collision',
          `${channelPath}.keys.${keyframe.id}.timeSeconds`,
          'Minecraft timestamp rounding would overwrite another transform key.',
          { channelId: channel.id, keyframeId: keyframe.id },
        ),
      );
    }
  }

  const triggerTimesByType = new Map<
    AnimationTriggerTrack['type'],
    Array<{ trigger: AnimationTriggerTrack; keyIndex: number }>
  >();
  for (const trigger of Object.values(clip.triggers).sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const entries = triggerTimesByType.get(trigger.type) ?? [];
    entries.push(...trigger.keys.map((_, keyIndex) => ({ trigger, keyIndex })));
    triggerTimesByType.set(trigger.type, entries);
    if (targetId === 'minecraft.java.geckolib5') {
      for (const keyframe of trigger.keys) {
        if (!Array.isArray(keyframe.value)) continue;
        issues.push(
          exportIssue(
            targetId,
            clip,
            'geckolib_multi_value',
            `${clipPath}.triggers.${trigger.id}.keys.${keyframe.id}.value`,
            `GeckoLib 5 ${trigger.type} timestamps require one decoded value.`,
            { triggerId: trigger.id, keyframeId: keyframe.id },
          ),
        );
      }
    }
  }
  for (const entries of triggerTimesByType.values()) {
    const collisionIndexes = timestampCollisionIndexes(
      entries.map(({ trigger, keyIndex }) => trigger.keys[keyIndex].timeSeconds),
    );
    for (const index of collisionIndexes) {
      const { trigger, keyIndex } = entries[index];
      const keyframe = trigger.keys[keyIndex];
      issues.push(
        exportIssue(
          targetId,
          clip,
          'timestamp_collision',
          `${clipPath}.triggers.${trigger.id}.keys.${keyframe.id}.timeSeconds`,
          'Minecraft timestamp rounding would overwrite another effect key of the same type.',
          { triggerId: trigger.id, keyframeId: keyframe.id },
        ),
      );
    }
  }
  return issues;
};
