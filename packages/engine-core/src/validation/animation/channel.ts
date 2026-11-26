import { isFiniteNumber } from '../shared/value';
import type { ClipValidationContext } from './context';
import { validateAnimationVector, validateKeyframeEasing } from './value';

const INTERPOLATIONS = new Set<string>(['linear', 'step', 'catmullrom']);
const PROPERTIES = new Set<string>(['position', 'rotation', 'scale']);

const validateChannelTarget = (
  channel: ClipValidationContext['clip']['channels'][string],
  path: string,
  context: ClipValidationContext,
): void => {
  const { clip, document, add } = context;
  if (!document.scene.nodes[channel.targetNodeId]) {
    add({
      code: 'animation.target_missing',
      severity: 'error',
      message: `Animation channel targets missing node "${channel.targetNodeId}".`,
      path: `${path}.targetNodeId`,
      entityIds: [channel.targetNodeId],
      clipIds: [clip.id],
    });
  }
  if (!PROPERTIES.has(channel.property)) {
    add({
      code: 'animation.invalid_value',
      severity: 'error',
      message: 'Animation channel property must be position, rotation, or scale.',
      path: `${path}.property`,
      clipIds: [clip.id],
    });
  }
  if (
    channel.rotationSpace !== undefined &&
    (channel.property !== 'rotation' || !['bone', 'entity'].includes(channel.rotationSpace))
  ) {
    add({
      code: 'animation.invalid_value',
      severity: 'error',
      message: 'rotationSpace is valid only on rotation channels and must be bone or entity.',
      path: `${path}.rotationSpace`,
      clipIds: [clip.id],
    });
  }
};

type Keyframe = ClipValidationContext['clip']['channels'][string]['keys'][number];

const validateKeyframeValues = (
  keyframe: Keyframe,
  keyPath: string,
  context: ClipValidationContext,
): void => {
  const { clip, add } = context;
  validateAnimationVector(keyframe.value, `${keyPath}.value`, clip.id, add);
  if (keyframe.quaternion !== undefined) {
    if (keyframe.quaternion.length !== 4 || !keyframe.quaternion.every(isFiniteNumber)) {
      add({
        code: 'animation.invalid_value',
        severity: 'error',
        message: 'Animation keyframe quaternion must contain 4 finite numbers.',
        path: `${keyPath}.quaternion`,
        clipIds: [clip.id],
      });
    }
  }
  if (keyframe.preValue) {
    validateAnimationVector(keyframe.preValue, `${keyPath}.preValue`, clip.id, add);
  }
  if (keyframe.postValue) {
    validateAnimationVector(keyframe.postValue, `${keyPath}.postValue`, clip.id, add);
  }
  if (!INTERPOLATIONS.has(keyframe.interpolation)) {
    add({
      code: 'animation.invalid_value',
      severity: 'error',
      message: 'Animation interpolation must be linear, step, or catmullrom.',
      path: `${keyPath}.interpolation`,
      clipIds: [clip.id],
    });
  }
  if (keyframe.easing) {
    validateKeyframeEasing(keyframe.easing, `${keyPath}.easing`, clip.id, add);
  }
};

const validateKeyframeTime = (
  keyframe: Keyframe,
  keyPath: string,
  previousTime: number,
  context: ClipValidationContext,
): void => {
  const { clip, add } = context;
  if (
    !isFiniteNumber(keyframe.timeSeconds) ||
    keyframe.timeSeconds < 0 ||
    keyframe.timeSeconds > clip.durationSeconds
  ) {
    add({
      code: 'animation.key_out_of_range',
      severity: 'error',
      message: 'Animation key time must be within the clip duration.',
      path: `${keyPath}.timeSeconds`,
      clipIds: [clip.id],
    });
  }
  if (keyframe.timeSeconds <= previousTime) {
    add({
      code: 'animation.key_order',
      severity: 'error',
      message: 'Animation keys must be strictly ordered by time.',
      path: `${keyPath}.timeSeconds`,
      clipIds: [clip.id],
    });
  }
};

const validateKeyframe = (
  keyframe: Keyframe,
  keyPath: string,
  previousTime: number,
  context: ClipValidationContext,
): void => {
  context.registerId(keyframe.id, keyPath);
  validateKeyframeValues(keyframe, keyPath, context);
  validateKeyframeTime(keyframe, keyPath, previousTime, context);
};

const validateChannelKeys = (
  channel: ClipValidationContext['clip']['channels'][string],
  path: string,
  context: ClipValidationContext,
): void => {
  const { clip, add } = context;
  if (channel.keys.length === 0) {
    add({
      code: 'animation.invalid_timing',
      severity: 'error',
      message: 'Animation transform channels require at least one keyframe.',
      path: `${path}.keys`,
      clipIds: [clip.id],
    });
  }
  let previousTime = -Infinity;
  for (const [keyIndex, keyframe] of channel.keys.entries()) {
    validateKeyframe(keyframe, `${path}.keys[${keyIndex}]`, previousTime, context);
    previousTime = keyframe.timeSeconds;
  }
};

export const validateTransformChannels = (context: ClipValidationContext): void => {
  const { clip, path, add, registerId } = context;
  for (const [channelKey, channel] of Object.entries(clip.channels)) {
    const channelPath = `${path}.channels.${channelKey}`;
    registerId(channel.id, channelPath);
    if (channelKey !== channel.id) {
      add({
        code: 'identity.key_mismatch',
        severity: 'error',
        message: `Animation channel key "${channelKey}" does not match ID "${channel.id}".`,
        path: channelPath,
        clipIds: [clip.id],
      });
    }
    validateChannelTarget(channel, channelPath, context);
    validateChannelKeys(channel, channelPath, context);
  }
};
