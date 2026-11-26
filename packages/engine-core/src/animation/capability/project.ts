import { compareText } from '../../stableOrder';
import type { AnimationClip, ProjectDocument } from '../../model';
import { analyzeAnimationExport, analyzeAnimationExportAdaptations } from './exportAnalysis';
import { analyzeAnimationPreview } from './preview';
import type {
  AnimationExportIssue,
  AnimationExportTarget,
  AnimationPreviewIssue,
  AnimationPreviewIssueCode,
  ClipAnimationCapability,
  ProjectAnimationCapabilityReport,
} from './types';

const NON_TRANSFORM_PREVIEW_ISSUES = new Set<AnimationPreviewIssueCode>([
  'sound_trigger',
  'particle_trigger',
  'timeline_trigger',
]);

export const blockingAnimationPreviewIssues = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
): readonly AnimationPreviewIssue[] => {
  if (targetId === 'minecraft.java_block') return [];
  const omittedByTarget = new Set<string>(
    analyzeAnimationExportAdaptations(clip, targetId)
      .filter((item) => item.disposition === 'omitted')
      .map((item) => item.code),
  );
  return analyzeAnimationPreview(clip).filter(
    (item) => !NON_TRANSFORM_PREVIEW_ISSUES.has(item.code) && !omittedByTarget.has(item.code),
  );
};

/**
 * The workbench previews the canonical asset, before any target adapter has
 * converted or omitted data.  Its review contract must therefore not depend
 * on a delivery format.
 */
export const blockingCanonicalAnimationPreviewIssues = (
  clip: AnimationClip,
): readonly AnimationPreviewIssue[] =>
  analyzeAnimationPreview(clip).filter((item) => !NON_TRANSFORM_PREVIEW_ISSUES.has(item.code));

export const analyzeClipAnimationCapability = (
  clip: AnimationClip,
  targetId: AnimationExportTarget,
): ClipAnimationCapability => {
  const previewIssues = blockingAnimationPreviewIssues(clip, targetId);
  const exportIssues = analyzeAnimationExport(clip, targetId);
  const exportAdaptations = analyzeAnimationExportAdaptations(clip, targetId);
  return {
    clipId: clip.id,
    previewable: previewIssues.length === 0,
    exportable: exportIssues.length === 0,
    previewIssues,
    exportIssues,
    exportAdaptations,
  };
};

export const analyzeProjectAnimationCapabilities = (
  document: ProjectDocument,
  targetId: AnimationExportTarget,
): ProjectAnimationCapabilityReport => {
  const clips = Object.values(document.animations)
    .sort((left, right) => compareText(left.id, right.id))
    .map((clip) => analyzeClipAnimationCapability(clip, targetId));
  return {
    targetId,
    previewable: clips.every((clip) => clip.previewable),
    exportable: clips.every((clip) => clip.exportable),
    clips,
  };
};

export class AnimationExportCapabilityError extends Error {
  readonly code = 'animation.export_unsupported' as const;

  constructor(readonly issues: readonly AnimationExportIssue[]) {
    const first = issues[0];
    super(
      first
        ? `${first.message} (${first.code} at ${first.path})`
        : 'The animation cannot be exported by the selected target.',
    );
    this.name = 'AnimationExportCapabilityError';
  }
}

export const assertProjectAnimationsExportable = (
  document: ProjectDocument,
  targetId: AnimationExportTarget,
): void => {
  const report = analyzeProjectAnimationCapabilities(document, targetId);
  const issues = report.clips.flatMap((clip) => clip.exportIssues);
  if (issues.length > 0) {
    throw new AnimationExportCapabilityError(issues);
  }
};
