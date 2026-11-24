import type { AnimationClip, AnimationVec3, TransformChannel } from '../../model';
import { isNumericAnimationScalar, triggerIssueCode } from './shared';
import type { AnimationPreviewIssue } from './types';

const numericVector = (value: AnimationVec3): boolean => value.every(isNumericAnimationScalar);

export const animationPreviewIssues = (
  channel: TransformChannel,
): readonly AnimationPreviewIssue[] => {
  const issues: AnimationPreviewIssue[] = [];
  if (channel.property === 'rotation' && channel.rotationSpace === 'entity') {
    issues.push({
      code: 'entity_rotation',
      channelId: channel.id,
    });
  }
  for (const keyframe of channel.keys) {
    if (!numericVector(keyframe.value)) {
      issues.push({
        code: 'molang',
        channelId: channel.id,
        keyframeId: keyframe.id,
      });
    }
    if (keyframe.easing !== undefined) {
      issues.push({
        code: 'easing',
        channelId: channel.id,
        keyframeId: keyframe.id,
      });
    }
    if (keyframe.preValue !== undefined || keyframe.postValue !== undefined) {
      issues.push({
        code: 'split_value',
        channelId: channel.id,
        keyframeId: keyframe.id,
      });
    }
  }
  return issues;
};

export const analyzeAnimationPreview = (clip: AnimationClip): readonly AnimationPreviewIssue[] => {
  const issues: AnimationPreviewIssue[] = Object.values(clip.channels)
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((channel) =>
      animationPreviewIssues(channel).map((issue) => ({
        ...issue,
        clipId: clip.id,
      })),
    );
  if (clip.startDelay !== undefined) {
    issues.push({ code: 'start_delay', clipId: clip.id });
  }
  if (clip.loopDelay !== undefined) {
    issues.push({ code: 'loop_delay', clipId: clip.id });
  }
  if (clip.animationTimeUpdate !== undefined) {
    issues.push({ code: 'animation_time_update', clipId: clip.id });
  }
  if (clip.blendWeight !== undefined && clip.blendWeight !== 1) {
    issues.push({ code: 'blend_weight', clipId: clip.id });
  }
  if (clip.overridePreviousAnimation === true) {
    issues.push({
      code: 'override_previous_animation',
      clipId: clip.id,
    });
  }
  for (const trigger of Object.values(clip.triggers).sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (trigger.keys.length === 0) continue;
    issues.push({
      code: triggerIssueCode(trigger),
      clipId: clip.id,
      triggerId: trigger.id,
    });
  }
  return issues;
};
