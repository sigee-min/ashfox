import { compareText } from '../../stableOrder';
import type { ExportAdaptedDocument } from '../adapter';
import { minecraftActorAnimationNames } from './names';
import type { ExportAdaptation } from '../contract';

export const minecraftNameAdaptations = (
  document: ExportAdaptedDocument,
): readonly ExportAdaptation[] => {
  if (
    document.formatProfile.id !== 'minecraft.bedrock' &&
    document.formatProfile.id !== 'minecraft.java.geckolib5'
  ) {
    return [];
  }
  const names = minecraftActorAnimationNames(document);
  return Object.values(document.animations)
    .sort((left, right) => compareText(left.id, right.id))
    .flatMap((clip) => {
      const exportedName = names.get(clip.id);
      return exportedName && exportedName !== clip.name
        ? [
            {
              code: 'animation.name_normalized',
              path: `animations.${clip.id}.name`,
              message:
                `The export converts animation name "${clip.name}" to ` +
                `Minecraft identifier "${exportedName}" without changing the ashfox project.`,
              clipId: clip.id,
            },
          ]
        : [];
    });
};
