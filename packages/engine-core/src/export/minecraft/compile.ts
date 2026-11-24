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

const compileClip = (
  document: ExportAdaptedDocument,
  clip: AnimationClip,
  options: MinecraftAnimationCompileOptions,
  visibleNodeIds: ReadonlySet<string>,
): MinecraftActorAnimation => {
  const bones: Record<string, MinecraftBoneAnimation> = {};
  const channels = Object.values(clip.channels).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  for (const channel of channels) {
    const target = document.scene.nodes[channel.targetNodeId];
    if (!target)
      throw new Error(
        `Validated Minecraft animation target "${channel.targetNodeId}" is missing from the scene.`,
      );
    if (target.kind !== 'bone')
      throw new Error(
        `Validated Minecraft animation target "${channel.targetNodeId}" is not a bone.`,
      );
    if (!visibleNodeIds.has(target.id))
      throw new Error(`Validated Minecraft animation target "${channel.targetNodeId}" is hidden.`);
    const bone = bones[target.name] ?? {};
    const compiled = compileMinecraftAnimationChannel(channel, options);
    if (channel.property === 'rotation' && channel.rotationSpace === 'entity') {
      bone.relative_to = options.dialect === 'bedrock' ? { rotation: 'entity' } : 'entity';
    }
    bone[channel.property] = compiled;
    bones[target.name] = bone;
  }

  return {
    ...(clip.loop === 'loop'
      ? { loop: true as const }
      : clip.loop === 'hold_on_last_frame'
        ? { loop: 'hold_on_last_frame' as const }
        : {}),
    animation_length: clip.durationSeconds,
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
    ...(Object.keys(bones).length > 0 ? { bones } : {}),
    ...compileMinecraftAnimationTriggers(
      document,
      Object.values(clip.triggers).sort((left, right) => left.id.localeCompare(right.id)),
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
    left.id.localeCompare(right.id),
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
