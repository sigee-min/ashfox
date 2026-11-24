import type { AnimationClip, TransformChannel } from '../../model';
import {
  channelUsesMolang,
  exportAdaptation,
  exportIssue,
  sortedById,
  triggerIssueCode,
} from './shared';
import type {
  AnimationExportAdaptation,
  AnimationExportAdaptationCode,
  AnimationExportIssue,
  AnimationExportTarget,
} from './types';

const channelIssues = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
  channel: TransformChannel,
  channelPath: string,
): readonly AnimationExportIssue[] => {
  const issues: AnimationExportIssue[] = [];
  const ids = { channelId: channel.id };
  if (channel.property === 'rotation' && channel.rotationSpace === 'entity') {
    issues.push(
      exportIssue(
        targetId,
        clip,
        'entity_rotation',
        `${channelPath}.rotationSpace`,
        'glTF animation rotations must be node-local.',
        ids,
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
        ids,
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
        ids,
      ),
    );
  }
  return issues;
};

const keyframeIssues = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
  channel: TransformChannel,
  channelPath: string,
): readonly AnimationExportIssue[] => {
  const issues: AnimationExportIssue[] = [];
  for (const keyframe of channel.keys) {
    const keyPath = `${channelPath}.keys.${keyframe.id}`;
    const ids = { channelId: channel.id, keyframeId: keyframe.id };
    if (keyframe.easing !== undefined) {
      issues.push(
        exportIssue(
          targetId,
          clip,
          'easing',
          `${keyPath}.easing`,
          'Core glTF cannot preserve GeckoLib keyframe easing.',
          ids,
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
          ids,
        ),
      );
    }
  }
  return issues;
};

export const analyzeGltfClip = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
): readonly AnimationExportIssue[] => {
  const clipPath = `animations.${clip.id}`;
  return sortedById(Object.values(clip.channels)).flatMap((channel) => {
    if (channel.keys.length === 0) return [];
    const channelPath = `${clipPath}.channels.${channel.id}`;
    return [
      ...channelIssues(clip, targetId, channel, channelPath),
      ...keyframeIssues(clip, targetId, channel, channelPath),
    ];
  });
};

interface ClipOmission {
  readonly code: AnimationExportAdaptationCode;
  readonly field: string;
  readonly applies: (clip: AnimationClip) => boolean;
  readonly message: string;
}

const CLIP_OMISSIONS: readonly ClipOmission[] = [
  {
    code: 'channels_missing',
    field: 'channels',
    applies: (clip) => Object.keys(clip.channels).length === 0,
    message:
      'The clip has no transform channels, so core glTF omits the empty animation while the ashfox project keeps it.',
  },
  {
    code: 'start_delay',
    field: 'startDelay',
    applies: (clip) => clip.startDelay !== undefined,
    message:
      'Core glTF has no playback start-delay contract; the export omits it while the ashfox project keeps it.',
  },
  {
    code: 'loop_delay',
    field: 'loopDelay',
    applies: (clip) => clip.loopDelay !== undefined,
    message:
      'Core glTF has no playback loop-delay contract; the export omits it while the ashfox project keeps it.',
  },
  {
    code: 'animation_time_update',
    field: 'animationTimeUpdate',
    applies: (clip) => clip.animationTimeUpdate !== undefined,
    message:
      'Core glTF has no custom playback-time expression; the export omits it while the ashfox project keeps it.',
  },
  {
    code: 'blend_weight',
    field: 'blendWeight',
    applies: (clip) => clip.blendWeight !== undefined && clip.blendWeight !== 1,
    message:
      'Core glTF has no clip blend-weight contract; the export omits it while the ashfox project keeps it.',
  },
  {
    code: 'override_previous_animation',
    field: 'overridePreviousAnimation',
    applies: (clip) => clip.overridePreviousAnimation === true,
    message:
      'Core glTF has no animation override contract; the export omits it while the ashfox project keeps it.',
  },
];

const triggerOmissions = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
  clipPath: string,
): readonly AnimationExportAdaptation[] =>
  sortedById(Object.values(clip.triggers))
    .filter((trigger) => trigger.keys.length > 0)
    .map((trigger) =>
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

const emptyChannelOmissions = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
  clipPath: string,
): readonly AnimationExportAdaptation[] =>
  sortedById(Object.values(clip.channels))
    .filter((channel) => channel.keys.length === 0)
    .map((channel) =>
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

export const analyzeGltfClipAdaptations = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
): readonly AnimationExportAdaptation[] => {
  const clipPath = `animations.${clip.id}`;
  const clipOmissions = CLIP_OMISSIONS.filter((omission) => omission.applies(clip)).map(
    (omission) =>
      exportAdaptation(
        targetId,
        clip,
        'omitted',
        omission.code,
        `${clipPath}.${omission.field}`,
        omission.message,
      ),
  );
  return [
    ...clipOmissions,
    ...triggerOmissions(clip, targetId, clipPath),
    ...emptyChannelOmissions(clip, targetId, clipPath),
  ];
};
