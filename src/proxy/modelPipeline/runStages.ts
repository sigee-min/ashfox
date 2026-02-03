import type { ModelPipelineStage } from '../../spec';
import type { ProjectState } from '../../types/project';
import type { ToolResponse } from '../../types';
import type { ProxyPipelineDeps } from '../types';
import type { ProxyPipeline } from '../pipeline';
import { buildModelPlanStep } from './modelStep';
import { applyPlanOps } from './modelApplier';
import type { AppliedReport, ModelPlan, ModelStageResult } from './types';
import { buildStageResult } from './stageResult';
import { runStageChecks, type StageCheckFlags } from '../previewChecks';
import type { RenderPreviewStructured } from '../../types/preview';
import type { ValidateResult } from '../../types';

export type RunModelStagesResult = {
  stageResults: ModelStageResult[];
  aggregatedPlan: ModelPlan['summary'];
  aggregatedReport: AppliedReport | null;
  warnings: string[];
  project: ProjectState;
  revision: string;
};

export const runModelStages = async (args: {
  deps: ProxyPipelineDeps;
  pipeline: ProxyPipeline;
  stages: ModelPipelineStage[];
  project: ProjectState;
  revision: string;
  planOnly: boolean;
  includeOps: boolean;
  stageChecks: StageCheckFlags;
  stageCheckRunners: {
    preview: () => ToolResponse<RenderPreviewStructured>;
    validate: () => ToolResponse<ValidateResult>;
  };
}): Promise<ToolResponse<RunModelStagesResult>> => {
  const stageResults: ModelStageResult[] = [];
  const aggregatedPlan = emptyPlanSummary();
  let aggregatedReport: AppliedReport | null = null;
  const warnings: string[] = [];
  let currentProject = args.project;
  let effectiveRevision = args.revision;

  for (const stage of args.stages) {
    const stageMode = stage.mode ?? 'merge';
    const stageDeleteOrphans = stage.deleteOrphans ?? stageMode === 'replace';
    const planRes = buildModelPlanStep({
      service: args.deps.service,
      meta: args.pipeline.meta,
      model: stage.model,
      existingBones: currentProject.bones ?? [],
      existingCubes: currentProject.cubes ?? [],
      mode: stageMode,
      deleteOrphans: stageDeleteOrphans,
      limits: args.deps.limits
    });
    if (!planRes.ok) return planRes;
    if (planRes.data.warnings.length > 0) {
      warnings.push(...planRes.data.warnings);
    }
    const stageResult: ModelStageResult = buildStageResult({
      label: stage.label,
      plan: planRes.data.plan.summary,
      warnings: planRes.data.warnings,
      ops: args.includeOps ? planRes.data.ops : undefined
    });
    accumulatePlanSummary(aggregatedPlan, planRes.data.plan.summary);

    if (!args.planOnly) {
      const applied = applyPlanOps(planRes.data.ops, {
        service: args.deps.service,
        ifRevision: effectiveRevision,
        meta: args.pipeline.meta
      });
      if (!applied.ok) return applied;
      stageResult.report = applied.data;
      aggregatedReport = mergeAppliedReports(aggregatedReport, applied.data);

      const refreshed = args.pipeline.wrap(args.deps.service.getProjectState({ detail: 'full' }));
      if (!refreshed.ok) return refreshed;
      currentProject = refreshed.data.project;
      effectiveRevision = currentProject.revision;

      const stageCheckRes = runStageChecks(args.stageChecks, args.stageCheckRunners);
      if (!stageCheckRes.ok) return stageCheckRes;
      stageResult.preview = stageCheckRes.data.preview;
      stageResult.validate = stageCheckRes.data.validate;
    }

    stageResults.push(stageResult);
  }

  return {
    ok: true,
    data: {
      stageResults,
      aggregatedPlan,
      aggregatedReport,
      warnings,
      project: currentProject,
      revision: effectiveRevision
    }
  };
};

const emptyPlanSummary = (): ModelPlan['summary'] => ({
  createBones: 0,
  updateBones: 0,
  deleteBones: 0,
  createCubes: 0,
  updateCubes: 0,
  deleteCubes: 0
});

const accumulatePlanSummary = (target: ModelPlan['summary'], next: ModelPlan['summary']) => {
  target.createBones += next.createBones;
  target.updateBones += next.updateBones;
  target.deleteBones += next.deleteBones;
  target.createCubes += next.createCubes;
  target.updateCubes += next.updateCubes;
  target.deleteCubes += next.deleteCubes;
};

const mergeAppliedReports = (base: AppliedReport | null, next: AppliedReport): AppliedReport => {
  if (!base) {
    return {
      created: { bones: [...next.created.bones], cubes: [...next.created.cubes] },
      updated: { bones: [...next.updated.bones], cubes: [...next.updated.cubes] },
      deleted: { bones: [...next.deleted.bones], cubes: [...next.deleted.cubes] }
    };
  }
  return {
    created: {
      bones: mergeUnique(base.created.bones, next.created.bones),
      cubes: mergeUnique(base.created.cubes, next.created.cubes)
    },
    updated: {
      bones: mergeUnique(base.updated.bones, next.updated.bones),
      cubes: mergeUnique(base.updated.cubes, next.updated.cubes)
    },
    deleted: {
      bones: mergeUnique(base.deleted.bones, next.deleted.bones),
      cubes: mergeUnique(base.deleted.cubes, next.deleted.cubes)
    }
  };
};

const mergeUnique = (left: string[], right: string[]): string[] => {
  const set = new Set<string>(left);
  right.forEach((item) => set.add(item));
  return Array.from(set);
};
