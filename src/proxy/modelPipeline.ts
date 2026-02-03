import type { ModelPipelinePayload } from '../spec';
import type { ToolResponse } from '../types';
import { validateModelPipeline } from './validators';
import type { ProxyPipelineDeps } from './types';
import type { ModelPipelineResult, ModelPipelineSteps, ModelPlan, ModelStageResult } from './modelPipeline/types';
import { buildClarificationNextActions, buildModelPipelineNextActions, buildValidateFindingsNextActions, dedupeNextActions } from './nextActionHelpers';
import { ensureProjectAndLoadProject, resolveEnsureProjectPayload } from './ensureProject';
import { runPreviewStep, runPreviewStepStructured, type PreviewStepData } from './previewStep';
import { attachPreviewResponse } from './previewResponse';
import { buildPipelineResult } from './pipelineResult';
import { runProxyPipeline } from './pipelineRunner';
import { getModelClarificationQuestions } from './clarifications';
import { decidePlanOnly } from './planOnly';
import type { ModelPipelineStage } from '../spec';
import { MODEL_OR_STAGES_REQUIRED } from '../shared/messages';
import { resolveStageCheckFlags, runFinalPreviewValidate } from './previewChecks';
import { runModelStages } from './modelPipeline/runStages';

export const modelPipelineProxy = async (
  deps: ProxyPipelineDeps,
  payload: ModelPipelinePayload
): Promise<ToolResponse<ModelPipelineResult>> => {
  const planDecision = decidePlanOnly(
    payload.planOnly,
    getModelClarificationQuestions({ model: payload.model, stages: payload.stages })
  );
  const clarificationQuestions = planDecision.questions;
  const shouldPlanOnly = planDecision.shouldPlanOnly;
  return runProxyPipeline<ModelPipelinePayload, ModelPipelineResult>(deps, payload, {
    validate: validateModelPipeline,
    guard: (pipeline) => {
      return shouldPlanOnly ? null : pipeline.guardRevision();
    },
    run: async (pipeline) => {
      const steps: ModelPipelineSteps = {};
      let effectiveRevision = pipeline.meta.ifRevision;

      const ensurePayload = resolveEnsureProjectPayload(payload.ensureProject, {}, effectiveRevision);
      const projectRes = ensureProjectAndLoadProject({
        service: deps.service,
        meta: pipeline.meta,
        ensurePayload,
        detail: 'full',
        includeUsage: false,
        refreshRevision: Boolean(ensurePayload)
      });
      if (!projectRes.ok) return projectRes;
      if (projectRes.data.ensure) {
        steps.ensureProject = projectRes.data.ensure;
      }
      const project = projectRes.data.project;
      if (projectRes.data.revision) effectiveRevision = projectRes.data.revision;

      const stages = resolveModelStages(payload);
      if (stages.length === 0) {
        return pipeline.error({ code: 'invalid_payload', message: MODEL_OR_STAGES_REQUIRED });
      }

      const isStaged = Boolean(payload.stages && payload.stages.length > 0);
      const stageChecks = resolveStageCheckFlags({
        preview: payload.preview,
        validate: payload.validate,
        stagePreview: payload.stagePreview,
        stageValidate: payload.stageValidate,
        staged: isStaged
      });
      const defaultMode = payload.mode ?? 'merge';
      const normalizedStages = stages.map((stage) => {
        const stageMode = stage.mode ?? defaultMode;
        const stageDeleteOrphans =
          stage.deleteOrphans ?? (isStaged ? false : payload.deleteOrphans ?? stageMode === 'replace');
        return { ...stage, mode: stageMode, deleteOrphans: stageDeleteOrphans };
      });

      const stageRun = await runModelStages({
        deps,
        pipeline,
        stages: normalizedStages,
        project,
        revision: effectiveRevision ?? project.revision,
        planOnly: shouldPlanOnly,
        includeOps: shouldPlanOnly,
        stageChecks,
        stageCheckRunners: {
          preview: () => runPreviewStepStructured(deps.service, payload.preview!, pipeline.meta),
          validate: () => pipeline.wrap(deps.service.validate({}))
        }
      });
      if (!stageRun.ok) return stageRun;
      effectiveRevision = stageRun.data.revision;
      if (stageRun.data.warnings.length > 0) {
        steps.warnings = uniqueStrings(stageRun.data.warnings);
      }
      steps.plan = stageRun.data.aggregatedPlan;
      steps.stages = stageRun.data.stageResults;

      if (shouldPlanOnly) {
        steps.planOps = flattenStageOps(stageRun.data.stageResults);
        const response = pipeline.ok(
          buildPipelineResult(steps, { plan: { ops: steps.planOps ?? [], summary: steps.plan }, planOnly: true, applied: false })
        );
        const nextActions = [
          ...buildClarificationNextActions({ questions: clarificationQuestions }),
          ...buildModelPipelineNextActions({
            warnings: steps.warnings,
            includeValidate: false,
            includePreview: false
          })
        ];
        return nextActions.length > 0 ? { ...response, nextActions } : response;
      }

      if (stageRun.data.aggregatedReport) {
        steps.apply = stageRun.data.aggregatedReport;
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

      if (payload.export) {
        const exportRes = pipeline.wrap(
          deps.service.exportModel({
            format: payload.export.format,
            destPath: payload.export.destPath
          })
        );
        if (!exportRes.ok) return exportRes;
        steps.export = exportRes.data;
      }

      const response = pipeline.ok(buildPipelineResult(steps, { report: steps.apply, applied: true }));

      const nextActions = dedupeNextActions([
        ...buildModelPipelineNextActions({
          warnings: steps.warnings,
          includeValidate: !payload.validate,
          includePreview: !payload.preview
        }),
        ...buildValidateFindingsNextActions({
          result: steps.validate,
          guideUri: 'bbmcp://guide/modeling-workflow'
        })
      ]);
      const extras = nextActions.length > 0 ? { nextActions } : {};
      return attachPreviewResponse({ ...response, ...extras }, previewData);
    }
  });
};

const resolveModelStages = (payload: ModelPipelinePayload): ModelPipelineStage[] => {
  if (payload.stages && payload.stages.length > 0) {
    return payload.stages;
  }
  if (payload.model) {
    return [
      {
        model: payload.model,
        mode: payload.mode,
        deleteOrphans: payload.deleteOrphans
      }
    ];
  }
  return [];
};

const uniqueStrings = (items: string[]): string[] => {
  const set = new Set(items.filter((item) => typeof item === 'string' && item.length > 0));
  return Array.from(set);
};

const flattenStageOps = (stages: ModelStageResult[]): ModelPlan['ops'] | undefined => {
  const ops: ModelPlan['ops'] = [];
  stages.forEach((stage) => {
    if (stage.ops && stage.ops.length > 0) {
      ops.push(...stage.ops);
    }
  });
  return ops.length > 0 ? ops : undefined;
};


