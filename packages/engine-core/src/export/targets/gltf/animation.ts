import { compareText } from '../../../stableOrder';
import type { AnimationClip, ProjectDocument, TransformChannel, Vec3 } from '../../../model';
import type { ExportAdaptedDocument } from '../../adapter';
import { canonicalQuaternionFromEuler } from '../../../model/transform';
import {
  sampleComposedNumericTransformChannel,
  type NumericAnimationVec3,
} from '../../../animation/numericChannel';
import { assertProjectAnimationsExportable } from '../../../animation/capability';
import { assertValidatedExportTargetDocument } from '../../pipeline/validate';
import { GltfBinaryWriter } from './binary';
import { optimizeGltfAnimationSamples } from './samples';
import type { GltfAnimation } from './contract';

interface SampledChannel {
  times: number[];
  values: NumericAnimationVec3[];
  interpolation: 'LINEAR' | 'STEP';
}

export interface GltfAnimationCompileOptions {
  writer: GltfBinaryWriter;
  nodeIndexById: ReadonlyMap<string, number>;
  restTranslationById: ReadonlyMap<string, [number, number, number]>;
  restRotationById: ReadonlyMap<string, [number, number, number]>;
  restScaleById: ReadonlyMap<string, [number, number, number]>;
  unitScale: number;
}

const quaternionFromEuler = (rotation: Vec3): [number, number, number, number] =>
  [...canonicalQuaternionFromEuler(rotation)] as [number, number, number, number];

const compileValues = (
  channel: TransformChannel,
  values: readonly NumericAnimationVec3[],
): { values: number[]; componentCount: 3 | 4 } => {
  if (channel.property === 'rotation') {
    const quaternions = values.map(quaternionFromEuler);
    for (let index = 1; index < quaternions.length; index += 1) {
      const previous = quaternions[index - 1];
      const current = quaternions[index];
      const dot = previous.reduce(
        (sum, component, componentIndex) => sum + component * current[componentIndex],
        0,
      );
      if (dot < 0) {
        quaternions[index] = current.map((component) => -component) as [
          number,
          number,
          number,
          number,
        ];
      }
    }
    return {
      values: quaternions.flatMap((quaternion) => quaternion),
      componentCount: 4,
    };
  }
  return {
    values: values.flatMap((value) => value),
    componentCount: 3,
  };
};

const roundedTime = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const bakeCanonicalFrames = (
  channel: TransformChannel,
  clip: AnimationClip,
  sampleAt: (timeSeconds: number) => NumericAnimationVec3,
): SampledChannel => {
  const sourceTimes = [
    ...(channel.keys[0].timeSeconds > 0.000001 ? [0] : []),
    ...channel.keys.map((key) => roundedTime(key.timeSeconds)),
  ];
  const finalSourceTime = sourceTimes[sourceTimes.length - 1];
  if (finalSourceTime < clip.durationSeconds - 0.000001) {
    sourceTimes.push(roundedTime(clip.durationSeconds));
  }
  const frameCount = Math.ceil(clip.durationSeconds * clip.fps);
  const times = [
    ...new Set([
      ...sourceTimes,
      ...Array.from({ length: frameCount + 1 }, (_, index) =>
        roundedTime(Math.min(index / clip.fps, clip.durationSeconds)),
      ),
      roundedTime(clip.durationSeconds),
    ]),
  ].sort((left, right) => left - right);
  return {
    times,
    values: times.map(sampleAt),
    interpolation: 'LINEAR',
  };
};

const restValueForChannel = (
  channel: TransformChannel,
  options: GltfAnimationCompileOptions,
): NumericAnimationVec3 => {
  if (channel.property === 'position') {
    return options.restTranslationById.get(channel.targetNodeId) ?? [0, 0, 0];
  }
  if (channel.property === 'rotation') {
    return options.restRotationById.get(channel.targetNodeId) ?? [0, 0, 0];
  }
  return options.restScaleById.get(channel.targetNodeId) ?? [1, 1, 1];
};

const sampleChannel = (
  channel: TransformChannel,
  clip: AnimationClip,
  options: GltfAnimationCompileOptions,
): SampledChannel => {
  const interpolation = channel.keys[0].interpolation;
  const restValue = restValueForChannel(channel, options);
  const sampleAt = (timeSeconds: number): NumericAnimationVec3 => {
    const sampled = sampleComposedNumericTransformChannel(channel, timeSeconds, {
      restValue,
      ...(channel.property === 'position' ? { translationScale: options.unitScale } : {}),
    });
    if (!sampled) {
      throw new Error('glTF animation compilation requires numeric keyframe values.');
    }
    return sampled;
  };
  if (
    interpolation === 'catmullrom' ||
    (channel.property === 'rotation' && interpolation === 'linear')
  ) {
    return bakeCanonicalFrames(channel, clip, sampleAt);
  }
  const lastKey = channel.keys[channel.keys.length - 1];
  const times = [
    ...(channel.keys[0].timeSeconds > 0.000001 ? [0] : []),
    ...channel.keys.map((keyframe) => keyframe.timeSeconds),
    ...(lastKey.timeSeconds < clip.durationSeconds - 0.000001 ? [clip.durationSeconds] : []),
  ];
  return {
    times,
    values: times.map(sampleAt),
    interpolation: interpolation === 'step' ? 'STEP' : 'LINEAR',
  };
};

const resolveCachedAccessor = (
  cache: Map<string, number>,
  writer: GltfBinaryWriter,
  values: readonly number[],
  componentCount: 1 | 3 | 4,
  includeBounds: boolean,
  encoding: 'float' | 'normalized-short' = 'float',
): number => {
  const key = `${encoding}:${componentCount}:${values.map(Math.fround).join(',')}`;
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  if (encoding === 'normalized-short' && componentCount !== 4) {
    throw new Error('Normalized glTF animation outputs must be VEC4.');
  }
  const accessor =
    encoding === 'normalized-short'
      ? writer.addNormalizedShortAccessor(values, 4)
      : writer.addFloatAccessor(values, componentCount, includeBounds);
  cache.set(key, accessor);
  return accessor;
};

interface AccessorCaches {
  times: Map<string, number>;
  outputs: Map<string, number>;
}

const appendGltfAnimationChannel = (
  animation: GltfAnimation,
  clip: AnimationClip,
  channel: TransformChannel,
  options: GltfAnimationCompileOptions,
  caches: AccessorCaches,
): void => {
  if (channel.keys.length === 0) return;
  const node = options.nodeIndexById.get(channel.targetNodeId);
  if (node === undefined) {
    throw new Error(
      `Validated glTF animation target "${channel.targetNodeId}" is missing from the emitted scene.`,
    );
  }
  const sampled = sampleChannel(channel, clip, options);
  const compiled = compileValues(channel, sampled.values);
  const optimized = optimizeGltfAnimationSamples(channel, {
    times: sampled.times,
    values: compiled.values,
    componentCount: compiled.componentCount,
    interpolation: sampled.interpolation,
  });
  const input = resolveCachedAccessor(caches.times, options.writer, optimized.times, 1, true);
  const output = resolveCachedAccessor(
    caches.outputs,
    options.writer,
    optimized.values,
    optimized.componentCount,
    false,
    channel.property === 'rotation' ? 'normalized-short' : 'float',
  );
  const sampler = animation.samplers.length;
  animation.samplers.push({ input, output, interpolation: sampled.interpolation });
  animation.channels.push({
    sampler,
    target: {
      node,
      path: channel.property === 'position' ? 'translation' : channel.property,
    },
  });
};

const compileGltfClip = (
  clip: AnimationClip,
  options: GltfAnimationCompileOptions,
  caches: AccessorCaches,
): GltfAnimation | null => {
  const animation: GltfAnimation = {
    name: clip.name,
    samplers: [],
    channels: [],
    extras: {
      ashfoxLoop: clip.loop,
      ashfoxDurationSeconds: clip.durationSeconds,
      ashfoxFps: clip.fps,
    },
  };
  const orderedChannels = Object.values(clip.channels).sort((left, right) =>
    compareText(left.id, right.id),
  );
  for (const channel of orderedChannels) {
    appendGltfAnimationChannel(animation, clip, channel, options, caches);
  }
  return animation.channels.length > 0 ? animation : null;
};

export const compileGltfAnimations = (
  document: ProjectDocument,
  options: GltfAnimationCompileOptions,
): GltfAnimation[] => {
  assertValidatedExportTargetDocument(document as ExportAdaptedDocument, ['glb', 'gltf']);
  assertProjectAnimationsExportable(document, 'gltf.2');
  const caches: AccessorCaches = {
    times: new Map(),
    outputs: new Map(),
  };
  const animations: GltfAnimation[] = [];
  const orderedClips = Object.values(document.animations).sort((left, right) =>
    compareText(left.id, right.id),
  );
  for (const clip of orderedClips) {
    const compiled = compileGltfClip(clip, options, caches);
    if (compiled !== null) animations.push(compiled);
  }
  return animations;
};
