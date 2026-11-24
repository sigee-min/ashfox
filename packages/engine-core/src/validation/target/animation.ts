import type { ExportAdaptedDocument } from '../../export/adapter';
import { analyzeProjectAnimationCapabilities } from '../../animation/capability';
import type { AnimationEffect } from '../../model';
import { isSceneNodeEffectivelyVisible } from '../../sceneVisibility';
import type { FindingSink } from '../contract';

// Target builders may allocate one sampled frame per duration/fps step for
// each animated channel. The authored compiler has a separate budget, but an
// externally constructed ProjectDocument reaches this boundary too, so keep
// the allocation guard here immediately before capability analysis/building.
const MAX_TARGET_ANIMATION_SAMPLES = 1_000_000;
const MAX_TARGET_ANIMATION_OUTPUT_SCALARS = 8_000_000;

const validateAnimationSamplingBudget = (
  document: ExportAdaptedDocument,
  add: FindingSink,
): void => {
  let totalSamples = 0;
  let totalOutputScalars = 0;
  for (const clip of Object.values(document.animations)) {
    const clipPath = `animations.${clip.id}`;
    const sampleProduct = clip.durationSeconds * clip.fps;
    const sampleCount =
      Number.isFinite(sampleProduct) &&
      sampleProduct >= 0 &&
      sampleProduct <= Number.MAX_SAFE_INTEGER - 1
        ? Math.ceil(sampleProduct) + 1
        : Number.POSITIVE_INFINITY;
    if (!Number.isSafeInteger(sampleCount) || sampleCount > MAX_TARGET_ANIMATION_SAMPLES) {
      add({
        code: 'format.unsupported_data',
        severity: 'error',
        message: 'Animation duration and FPS exceed the bounded target sampling budget.',
        path: `${clipPath}.durationSeconds`,
        clipIds: [clip.id],
        fix: 'Reduce duration or FPS before exporting this target.',
      });
      continue;
    }

    const animatedChannels = Object.values(clip.channels).filter(
      (channel) => channel.keys.length > 0,
    );
    if (animatedChannels.length === 0) continue;
    if (sampleCount > MAX_TARGET_ANIMATION_SAMPLES / animatedChannels.length) {
      add({
        code: 'format.unsupported_data',
        severity: 'error',
        message: 'Animated channels exceed the bounded target sampling budget.',
        path: `${clipPath}.channels`,
        clipIds: [clip.id],
        fix: 'Reduce animated channels, duration, or FPS before exporting this target.',
      });
      continue;
    }
    totalSamples += sampleCount * animatedChannels.length;
    const outputScalars = animatedChannels.reduce(
      (sum, channel) => sum + sampleCount * (channel.property === 'rotation' ? 4 : 3),
      0,
    );
    if (
      !Number.isSafeInteger(outputScalars) ||
      outputScalars > MAX_TARGET_ANIMATION_OUTPUT_SCALARS ||
      totalOutputScalars > MAX_TARGET_ANIMATION_OUTPUT_SCALARS - outputScalars
    ) {
      add({
        code: 'format.unsupported_data',
        severity: 'error',
        message: 'Animation output allocations exceed the bounded target output budget.',
        path: `${clipPath}.channels`,
        clipIds: [clip.id],
        fix: 'Reduce animated channels, duration, or FPS before exporting this target.',
      });
      continue;
    }
    totalOutputScalars += outputScalars;
    if (totalSamples > MAX_TARGET_ANIMATION_SAMPLES) {
      add({
        code: 'format.unsupported_data',
        severity: 'error',
        message: 'Project animation sampling exceeds the bounded target budget.',
        path: 'animations',
        clipIds: [clip.id],
        fix: 'Reduce animation duration, FPS, or channel count before exporting this target.',
      });
      return;
    }
  }
};

const targetNameFor = (
  document: ExportAdaptedDocument,
): 'glTF' | 'Bedrock' | 'GeckoLib 5' | null => {
  switch (document.formatProfile.id) {
    case 'gltf.2':
      return 'glTF';
    case 'minecraft.bedrock':
      return 'Bedrock';
    case 'minecraft.java.geckolib5':
      return 'GeckoLib 5';
    case 'minecraft.java_block':
      return null;
  }
};

/**
 * Actor and glTF builders intentionally lower only visible scene nodes.  A
 * transform channel with keys targeting a hidden (or missing) node would
 * otherwise disappear from the emitted animation without a target-level
 * diagnostic.  Keep this check at the target validation boundary so Java's
 * documented static-animation adaptation remains unchanged.
 */
const validateAnimationTargetVisibility = (
  document: ExportAdaptedDocument,
  add: FindingSink,
): void => {
  const targetName = targetNameFor(document);
  if (targetName === null) return;
  for (const clip of Object.values(document.animations)) {
    for (const channel of Object.values(clip.channels)) {
      if (channel.keys.length === 0) continue;
      const path = `animations.${clip.id}.channels.${channel.id}.targetNodeId`;
      const target = document.scene.nodes[channel.targetNodeId];
      if (target === undefined) {
        add({
          code: 'format.unsupported_data',
          severity: 'error',
          message: `${targetName} animation channel target "${channel.targetNodeId}" does not resolve to a scene node and would be omitted.`,
          path,
          entityIds: [channel.targetNodeId],
          clipIds: [clip.id],
        });
        continue;
      }
      if (!isSceneNodeEffectivelyVisible(document, target.id)) {
        add({
          code: 'format.unsupported_data',
          severity: 'error',
          message: `${targetName} animation channel target "${channel.targetNodeId}" is hidden and would be omitted.`,
          path,
          entityIds: [target.id],
          clipIds: [clip.id],
        });
      }
    }
  }
};

/**
 * Bedrock and GeckoLib lower locator-bearing sound/particle effects only when
 * the locator survives the visible scene projection.  A hidden locator is
 * authored animation data, not an optional hint, so reject it at the target
 * boundary instead of letting the trigger builder filter it out.
 */
const validateAnimationLocatorVisibility = (
  document: ExportAdaptedDocument,
  add: FindingSink,
): void => {
  const targetName = targetNameFor(document);
  if (targetName === null || targetName === 'glTF') return;
  for (const clip of Object.values(document.animations)) {
    for (const trigger of Object.values(clip.triggers)) {
      if (trigger.type !== 'sound' && trigger.type !== 'particle') continue;
      for (const [keyIndex, keyframe] of trigger.keys.entries()) {
        const values = Array.isArray(keyframe.value) ? keyframe.value : [keyframe.value];
        for (const [effectIndex, value] of values.entries()) {
          const effect = value as AnimationEffect;
          if (effect.locatorId === undefined) continue;
          const locator = document.scene.nodes[effect.locatorId];
          if (locator !== undefined && isSceneNodeEffectivelyVisible(document, locator.id))
            continue;
          const valuePath = Array.isArray(keyframe.value) ? `.value[${effectIndex}]` : '.value';
          add({
            code: 'format.unsupported_data',
            severity: 'error',
            message: `${targetName} ${trigger.type} effect locator "${effect.locatorId}" is hidden and would be omitted.`,
            path: `animations.${clip.id}.triggers.${trigger.id}.keys[${keyIndex}]${valuePath}.locatorId`,
            entityIds: [effect.locatorId],
            clipIds: [clip.id],
          });
        }
      }
    }
  }
};

export const validateAnimationExportCapabilities = (
  document: ExportAdaptedDocument,
  add: FindingSink,
): void => {
  validateAnimationSamplingBudget(document, add);
  validateAnimationTargetVisibility(document, add);
  validateAnimationLocatorVisibility(document, add);
  const report = analyzeProjectAnimationCapabilities(document, document.formatProfile.id);
  for (const clip of report.clips) {
    for (const issue of clip.exportIssues) {
      add({
        code:
          issue.code === 'timestamp_collision' ? 'animation.key_order' : 'format.unsupported_data',
        severity: 'error',
        message: issue.message,
        path: issue.path,
        clipIds: [issue.clipId],
      });
    }
  }
};
