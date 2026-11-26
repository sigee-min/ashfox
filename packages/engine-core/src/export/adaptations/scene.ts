import { compareText } from '../../stableOrder';
import type { ExportAdaptedDocument } from '../adapter';
import type { ExportAdaptation } from '../contract';

export const sceneExportAdaptations = (
  document: ExportAdaptedDocument,
): readonly ExportAdaptation[] =>
  document.formatProfile.id === 'minecraft.java_block'
    ? Object.values(document.scene.nodes)
        .filter((node) => node.kind === 'locator')
        .sort((left, right) => compareText(left.id, right.id))
        .map((node) => ({
          code: 'scene.locator_unsupported',
          path: `scene.nodes.${node.id}`,
          message:
            'Java block models have no locator contract, so this export omits the locator while the ashfox project keeps it.',
        }))
    : [];

export const sceneExportConversions = (
  document: ExportAdaptedDocument,
): readonly ExportAdaptation[] => {
  const translation = document.deliveryAdaptation?.sceneTranslation;
  if (!translation || translation.every((value) => Math.abs(value) < 1e-9)) {
    return [];
  }
  return [
    {
      code: 'scene.recentered_for_java_block',
      path: 'scene',
      message: `Java block delivery recenters the compiled scene by ${translation
        .map((value) => Number(value.toFixed(6)))
        .join(', ')} without changing the canonical project.`,
    },
  ];
};
