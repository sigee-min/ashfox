import { collectTextureTargets } from '../../domain/uv/targets';
import type { TexturePipelinePayload } from '../../spec';
import type { ToolResponse } from '../../types';
import {
  buildClarificationNextActions,
  buildTexturePipelineNextActions,
  collectTextureLabels,
  dedupeNextActions
} from '../nextActionHelpers';
import type { ProxyPipelineDeps } from '../types';
import { runPreviewStep, type PreviewStepData } from '../previewStep';
import type { TexturePipelineResult, TexturePipelineSteps } from './types';
import { attachPreviewResponse } from '../previewResponse';
import { buildPipelineResult } from '../pipelineResult';
import {
  createTexturePipelineContext,
  ensurePreflightUsage,
  ensureUvUsageForTargetsInContext,
  runAssignStep,
  runPreflightStep,
  runPresetStep,
  runTextureApplyStep,
  runUvStep
} from './steps';
import { TEXTURE_FACE_PAINT_CONFLICT, TEXTURE_PREVIEW_VALIDATE_REASON } from '../../shared/messages';
import type { ProxyPipeline } from '../pipeline';
import { applyTextureCleanup } from '../textureCleanup';
import { adjustPresetSpecsForRecovery, adjustTextureSpecsForRecovery } from './sizeAdjust';
import { runPlanAndFacePaint } from './planAndPaint';
import { collectExplicitTextureRefs, resolveFacePaintConflicts } from './conflictHelpers';
import { summarizeFacePaintUsage } from './facePaint';
import { runFacePaintWorkflow } from './facePaintWorkflow';

export const runTexturePipeline = async (args: {
  deps: ProxyPipelineDeps;
  payload: TexturePipelinePayload;
  pipeline: ProxyPipeline;
  shouldPlanOnly: boolean;
  clarificationQuestions: string[];
}): Promise<ToolResponse<TexturePipelineResult>> => {
  const { deps, payload, pipeline, shouldPlanOnly, clarificationQuestions } = args;
  const steps: TexturePipelineSteps = {};
  const autoStage = payload.autoStage !== false;
  const facePaintEntries = Array.isArray(payload.facePaint) ? payload.facePaint : [];
  const hasFacePaint = facePaintEntries.length > 0;
  const ctx = createTexturePipelineContext({
    deps,
    pipeline,
    steps,
    includePreflight: Boolean(payload.preflight),
    includeUsage:
      Boolean(payload.preflight?.includeUsage) ||
      hasFacePaint ||
      Boolean(payload.textures?.length || payload.presets?.length)
  });

  const skipAssignUv = shouldPlanOnly;
  const planAndPaintRes = await runPlanAndFacePaint({
    ctx,
    plan: payload.plan,
    planOnly: shouldPlanOnly,
    ifRevision: payload.ifRevision,
    facePaintEntries: autoStage ? [] : facePaintEntries,
    conflictSources: { textures: payload.textures, presets: payload.presets },
    reuseExistingTextures: true,
    resolutionOverride: payload.plan?.resolution ?? undefined
  });
  if (!planAndPaintRes.ok) return planAndPaintRes;

  if (!autoStage) {
    const facePaintTextures = ctx.steps.facePaint?.textures ?? [];
    const facePaintTextureIds = ctx.steps.facePaint?.textureIds ?? [];
    if (!shouldPlanOnly && (facePaintTextures.length > 0 || facePaintTextureIds.length > 0)) {
      const explicit = collectExplicitTextureRefs(payload.textures, payload.presets);
      const overlaps = resolveFacePaintConflicts(
        { names: facePaintTextures, ids: facePaintTextureIds },
        explicit
      );
      if (overlaps.length > 0) {
        return pipeline.error({
          code: 'invalid_payload',
          message: TEXTURE_FACE_PAINT_CONFLICT(overlaps.join(', '))
        });
      }
    }
  }

  if (!shouldPlanOnly && !skipAssignUv && payload.assign && payload.assign.length > 0) {
    const assignRes = runAssignStep(ctx, payload.assign, payload.ifRevision);
    if (!assignRes.ok) return assignRes;
  }

  if (payload.preflight) {
    const preflightRes = runPreflightStep(ctx, 'before');
    if (!preflightRes.ok) return preflightRes;
  }

  if (!shouldPlanOnly) {
    const needsPreflight = Boolean(payload.preflight || payload.uv);
    if (needsPreflight) {
      const preflightRes = ensurePreflightUsage(ctx, 'before', { requireUsage: false });
      if (!preflightRes.ok) return preflightRes;
    }

    if (!skipAssignUv && payload.uv) {
      const uvRes = runUvStep(ctx, payload.uv.assignments, payload.ifRevision);
      if (!uvRes.ok) return uvRes;

      if (ctx.includePreflight) {
        const preflightRes = runPreflightStep(ctx, 'after');
        if (!preflightRes.ok) return preflightRes;
      }
    }

    if (autoStage && facePaintEntries.length > 0) {
      const mutatedBeforeFacePaint = Boolean(ctx.steps.plan?.applied || ctx.steps.assign || ctx.steps.uv);
      if (mutatedBeforeFacePaint) {
        const preflightRes = runPreflightStep(ctx, 'before');
        if (!preflightRes.ok) return preflightRes;
      } else {
        const preflightRes = ensurePreflightUsage(ctx, 'before', { requireUsage: true });
        if (!preflightRes.ok) return preflightRes;
      }

      if (ctx.preflightUsage) {
        const summary = summarizeFacePaintUsage(facePaintEntries, ctx.preflightUsage);
        const explicit = collectExplicitTextureRefs(payload.textures, payload.presets);
        const overlaps = resolveFacePaintConflicts(
          { names: Array.from(summary.targets.names), ids: Array.from(summary.targets.ids) },
          explicit
        );
        if (overlaps.length > 0) {
          return pipeline.error({
            code: 'invalid_payload',
            message: TEXTURE_FACE_PAINT_CONFLICT(overlaps.join(', '))
          });
        }
      }

      const facePaintRes = await runFacePaintWorkflow({
        ctx,
        entries: facePaintEntries,
        plan: {
          existingPlan: payload.plan ?? null,
          ifRevision: payload.ifRevision,
          reuseExistingTextures: true
        },
        ifRevision: payload.ifRevision,
        resolutionOverride: payload.plan?.resolution ?? undefined
      });
      if (!facePaintRes.ok) return facePaintRes;
      if (facePaintRes.data.applied > 0) {
        ctx.steps.facePaint = {
          applied: facePaintRes.data.applied,
          materials: facePaintRes.data.materials,
          textures: facePaintRes.data.textures,
          ...(facePaintRes.data.textureIds.length > 0 ? { textureIds: facePaintRes.data.textureIds } : {}),
          ...(facePaintRes.data.uvUsageId ? { uvUsageId: facePaintRes.data.uvUsageId } : {}),
          ...(facePaintRes.data.recovery ? { recovery: facePaintRes.data.recovery } : {})
        };
      }
    }

    const effectiveTextures = payload.textures ?? [];
    const effectivePresets = payload.presets ?? [];
    if (effectiveTextures.length > 0 || effectivePresets.length > 0) {
      const targets = collectTextureTargets([...effectiveTextures, ...effectivePresets]);
      const resolved = await ensureUvUsageForTargetsInContext(ctx, {
        targets,
        requireUv: true,
        plan: {
          context: ctx,
          existingPlan: payload.plan ?? null,
          ifRevision: payload.ifRevision,
          reuseExistingTextures: true
        }
      });
      if (!resolved.ok) return resolved;

      if (effectiveTextures.length > 0) {
        const adjustedTextures = adjustTextureSpecsForRecovery(
          effectiveTextures,
          resolved.data.usage,
          resolved.data.recovery
        );
        const applyRes = await runTextureApplyStep(
          ctx,
          adjustedTextures,
          resolved.data.usage,
          resolved.data.recovery
        );
        if (!applyRes.ok) return applyRes;
      }

      if (effectivePresets.length > 0) {
        const adjustedPresets = adjustPresetSpecsForRecovery(
          effectivePresets,
          resolved.data.usage,
          resolved.data.recovery
        );
        const presetRes = runPresetStep(ctx, adjustedPresets, resolved.data.recovery, payload.ifRevision);
        if (!presetRes.ok) return presetRes;
      }
    }
  }

  if (!shouldPlanOnly && payload.cleanup?.delete && payload.cleanup.delete.length > 0) {
    const cleanupRes = applyTextureCleanup(
      deps,
      pipeline.meta,
      payload.cleanup.delete,
      payload.cleanup.force === true,
      payload.ifRevision
    );
    if (!cleanupRes.ok) return cleanupRes;
    steps.cleanup = cleanupRes.data;
  }

  let previewData: PreviewStepData | null = null;
  if (payload.preview) {
    const previewRes = runPreviewStep(deps.service, payload.preview, pipeline.meta);
    if (!previewRes.ok) return previewRes;
    steps.preview = previewRes.data.structured;
    previewData = previewRes.data;
  }

  if (shouldPlanOnly) {
    const resultExtras: { applied: false; planOnly: true; uvUsageId?: string } = {
      applied: false,
      planOnly: true,
      ...(ctx.currentUvUsageId ? { uvUsageId: ctx.currentUvUsageId } : {})
    };
    const response = pipeline.ok(buildPipelineResult(steps, resultExtras));
    const nextActions = buildClarificationNextActions({ questions: clarificationQuestions });
    const extras = nextActions.length > 0 ? { nextActions } : {};
    return attachPreviewResponse({ ...response, ...extras }, previewData);
  }

  const resultExtras: { applied: true; uvUsageId?: string } = {
    applied: true,
    ...(ctx.currentUvUsageId ? { uvUsageId: ctx.currentUvUsageId } : {})
  };
  const response = pipeline.ok(buildPipelineResult(steps, resultExtras));

  const didPaint = Boolean(payload.textures?.length || payload.presets?.length || payload.facePaint?.length);
  const didAssign = Boolean(payload.assign && payload.assign.length > 0);
  const didPreview = Boolean(payload.preview);

  const textureLabels = collectTextureLabels([...(payload.textures ?? []), ...(payload.presets ?? [])]);
  const baseActions = buildTexturePipelineNextActions({
    textureLabels,
    didPaint,
    didAssign,
    didPreview,
    assign: {
      includeAssignTool: false,
      includeGuide: true,
      priorityBase: 1
    },
    preview: {
      reason: TEXTURE_PREVIEW_VALIDATE_REASON,
      priorityBase: 10
    }
  });
  const nextActions = dedupeNextActions(baseActions);
  const extras = nextActions.length > 0 ? { nextActions } : {};
  return attachPreviewResponse({ ...response, ...extras }, previewData);
};
