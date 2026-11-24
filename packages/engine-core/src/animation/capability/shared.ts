import type {
  AnimationClip,
  AnimationScalar,
  AnimationTriggerTrack,
  TransformChannel,
} from '../../model';
import type {
  AnimationExportAdaptation,
  AnimationExportAdaptationCode,
  AnimationExportAdaptationDisposition,
  AnimationExportIssue,
  AnimationExportIssueCode,
  AnimationExportTarget,
} from './types';

export const sortedById = <T extends { readonly id: string }>(values: readonly T[]): readonly T[] =>
  [...values].sort((left, right) => left.id.localeCompare(right.id));

export const isNumericAnimationScalar = (value: AnimationScalar): boolean =>
  typeof value === 'number' && Number.isFinite(value);

export const channelUsesMolang = (channel: TransformChannel): boolean =>
  channel.keys.some((keyframe) =>
    [
      ...keyframe.value,
      ...(keyframe.preValue ?? []),
      ...(keyframe.postValue ?? []),
      ...(keyframe.easing?.arguments ?? []),
    ].some((value) => !isNumericAnimationScalar(value)),
  );

const minecraftTimestampKey = (timeSeconds: number): string =>
  String(Number(timeSeconds.toFixed(4)));

export const timestampCollisionIndexes = (times: readonly number[]): readonly number[] => {
  const seen = new Set<string>();
  const collisions: number[] = [];
  times.forEach((timeSeconds, index) => {
    if (!Number.isFinite(timeSeconds)) return;
    const key = minecraftTimestampKey(timeSeconds);
    if (seen.has(key)) collisions.push(index);
    seen.add(key);
  });
  return collisions;
};

export const exportIssue = (
  targetId: AnimationExportTarget,
  clip: AnimationClip,
  code: AnimationExportIssueCode,
  path: string,
  message: string,
  ids: Pick<AnimationExportIssue, 'channelId' | 'triggerId' | 'keyframeId'> = {},
): AnimationExportIssue => ({
  code,
  targetId,
  clipId: clip.id,
  path,
  message,
  ...ids,
});

export const exportAdaptation = (
  targetId: AnimationExportTarget,
  clip: AnimationClip,
  disposition: AnimationExportAdaptationDisposition,
  code: AnimationExportAdaptationCode,
  path: string,
  message: string,
  ids: Pick<AnimationExportAdaptation, 'channelId' | 'triggerId' | 'keyframeId'> = {},
): AnimationExportAdaptation => ({
  disposition,
  code,
  targetId,
  clipId: clip.id,
  path,
  message,
  ...ids,
});

export const triggerIssueCode = (
  trigger: AnimationTriggerTrack,
): 'sound_trigger' | 'particle_trigger' | 'timeline_trigger' => `${trigger.type}_trigger`;
