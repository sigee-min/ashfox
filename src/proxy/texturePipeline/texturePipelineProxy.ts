import { collectTextureTargets } from '../../domain/uvTargets';
import { validateTexturePipeline } from '../validators';
import type { TexturePipelinePayload } from '../../spec';
import type { ToolResponse } from '../../types';
import { buildClarificationNextActions, buildTexturePipelineNextActions, collectTextureLabels } from '../nextActionHelpers';
import type { ProxyPipelineDeps } from '../types';
import { runPreviewStep, type PreviewStepData } from '../previewStep';
import type { TexturePipelineResult, TexturePipelineSteps } from './types';
import { attachPreviewResponse } from '../previewResponse';
import { buildPipelineResult } from '../pipelineResult';
import { createTexturePipelineContext, runAssignStep, runPreflightStep, runPresetStep, runTextureApplyStep, runUvStep } from './steps';
import { TEXTURE_PREVIEW_VALIDATE_REASON } from '../../shared/messages';
import { runProxyPipeline } from '../pipelineRunner';
import { getTexturePipelineClarificationQuestions } from '../clarifications';
import { runAutoPlanStep } from './autoPlan';
import { ensureUvUsageForTargets } from '../uvGuardian';
import { applyTextureCleanup } from '../textureCleanup';
import { buildFacePaintPresets, summarizeFacePaintUsage } from './facePaint';
import { loadProjectState } from '../projectState';

export const texturePipelineProxy = async (
  deps: ProxyPipelineDeps,
  payload: TexturePipelinePayload
): Promise<ToolResponse<TexturePipelineResult>> => {
  let clarificationQuestions: string[] = [];
  let shouldPlanOnly = false;
  return runProxyPipeline<TexturePipelinePayload, TexturePipelineResult>(deps, payload, {
    validate: validateTexturePipeline,
    guard: (pipeline) => {
      clarificationQuestions = getTexturePipelineClarificationQuestions(payload);
      shouldPlanOnly = Boolean(payload.planOnly) || clarificationQuestions.length > 0;
      return shouldPlanOnly ? null : pipeline.guardRevision();
    },
    run: async (pipeline) => {
      const steps: TexturePipelineSteps = {};
      const facePaintEntries = Array.isArray(payload.facePaint) ? payload.facePaint : [];
      const hasFacePaint = facePaintEntries.length > 0;
      const autoRecoverEnabled = payload.autoRecover !== false;
      const facePaintAutoRecover = autoRecoverEnabled;
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

      const skipAssignUv = Boolean(payload.plan);
      if (payload.plan) {
        const planRes = await runAutoPlanStep(ctx, payload.plan, {
          planOnly: shouldPlanOnly,
          ifRevision: payload.ifRevision
        });
        if (!planRes.ok) return planRes;
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
        const needsPreflight = Boolean(
          payload.preflight ||
            payload.uv ||
            (payload.textures && payload.textures.length > 0) ||
            (payload.presets && payload.presets.length > 0)
        );
        if (needsPreflight && !ctx.currentUvUsageId) {
          const preflightRes = runPreflightStep(ctx, 'before');
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

        if (hasFacePaint) {
          if (!ctx.currentUvUsageId || !ctx.preflightUsage) {
            const preflightRes = runPreflightStep(ctx, 'before');
            if (!preflightRes.ok) return preflightRes;
          }
          if (!ctx.preflightUsage || !ctx.currentUvUsageId) {
            return pipeline.error({ code: 'invalid_state', message: 'UV preflight did not return usage.' });
          }
          const summary = summarizeFacePaintUsage(facePaintEntries, ctx.preflightUsage);
          const targets = summary.targets;
          const resolved = await ensureUvUsageForTargets({
            deps,
            meta: pipeline.meta,
            targets,
            uvUsageId: ctx.currentUvUsageId,
            usageOverride: ctx.preflightUsage,
            autoRecover: facePaintAutoRecover,
            requireUv: true,
            plan: facePaintAutoRecover
              ? {
                  context: ctx,
                  existingPlan: payload.plan ?? null,
                  ifRevision: payload.ifRevision,
                  reuseExistingTextures: true
                }
              : undefined
          });
          if (!resolved.ok) return resolved;
          ctx.currentUvUsageId = resolved.data.uvUsageId;
          ctx.preflightUsage = resolved.data.usage;
          const projectRes = loadProjectState(deps.service, pipeline.meta, 'summary');
          if (!projectRes.ok) return projectRes;
          const facePaintPresets = buildFacePaintPresets({
            entries: facePaintEntries,
            usage: resolved.data.usage,
            project: projectRes.data
          });
          if (!facePaintPresets.ok) return facePaintPresets;
          if (facePaintPresets.data.presets.length > 0) {
            const presetRes = runPresetStep(
              ctx,
              facePaintPresets.data.presets,
              resolved.data.recovery,
              payload.ifRevision
            );
            if (!presetRes.ok) return presetRes;
            const metaRes = pipeline.wrap(
              deps.service.setProjectMeta({ meta: { facePaint: facePaintEntries }, ifRevision: payload.ifRevision })
            );
            if (!metaRes.ok) return metaRes;
            steps.facePaint = {
              applied: facePaintPresets.data.presets.length,
              materials: facePaintPresets.data.materials,
              textures: facePaintPresets.data.textures,
              uvUsageId: ctx.currentUvUsageId,
              ...(resolved.data.recovery ? { recovery: resolved.data.recovery } : {})
            };
          }
        }

        const textures = payload.textures ?? [];
        const presets = payload.presets ?? [];
        if (textures.length > 0 || presets.length > 0) {
          if (!ctx.currentUvUsageId) {
            const preflightRes = runPreflightStep(ctx, 'before');
            if (!preflightRes.ok) return preflightRes;
          }
          if (!ctx.currentUvUsageId) {
            return pipeline.error({ code: 'invalid_state', message: 'UV preflight did not return usage.' });
          }
          const targets = collectTextureTargets([...textures, ...presets]);
          const resolved = await ensureUvUsageForTargets({
            deps,
            meta: pipeline.meta,
            targets,
            uvUsageId: ctx.currentUvUsageId,
            usageOverride: ctx.preflightUsage,
            autoRecover: autoRecoverEnabled,
            requireUv: true,
            plan: autoRecoverEnabled
              ? {
                  context: ctx,
                  existingPlan: payload.plan ?? null,
                  ifRevision: payload.ifRevision,
                  reuseExistingTextures: true
                }
              : undefined
          });
          if (!resolved.ok) return resolved;
          ctx.currentUvUsageId = resolved.data.uvUsageId;
          ctx.preflightUsage = resolved.data.usage;

          if (textures.length > 0) {
            const applyRes = await runTextureApplyStep(ctx, textures, resolved.data.usage, resolved.data.recovery);
            if (!applyRes.ok) return applyRes;
          }

          if (presets.length > 0) {
            const presetRes = runPresetStep(ctx, presets, resolved.data.recovery, payload.ifRevision);
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
      const nextActions = buildTexturePipelineNextActions({
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

      const extras = nextActions.length > 0 ? { nextActions } : {};
      return attachPreviewResponse({ ...response, ...extras }, previewData);
    }
  });
};
