import type { AnimationClip } from '../../model';
import { channelUsesMolang, exportAdaptation, exportIssue, triggerIssueCode } from './shared';
import type {
  AnimationExportAdaptation,
  AnimationExportIssue,
  AnimationExportTarget,
} from './types';

export const analyzeGltfClip = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
): readonly AnimationExportIssue[] => {
  const issues: AnimationExportIssue[] = [];
  const clipPath = `animations.${clip.id}`;

  for (const channel of Object.values(clip.channels).sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const channelPath = `${clipPath}.channels.${channel.id}`;
    if (channel.keys.length === 0) continue;
    if (channel.property === 'rotation' && channel.rotationSpace === 'entity') {
      issues.push(
        exportIssue(
          targetId,
          clip,
          'entity_rotation',
          `${channelPath}.rotationSpace`,
          'glTF animation rotations must be node-local.',
          { channelId: channel.id },
        ),
      );
    }
    if (channelUsesMolang(channel)) {
      issues.push(
        exportIssue(
          targetId,
          clip,
          'molang',
          `${channelPath}.keys`,
          'glTF animation values must be finite numbers; Molang is Minecraft-specific.',
          { channelId: channel.id },
        ),
      );
    }
    const firstInterpolation = channel.keys[0].interpolation;
    if (channel.keys.some((keyframe) => keyframe.interpolation !== firstInterpolation)) {
      issues.push(
        exportIssue(
          targetId,
          clip,
          'mixed_interpolation',
          `${channelPath}.keys`,
          'A glTF sampler requires one interpolation mode per channel.',
          { channelId: channel.id },
        ),
      );
    }
    for (const keyframe of channel.keys) {
      const keyPath = `${channelPath}.keys.${keyframe.id}`;
      if (keyframe.easing !== undefined) {
        issues.push(
          exportIssue(
            targetId,
            clip,
            'easing',
            `${keyPath}.easing`,
            'Core glTF cannot preserve GeckoLib keyframe easing.',
            { channelId: channel.id, keyframeId: keyframe.id },
          ),
        );
      }
      if (keyframe.preValue !== undefined || keyframe.postValue !== undefined) {
        issues.push(
          exportIssue(
            targetId,
            clip,
            'split_value',
            keyPath,
            'Core glTF cannot preserve split pre/post keyframe values.',
            { channelId: channel.id, keyframeId: keyframe.id },
          ),
        );
      }
    }
  }
  return issues;
};

export const analyzeGltfClipAdaptations = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
): readonly AnimationExportAdaptation[] => {
  const adaptations: AnimationExportAdaptation[] = [];
  const clipPath = `animations.${clip.id}`;
  if (Object.keys(clip.channels).length === 0) {
    adaptations.push(
      exportAdaptation(
        targetId,
        clip,
        'omitted',
        'channels_missing',
        `${clipPath}.channels`,
        'The clip has no transform channels, so core glTF omits the empty animation while the ashfox project keeps it.',
      ),
    );
  }
  if (clip.startDelay !== undefined) {
    adaptations.push(
      exportAdaptation(
        targetId,
        clip,
        'omitted',
        'start_delay',
        `${clipPath}.startDelay`,
        'Core glTF has no playback start-delay contract; the export omits it while the ashfox project keeps it.',
      ),
    );
  }
  if (clip.loopDelay !== undefined) {
    adaptations.push(
      exportAdaptation(
        targetId,
        clip,
        'omitted',
        'loop_delay',
        `${clipPath}.loopDelay`,
        'Core glTF has no playback loop-delay contract; the export omits it while the ashfox project keeps it.',
      ),
    );
  }
  if (clip.animationTimeUpdate !== undefined) {
    adaptations.push(
      exportAdaptation(
        targetId,
        clip,
        'omitted',
        'animation_time_update',
        `${clipPath}.animationTimeUpdate`,
        'Core glTF has no custom playback-time expression; the export omits it while the ashfox project keeps it.',
      ),
    );
  }
  if (clip.blendWeight !== undefined && clip.blendWeight !== 1) {
    adaptations.push(
      exportAdaptation(
        targetId,
        clip,
        'omitted',
        'blend_weight',
        `${clipPath}.blendWeight`,
        'Core glTF has no clip blend-weight contract; the export omits it while the ashfox project keeps it.',
      ),
    );
  }
  if (clip.overridePreviousAnimation === true) {
    adaptations.push(
      exportAdaptation(
        targetId,
        clip,
        'omitted',
        'override_previous_animation',
        `${clipPath}.overridePreviousAnimation`,
        'Core glTF has no animation override contract; the export omits it while the ashfox project keeps it.',
      ),
    );
  }
  for (const trigger of Object.values(clip.triggers).sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (trigger.keys.length === 0) continue;
    adaptations.push(
      exportAdaptation(
        targetId,
        clip,
        'omitted',
        triggerIssueCode(trigger),
        `${clipPath}.triggers.${trigger.id}`,
        `Core glTF has no ${trigger.type} trigger contract; the export omits this track while the ashfox project keeps it.`,
        { triggerId: trigger.id },
      ),
    );
  }
  for (const channel of Object.values(clip.channels).sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (channel.keys.length > 0) continue;
    adaptations.push(
      exportAdaptation(
        targetId,
        clip,
        'omitted',
        'channel_keys_missing',
        `${clipPath}.channels.${channel.id}.keys`,
        'The transform channel has no keyframes, so core glTF omits it while the ashfox project keeps it.',
        { channelId: channel.id },
      ),
    );
  }
  return adaptations;
};
