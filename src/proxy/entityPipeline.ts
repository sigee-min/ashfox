import { EntityPipelinePayload } from '../spec';
import { collectTextureTargets } from '../domain/uvTargets';
import { applyTextureSpecSteps, createApplyReport } from './apply';
import { buildPipelineResult } from './pipelineResult';
import { validateEntityPipeline } from './validators';
import type { ProxyPipelineDeps } from './types';
import type { ToolResponse } from '../types';
import { err } from '../services/toolResponse';
import { applyModelPlanStep } from './modelPipeline/modelStep';
import { ensureProjectAndLoadProject, resolveEnsureProjectPayload, requireProjectFormat } from './ensureProject';
import { applyEntityAnimations } from './animationStep';
import type { EntityPipelineResult, EntityPipelineSteps } from './entityPipeline/types';
import { runProxyPipeline } from './pipelineRunner';
import { PROXY_FORMAT_NOT_IMPLEMENTED } from '../shared/messages';
import { buildClarificationNextActions } from './nextActionHelpers';
import { getEntityPipelineClarificationQuestions } from './clarifications';
import { applyTextureCleanup } from './textureCleanup';
import {
  createTexturePipelineContext,
  ensurePreflightUsage,
  ensureUvUsageForTargetsInContext
} from './texturePipeline/steps';
import { runAutoPlanStep } from './texturePipeline/autoPlan';
import type { TexturePipelineSteps } from './texturePipeline/types';
import { buildFacePaintPresets, summarizeFacePaintUsage } from './texturePipeline/facePaint';
import { loadProjectState } from './projectState';
import type { GenerateTexturePresetResult } from '../types';

export const entityPipelineProxy = async (
  deps: ProxyPipelineDeps,
  payload: EntityPipelinePayload
): Promise<ToolResponse<EntityPipelineResult>> => {
  let clarificationQuestions: string[] = [];
  let shouldPlanOnly = false;
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
      clarificationQuestions = getEntityPipelineClarificationQuestions(payload);
      shouldPlanOnly = Boolean(payload.planOnly) || clarificationQuestions.length > 0;
      return shouldPlanOnly ? null : pipeline.guardRevision();
    },
    run: async (pipeline) => {
      const steps: EntityPipelineSteps = {};
      const format = payload.format;
      const targetVersion = payload.targetVersion ?? 'v4';
      const facePaintEntries = Array.isArray(payload.facePaint) ? payload.facePaint : [];
      const hasFacePaint = facePaintEntries.length > 0;
      const autoRecoverEnabled = payload.autoRecover !== false;
      const facePaintAutoRecover = autoRecoverEnabled;

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
      const needsFull = Boolean(payload.model || (payload.animations && payload.animations.length > 0));
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
      if (payload.model) {
        const project = stateRes.data.project;
        const applyRes = applyModelPlanStep({
          service: deps.service,
          meta: pipeline.meta,
          model: payload.model,
          existingBones: project.bones ?? [],
          existingCubes: project.cubes ?? [],
          mode: 'merge',
          deleteOrphans: false,
          limits: deps.limits,
          ifRevision: effectiveRevision
        });
        if (!applyRes.ok) return applyRes;
        steps.model = {
          applied: true,
          plan: applyRes.data.plan.summary,
          report: applyRes.data.report,
          ...(applyRes.data.warnings.length > 0 ? { warnings: applyRes.data.warnings } : {})
        };
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

      if (payload.texturePlan) {
        const planRes = await runAutoPlanStep(textureCtx, payload.texturePlan, {
          planOnly: false,
          ifRevision: effectiveRevision
        });
        if (!planRes.ok) return planRes;
        attachTextureSteps();
      }

      if (hasFacePaint) {
        const usageReady = ensurePreflightUsage(textureCtx, 'before', { requireUsage: true });
        if (!usageReady.ok) return usageReady;
        const summary = summarizeFacePaintUsage(facePaintEntries, textureCtx.preflightUsage!);
        const targets = summary.targets;
        const resolved = await ensureUvUsageForTargetsInContext(textureCtx, {
          targets,
          autoRecover: facePaintAutoRecover,
          requireUv: true,
          plan: facePaintAutoRecover
            ? {
                context: textureCtx,
                existingPlan: payload.texturePlan ?? null,
                ifRevision: effectiveRevision,
                reuseExistingTextures: true
              }
            : undefined
        });
        if (!resolved.ok) return resolved;
        attachTextureSteps();
        const projectRes = loadProjectState(deps.service, pipeline.meta, 'summary');
        if (!projectRes.ok) return projectRes;
        const facePaintPresets = buildFacePaintPresets({
          entries: facePaintEntries,
          usage: resolved.data.usage,
          project: projectRes.data
        });
        if (!facePaintPresets.ok) return facePaintPresets;
        const presetResults: GenerateTexturePresetResult[] = [];
        for (const preset of facePaintPresets.data.presets) {
          const presetRes = pipeline.wrap(
            deps.service.generateTexturePreset({
              preset: preset.preset,
              width: preset.width,
              height: preset.height,
              uvUsageId: resolved.data.uvUsageId,
              name: preset.name,
              targetId: preset.targetId,
              targetName: preset.targetName,
              mode: preset.mode,
              seed: preset.seed,
              palette: preset.palette,
              uvPaint: preset.uvPaint,
              ifRevision: effectiveRevision
            })
          );
          if (!presetRes.ok) return presetRes;
          presetResults.push(presetRes.data);
        }
        if (presetResults.length > 0) {
          const existing = steps.presets;
          const merged = existing ? [...existing.results, ...presetResults] : presetResults;
          const applied = (existing?.applied ?? 0) + presetResults.length;
          const nextRecovery = existing?.recovery ?? resolved.data.recovery;
          const nextUvUsageId = existing?.uvUsageId ?? (nextRecovery ? resolved.data.uvUsageId : undefined);
          steps.presets = {
            applied,
            results: merged,
            ...(nextRecovery ? { recovery: nextRecovery, uvUsageId: nextUvUsageId } : {})
          };
          const metaRes = pipeline.wrap(
            deps.service.setProjectMeta({
              meta: { facePaint: facePaintEntries },
              ifRevision: effectiveRevision
            })
          );
          if (!metaRes.ok) return metaRes;
          steps.facePaint = {
            applied: presetResults.length,
            materials: facePaintPresets.data.materials,
            textures: facePaintPresets.data.textures,
            uvUsageId: resolved.data.uvUsageId,
            ...(resolved.data.recovery ? { recovery: resolved.data.recovery } : {})
          };
        }
      }

      if (payload.textures && payload.textures.length > 0) {
        const targets = collectTextureTargets(payload.textures);
        const usageReady = ensurePreflightUsage(textureCtx, 'before', { requireUsage: true });
        if (!usageReady.ok) return usageReady;
        const resolved = await ensureUvUsageForTargetsInContext(textureCtx, {
          targets,
          autoRecover: autoRecoverEnabled,
          requireUv: true,
          plan: autoRecoverEnabled
            ? {
                context: textureCtx,
                existingPlan: payload.texturePlan ?? null,
                ifRevision: effectiveRevision,
                reuseExistingTextures: true
              }
            : undefined
        });
        if (!resolved.ok) return resolved;
        attachTextureSteps();
        const report = createApplyReport();
        const applyRes = await applyTextureSpecSteps(
          deps.service,
          deps.dom,
          deps.limits,
          payload.textures,
          report,
          pipeline.meta,
          deps.log,
          resolved.data.usage
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
          stateRes.data.project
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
      const extras: { applied: true; format: typeof format; targetVersion: typeof targetVersion } = {
        applied: true,
        format,
        targetVersion
      };
      const result = buildPipelineResult(steps, extras);
      return pipeline.ok(result);
    }
  });
};
