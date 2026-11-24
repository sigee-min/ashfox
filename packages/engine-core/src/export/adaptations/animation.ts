import { analyzeProjectAnimationCapabilities } from '../../animation/capability';
import type { ExportAdaptedDocument } from '../adapter';
import type { ExportAdaptation, ExportAdaptationReceipt } from '../contract';

type CapabilityAdaptation = ReturnType<
  typeof analyzeProjectAnimationCapabilities
>['clips'][number]['exportAdaptations'][number];

const toExportAdaptation = (adaptation: CapabilityAdaptation): ExportAdaptation => ({
  code: adaptation.code,
  path: adaptation.path,
  message: adaptation.message,
  clipId: adaptation.clipId,
  ...(adaptation.channelId ? { channelId: adaptation.channelId } : {}),
  ...(adaptation.triggerId ? { triggerId: adaptation.triggerId } : {}),
  ...(adaptation.keyframeId ? { keyframeId: adaptation.keyframeId } : {}),
});

export const animationExportAdaptations = (
  document: ExportAdaptedDocument,
): ExportAdaptationReceipt => {
  const adaptations = analyzeProjectAnimationCapabilities(
    document,
    document.formatProfile.id,
  ).clips.flatMap((clip) => clip.exportAdaptations);
  return {
    omitted: adaptations
      .filter((adaptation) => adaptation.disposition === 'omitted')
      .map(toExportAdaptation),
    converted: adaptations
      .filter((adaptation) => adaptation.disposition === 'converted')
      .map(toExportAdaptation),
  };
};
