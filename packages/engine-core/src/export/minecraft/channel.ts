import type { TransformChannel, TransformKeyframe } from '../../model';
import type {
  MinecraftAnimationChannel,
  MinecraftAnimationCompileOptions,
  MinecraftAnimationKeyframe,
  MinecraftAnimationVector,
} from './types';
import { optimizeMinecraftAnimationChannel } from './optimize';
import {
  formatAnimationTimestamp,
  serializeAnimationScalar,
  serializeAnimationVector,
} from './values';

const bedrockEnvelope = (
  keyframe: TransformKeyframe,
  property: TransformChannel['property'],
  vector: MinecraftAnimationVector,
): MinecraftAnimationKeyframe => ({
  pre: keyframe.preValue ? serializeAnimationVector(keyframe.preValue, property) : vector,
  post: keyframe.postValue ? serializeAnimationVector(keyframe.postValue, property) : vector,
  ...(keyframe.interpolation === 'catmullrom' ? { lerp_mode: 'catmullrom' as const } : {}),
});

const geckolibEasing = (
  keyframe: TransformKeyframe,
): Pick<MinecraftAnimationKeyframe, 'easing' | 'easingArgs' | 'lerp_mode'> => {
  if (keyframe.easing) {
    const { type, arguments: easingArguments } = keyframe.easing;
    return {
      easing: type,
      ...(easingArguments
        ? {
            easingArgs: easingArguments.map((argument) =>
              serializeAnimationScalar(argument, false),
            ),
          }
        : {}),
    };
  }
  return keyframe.interpolation !== 'linear' ? { lerp_mode: keyframe.interpolation } : {};
};

const geckolibEnvelope = (
  keyframe: TransformKeyframe,
  property: TransformChannel['property'],
  vector: MinecraftAnimationVector,
): MinecraftAnimationKeyframe => ({
  vector,
  ...(keyframe.preValue ? { pre: serializeAnimationVector(keyframe.preValue, property) } : {}),
  ...(keyframe.postValue ? { post: serializeAnimationVector(keyframe.postValue, property) } : {}),
  ...geckolibEasing(keyframe),
});

const compileKeyframe = (
  keyframe: TransformKeyframe,
  property: TransformChannel['property'],
  options: MinecraftAnimationCompileOptions,
): MinecraftAnimationVector | MinecraftAnimationKeyframe => {
  const vector = serializeAnimationVector(keyframe.value, property);
  const hasEnvelope =
    keyframe.preValue !== undefined ||
    keyframe.postValue !== undefined ||
    keyframe.easing !== undefined ||
    keyframe.interpolation !== 'linear';
  if (!hasEnvelope) return vector;
  return options.dialect === 'bedrock'
    ? bedrockEnvelope(keyframe, property, vector)
    : geckolibEnvelope(keyframe, property, vector);
};

export const compileMinecraftAnimationChannel = (
  channel: TransformChannel,
  options: MinecraftAnimationCompileOptions,
): MinecraftAnimationChannel => {
  const optimized = optimizeMinecraftAnimationChannel(channel);
  if (optimized.constant) {
    return serializeAnimationVector(optimized.constant, channel.property);
  }
  const result: Extract<MinecraftAnimationChannel, Record<string, unknown>> = {};
  for (const keyframe of optimized.keys) {
    result[formatAnimationTimestamp(keyframe.timeSeconds)] = compileKeyframe(
      keyframe,
      channel.property,
      options,
    );
  }
  return result;
};
