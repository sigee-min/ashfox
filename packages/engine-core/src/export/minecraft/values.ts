import type { AnimationScalar, AnimationVec3, TransformChannel } from '../../model';
import { canonicalMinecraftRotation } from '../../model/transform';
import type { MinecraftAnimationScalar, MinecraftAnimationVector } from './types';

export const serializeAnimationScalar = (
  value: AnimationScalar,
  negate: boolean,
): MinecraftAnimationScalar => {
  if (typeof value === 'number') {
    const result = negate ? -value : value;
    return Math.abs(result) <= 0.000001 ? 0 : result;
  }
  const source = value.source.trim();
  return negate ? `-(${source})` : source;
};

export const serializeAnimationVector = (
  value: AnimationVec3,
  property: TransformChannel['property'],
): MinecraftAnimationVector => {
  if (property === 'rotation' && value.every((component) => typeof component === 'number')) {
    const target = canonicalMinecraftRotation([
      value[0] as number,
      value[1] as number,
      value[2] as number,
    ]);
    return [target[0], target[1], target[2]];
  }
  if (property === 'rotation') {
    // A symbolic Molang Euler cannot be converted through the reflected
    // target matrix without inventing a second transform authority.  The
    // axis-wise form is exact for the six signed single-axis expressions and
    // remains fail-closed for combined numeric channels via the branch above.
    return [
      serializeAnimationScalar(value[0], false),
      serializeAnimationScalar(value[1], true),
      serializeAnimationScalar(value[2], true),
    ];
  }
  return [
    serializeAnimationScalar(value[0], property === 'position'),
    serializeAnimationScalar(value[1], false),
    serializeAnimationScalar(value[2], false),
  ];
};

export const formatAnimationTimestamp = (timeSeconds: number): string => {
  const rounded = Number(timeSeconds.toFixed(4));
  return String(rounded);
};
