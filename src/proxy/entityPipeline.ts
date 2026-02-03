import { EntityPipelinePayload } from '../spec';
import { collectTextureTargets } from '../domain/uv/targets';
import { applyTextureSpecSteps, createApplyReport } from './apply';
import { buildPipelineResult } from './pipelineResult';
import { validateEntityPipeline } from './validators';
import type { ProxyPipelineDeps } from './types';
import type { ToolResponse } from '../types';
import { err } from '../shared/tooling/toolResponse';
import { ensureProjectAndLoadProject, resolveEnsureProjectPayload, requireProjectFormat } from './ensureProject';
import { applyEntityAnimations } from './animationStep';
import type { EntityModelStageResult, EntityPipelineResult, EntityPipelineSteps } from './entityPipeline/types';
import type { ModelPipelineStage } from '../spec';
import { runProxyPipeline } from './pipelineRunner';
import { PROXY_FORMAT_NOT_IMPLEMENTED, TEXTURE_FACE_PAINT_CONFLICT } from '../shared/messages';
import {
  buildClarificationNextActions,
  buildValidateFindingsNextActions,
  dedupeNextActions
} from './nextActionHelpers';
import { getEntityPipelineClarificationQuestions } from './clarifications';
import { applyTextureCleanup } from './textureCleanup';
import {
  createTexturePipelineContext,
  ensurePreflightUsage,
  ensureUvUsageForTargetsInContext,
  runPreflightStep
} from './texturePipeline/steps';
import type { TexturePipelineSteps } from './texturePipeline/types';
import { adjustTextureSpecsForRecovery } from './texturePipeline/sizeAdjust';
import { decidePlanOnly } from './planOnly';
import { runPlanAndFacePaint } from './texturePipeline/planAndPaint';
import { runPreviewStep, runPreviewStepStructured, type PreviewStepData } from './previewStep';
import { attachPreviewResponse } from './previewResponse';
import { resolveStageCheckFlags, runFinalPreviewValidate } from './previewChecks';
import { runModelStages } from './modelPipeline/runStages';
import { collectExplicitTextureRefs, resolveFacePaintConflicts } from './texturePipeline/conflictHelpers';
import { summarizeFacePaintUsage } from './texturePipeline/facePaint';
import { runFacePaintWorkflow } from './texturePipeline/facePaintWorkflow';

export const entityPipelineProxy = async (
  deps: ProxyPipelineDeps,
  payload: EntityPipelinePayload
): Promise<ToolResponse<EntityPipelineResult>> => {
  const planDecision = decidePlanOnly(payload.planOnly, getEntityPipelineClarificationQuestions(payload));
  const clarificationQuestions = planDecision.questions;
  const shouldPlanOnly = planDecision.shouldPlanOnly;
  return runProxyPipeline<EntityPipelinePayload, EntityPipelineResult>(deps, payload, {
    validate: (payloadValue, limits) => {
      const v = validateEntityPipeline(payloadValue, limits);
      if (!v.ok) return v;
      if (payloadValue.format !== 'geckolib') {
        return err('not_implemented', PROXY_FORMAT_NOT_IMPLEMENTED(payloadValue.format));
      }
      return v;
    },
    guard: (pipeline) => {
      return shouldPlanOnly ? null : pipeline.guardRevision();
    },
    run: async (pipeline) => {
      const steps: EntityPipelineSteps = {};
      const format = payload.format;
      const targetVersion = payload.targetVersion ?? 'v4';
      const facePaintEntries = Array.isArray(payload.facePaint) ? payload.facePaint : [];
      const autoStage = payload.autoStage !== false;

      if (shouldPlanOnly) {
        const response = pipeline.ok(
          buildPipelineResult(steps, { applied: false, planOnly: true, format, targetVersion })
        );
        const nextActions = buildClarificationNextActions({ questions: clarificationQuestions });
        return nextActions.length > 0 ? { ...response, nextActions } : response;
      }

      let effectiveRevision = payload.ifRevision;
      const ensurePayload = resolveEnsureProjectPayload(
        payload.ensureProject,
        { format: 'geckolib' },
        effectiveRevision
      );
      const needsFull = Boolean(
        payload.model ||
          (payload.modelStages && payload.modelStages.length > 0) ||
          (payload.animations && payload.animations.length > 0)
      );
      const stateRes = ensureProjectAndLoadProject({
        service: deps.service,
        meta: pipeline.meta,
        ensurePayload,
        detail: needsFull ? 'full' : 'summary',
        includeUsage: false,
        refreshRevision: Boolean(ensurePayload)
      });
      if (!stateRes.ok) return stateRes;
      if (stateRes.data.ensure) {
        steps.project = stateRes.data.ensure;
      }
      if (stateRes.data.revision) effectiveRevision = stateRes.data.revision;
      const formatError = requireProjectFormat(
        stateRes.data.project.format,
        'geckolib',
        pipeline.meta,
        deps.service,
        'entity_pipeline'
      );
      if (formatError) return formatError;
      let currentProject = stateRes.data.project;
      const modelStages = resolveEntityModelStages(payload);
      if (modelStages.length > 0) {
        const isStaged = Boolean(payload.modelStages && payload.modelStages.length > 0);
        const stageChecks = resolveStageCheckFlags({
          preview: payload.preview,
          validate: payload.validate,
          stagePreview: payload.stagePreview,
          stageValidate: payload.stageValidate,
          staged: isStaged
        });
        const defaultMode = payload.mode ?? 'merge';
        const normalizedStages = modelStages.map((stage) => {
          const stageMode = stage.mode ?? defaultMode;
          const stageDeleteOrphans =
            stage.deleteOrphans ?? (isStaged ? false : payload.deleteOrphans ?? stageMode === 'replace');
          return { ...stage, mode: stageMode, deleteOrphans: stageDeleteOrphans };
        });
        const stageRun = await runModelStages({
          deps,
          pipeline,
          stages: normalizedStages,
          project: stateRes.data.project,
          revision: effectiveRevision ?? stateRes.data.project.revision,
          planOnly: false,
          includeOps: false,
          stageChecks,
          stageCheckRunners: {
            preview: () => runPreviewStepStructured(deps.service, payload.preview!, pipeline.meta),
            validate: () => pipeline.wrap(deps.service.validate({}))
          }
        });
        if (!stageRun.ok) return stageRun;
        effectiveRevision = stageRun.data.revision;
        currentProject = stageRun.data.project;
        if (stageRun.data.stageResults.some((stage) => !stage.report)) {
          return pipeline.error({ code: 'unknown', message: 'Stage report missing after model apply.' });
        }
        const stageResults = stageRun.data.stageResults as EntityModelStageResult[];

        if (payload.modelStages && payload.modelStages.length > 0) {
          steps.modelStages = stageResults;
        } else if (stageResults.length === 1) {
          steps.model = {
            applied: true,
            plan: stageResults[0].plan,
            report: stageResults[0].report,
            ...(stageResults[0].warnings ? { warnings: stageResults[0].warnings } : {})
          };
        }
      }
      const textureSteps: TexturePipelineSteps = {};
      const textureCtx = createTexturePipelineContext({
        deps,
        pipeline,
        steps: textureSteps,
        includePreflight: false,
        includeUsage: true
      });

      const attachTextureSteps = () => {
        if (textureSteps.plan) steps.texturePlan = textureSteps.plan;
        if (textureSteps.presets) steps.presets = textureSteps.presets;
      };

      const planRes = await runPlanAndFacePaint({
        ctx: textureCtx,
        plan: payload.texturePlan,
        planOnly: false,
        ifRevision: effectiveRevision,
        facePaintEntries: autoStage ? [] : facePaintEntries,
        conflictSources: { textures: payload.textures },
        reuseExistingTextures: true,
        resolutionOverride: payload.texturePlan?.resolution ?? undefined
      });
      if (!planRes.ok) return planRes;
      attachTextureSteps();

      if (!autoStage) {
        const facePaintTextures = textureSteps.facePaint?.textures ?? [];
        const facePaintTextureIds = textureSteps.facePaint?.textureIds ?? [];
        if (facePaintTextures.length > 0 || facePaintTextureIds.length > 0) {
          const explicit = collectExplicitTextureRefs(payload.textures, undefined);
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

      if (autoStage && facePaintEntries.length > 0) {
        const mutatedBeforeFacePaint = Boolean(textureSteps.plan?.applied);
        if (mutatedBeforeFacePaint) {
          const preflightRes = runPreflightStep(textureCtx, 'before');
          if (!preflightRes.ok) return preflightRes;
        } else {
          const preflightRes = ensurePreflightUsage(textureCtx, 'before', { requireUsage: true });
          if (!preflightRes.ok) return preflightRes;
        }

        if (textureCtx.preflightUsage) {
          const summary = summarizeFacePaintUsage(facePaintEntries, textureCtx.preflightUsage);
          const explicit = collectExplicitTextureRefs(payload.textures, undefined);
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
          ctx: textureCtx,
          entries: facePaintEntries,
          plan: {
            existingPlan: payload.texturePlan ?? null,
            ifRevision: effectiveRevision,
            reuseExistingTextures: true
          },
          ifRevision: effectiveRevision,
          resolutionOverride: payload.texturePlan?.resolution ?? undefined
        });
        if (!facePaintRes.ok) return facePaintRes;
        if (facePaintRes.data.applied > 0) {
          steps.facePaint = {
            applied: facePaintRes.data.applied,
            materials: facePaintRes.data.materials,
            textures: facePaintRes.data.textures,
            ...(facePaintRes.data.textureIds.length > 0 ? { textureIds: facePaintRes.data.textureIds } : {}),
            ...(facePaintRes.data.uvUsageId ? { uvUsageId: facePaintRes.data.uvUsageId } : {}),
            ...(facePaintRes.data.recovery ? { recovery: facePaintRes.data.recovery } : {})
          };
        }
      }

      if (payload.textures && payload.textures.length > 0) {
        const targets = collectTextureTargets(payload.textures);
        const usageReady = ensurePreflightUsage(textureCtx, 'before', { requireUsage: true });
        if (!usageReady.ok) return usageReady;
        const resolved = await ensureUvUsageForTargetsInContext(textureCtx, {
          targets,
          requireUv: true,
          plan: {
            context: textureCtx,
            existingPlan: payload.texturePlan ?? null,
            ifRevision: effectiveRevision,
            reuseExistingTextures: true
          }
        });
        if (!resolved.ok) return resolved;
        attachTextureSteps();
        const recoveryAdjustedTextures = adjustTextureSpecsForRecovery(
          payload.textures,
          resolved.data.usage,
          resolved.data.recovery
        );
        const report = createApplyReport();
        const applyRes = await applyTextureSpecSteps(
          deps.service,
          deps.dom,
          deps.limits,
          recoveryAdjustedTextures,
          report,
          pipeline.meta,
          deps.log,
          resolved.data.usage,
          effectiveRevision
        );
        if (!applyRes.ok) return applyRes;
        steps.textures = {
          applied: true,
          report: applyRes.data,
          ...(resolved.data.recovery
            ? {
                recovery: resolved.data.recovery,
                uvUsageId: resolved.data.uvUsageId
              }
            : resolved.data.uvUsageId
              ? { uvUsageId: resolved.data.uvUsageId }
              : {})
        };
      }
      if (payload.animations && payload.animations.length > 0) {
        const animRes = applyEntityAnimations(
          deps.service,
          pipeline.meta,
          payload.animations,
          effectiveRevision,
          currentProject
        );
        if (!animRes.ok) return animRes;
        steps.animations = { applied: true, clips: animRes.data.clips, keyframes: animRes.data.keyframes };
      }

      if (payload.cleanup?.delete && payload.cleanup.delete.length > 0) {
        const cleanupRes = applyTextureCleanup(
          deps,
          pipeline.meta,
          payload.cleanup.delete,
          payload.cleanup.force === true,
          effectiveRevision
        );
        if (!cleanupRes.ok) return cleanupRes;
        steps.cleanup = cleanupRes.data;
      }

      const finalChecks = runFinalPreviewValidate({
        preview: payload.preview,
        validate: payload.validate,
        previewRunner: () => runPreviewStep(deps.service, payload.preview!, pipeline.meta),
        validateRunner: () => pipeline.wrap(deps.service.validate({}))
      });
      if (!finalChecks.ok) return finalChecks;
      if (finalChecks.data.preview) steps.preview = finalChecks.data.preview;
      if (finalChecks.data.validate) steps.validate = finalChecks.data.validate;
      const previewData: PreviewStepData | null = finalChecks.data.previewData ?? null;
      const extras: { applied: true; format: typeof format; targetVersion: typeof targetVersion } = {
        applied: true,
        format,
        targetVersion
      };
      const response = pipeline.ok(buildPipelineResult(steps, extras));
      const baseActions = buildValidateFindingsNextActions({
        result: steps.validate,
        guideUri: 'bbmcp://guide/entity-workflow'
      });
      const nextActions = dedupeNextActions(baseActions);
      const extrasResponse = nextActions.length > 0 ? { ...response, nextActions } : response;
      return attachPreviewResponse(extrasResponse, previewData);
    }
  });
};

const resolveEntityModelStages = (payload: EntityPipelinePayload): ModelPipelineStage[] => {
  if (payload.modelStages && payload.modelStages.length > 0) {
    return payload.modelStages;
  }
  if (payload.model) {
    return [{ model: payload.model }];
  }
  return [];
};





