import { compareText } from '../../stableOrder';
import { assertProjectAnimationsExportable } from '../../animation/capability';
import type { AnimationClip } from '../../model';
import { assertValidatedExportTargetDocument } from '../pipeline/validate';
import type { ExportAdaptedDocument } from '../adapter';
import { effectivelyVisibleSceneNodeIds } from '../../sceneVisibility';
import { compileMinecraftAnimationChannel } from './channel';
import { minecraftActorAnimationNames } from './names';
import { compileMinecraftAnimationTriggers } from './triggers';
import type {
  MinecraftActorAnimation,
  MinecraftActorAnimationFile,
  MinecraftAnimationCompileOptions,
  MinecraftBoneAnimation,
} from './types';
import { serializeAnimationScalar } from './values';

const animatedBone = (
  document: ExportAdaptedDocument,
  targetNodeId: string,
  visibleNodeIds: ReadonlySet<string>,
) => {
  const target = document.scene.nodes[targetNodeId];
  if (!target)
    throw new Error(
      `Validated Minecraft animation target "${targetNodeId}" is missing from the scene.`,
    );
  if (target.kind !== 'bone')
    throw new Error(`Validated Minecraft animation target "${targetNodeId}" is not a bone.`);
  if (!visibleNodeIds.has(target.id))
    throw new Error(`Validated Minecraft animation target "${targetNodeId}" is hidden.`);
  return target;
};

const compileClipBones = (
  document: ExportAdaptedDocument,
  clip: AnimationClip,
  options: MinecraftAnimationCompileOptions,
  visibleNodeIds: ReadonlySet<string>,
): Record<string, MinecraftBoneAnimation> => {
  const bones: Record<string, MinecraftBoneAnimation> = {};
  const channels = Object.values(clip.channels).sort((left, right) =>
    compareText(left.id, right.id),
  );
  for (const channel of channels) {
    const target = animatedBone(document, channel.targetNodeId, visibleNodeIds);
    const bone = bones[target.name] ?? {};
    const compiled = compileMinecraftAnimationChannel(channel, options);
    if (channel.property === 'rotation' && channel.rotationSpace === 'entity') {
      bone.relative_to = options.dialect === 'bedrock' ? { rotation: 'entity' } : 'entity';
    }
    bone[channel.property] = compiled;
    bones[target.name] = bone;
  }
  return bones;
};

const clipLoop = (clip: AnimationClip): Pick<MinecraftActorAnimation, 'loop'> => {
  if (clip.loop === 'loop') return { loop: true as const };
  if (clip.loop === 'hold_on_last_frame') return { loop: 'hold_on_last_frame' as const };
  return {};
};

const clipPlayback = (clip: AnimationClip) => ({
  ...(clip.startDelay ? { start_delay: clip.startDelay.source } : {}),
  ...(clip.loopDelay ? { loop_delay: clip.loopDelay.source } : {}),
  ...(clip.animationTimeUpdate ? { anim_time_update: clip.animationTimeUpdate.source } : {}),
  ...(clip.blendWeight !== undefined
    ? {
        blend_weight: serializeAnimationScalar(clip.blendWeight, false),
      }
    : {}),
  ...(clip.overridePreviousAnimation !== undefined
    ? {
        override_previous_animation: clip.overridePreviousAnimation,
      }
    : {}),
});

const compileClip = (
  document: ExportAdaptedDocument,
  clip: AnimationClip,
  options: MinecraftAnimationCompileOptions,
  visibleNodeIds: ReadonlySet<string>,
): MinecraftActorAnimation => {
  const bones = compileClipBones(document, clip, options, visibleNodeIds);
  return {
    ...clipLoop(clip),
    animation_length: clip.durationSeconds,
    ...clipPlayback(clip),
    ...(Object.keys(bones).length > 0 ? { bones } : {}),
    ...compileMinecraftAnimationTriggers(
      document,
      Object.values(clip.triggers).sort((left, right) => compareText(left.id, right.id)),
      options,
      visibleNodeIds,
    ),
  };
};

export const buildMinecraftActorAnimation = (
  document: ExportAdaptedDocument,
  options: MinecraftAnimationCompileOptions,
): MinecraftActorAnimationFile => {
  assertValidatedExportTargetDocument(document, ['bedrock', 'geckolib5']);
  assertProjectAnimationsExportable(document, document.formatProfile.id);
  const visibleNodeIds = effectivelyVisibleSceneNodeIds(document);
  const animationNames = minecraftActorAnimationNames(document);
  const animations: Record<string, MinecraftActorAnimation> = {};
  for (const clip of Object.values(document.animations).sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    animations[animationNames.get(clip.id) ?? clip.name] = compileClip(
      document,
      clip,
      options,
      visibleNodeIds,
    );
  }
  return {
    format_version: options.formatVersion,
    animations,
  };
};
