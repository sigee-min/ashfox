import type { AnimationClip } from '../../model';
import { analyzeGltfClip, analyzeGltfClipAdaptations } from './gltfExport';
import { analyzeMinecraftClip } from './minecraftExport';
import { exportAdaptation } from './shared';
import type {
  AnimationExportAdaptation,
  AnimationExportIssue,
  AnimationExportTarget,
} from './types';

export const analyzeAnimationExport = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
): readonly AnimationExportIssue[] => {
  switch (targetId) {
    case 'minecraft.java_block':
      return [];
    case 'minecraft.bedrock':
    case 'minecraft.java.geckolib5':
      return analyzeMinecraftClip(clip, targetId);
    case 'gltf.2':
      return analyzeGltfClip(clip, targetId);
  }
};

export const analyzeAnimationExportAdaptations = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
): readonly AnimationExportAdaptation[] => {
  switch (targetId) {
    case 'minecraft.bedrock':
    case 'minecraft.java.geckolib5':
      return [];
    case 'minecraft.java_block':
      return [
        exportAdaptation(
          targetId,
          clip,
          'omitted',
          'animations_unsupported',
          `animations.${clip.id}`,
          'Java block models are static, so this export omits the animation clip while the ashfox project keeps it.',
        ),
      ];
    case 'gltf.2':
      return analyzeGltfClipAdaptations(clip, targetId);
  }
};
