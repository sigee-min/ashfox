import type { TextureUsage } from '../../domain/model';
import type { ToolResponse } from '../../types';
import { usecaseError } from '../errorAdapter';
import { isResponseError, isUsecaseError } from '../../shared/tooling/responseGuards';
import { runAutoPlanStep } from '../texturePipeline/autoPlan';
import {
  buildAtlasRecoveryInfo,
  buildPlanRecoveryInfo,
  buildPreflightRecoveryInfo,
  type UvRecoveryReason
} from '../uvRecovery';
import type { GuardWithFn, UvGuardianResult, UvRecoveryAtlasOptions, UvRecoveryPlanOptions } from './types';
import type { ProxyPipelineDeps } from '../types';
import type { MetaOptions } from '../meta';
import { buildAutoRecoverPlan } from '../texturePipeline/autoPlan/recovery';
import { computeUvScaleIssues } from '../../domain/uv/issues';
import { toDomainCube, toDomainTextureUsage } from '../../usecases/domainMappers';

export const recoverWithPlan = async (args: {
  guardWith: GuardWithFn;
  planOptions: UvRecoveryPlanOptions;
  usage: TextureUsage | undefined;
  reason: UvRecoveryReason;
}): Promise<ToolResponse<UvGuardianResult>> => {
  const plan = buildAutoRecoverPlan({
    existingPlan: args.planOptions.existingPlan ?? null,
    name: args.planOptions.name,
    usage: args.usage,
    maxTextures: args.planOptions.maxTextures
  });
  if (!plan) return args.guardWith(args.planOptions.context.currentUvUsageId, args.usage);
  const baseResolution = resolveBaseResolution(
    plan.resolution,
    args.planOptions.context.deps.service.getProjectTextureResolution()
  );
  const resolutionOverride =
    args.reason === 'uv_scale_mismatch'
      ? computeScaleResolutionOverride({
          usage: args.usage,
          baseResolution,
          service: args.planOptions.context.deps.service
        })
      : null;
  if (resolutionOverride) {
    plan.resolution = { width: resolutionOverride.width, height: resolutionOverride.height };
  }
  const applyRes = await runAutoPlanStep(args.planOptions.context, plan, {
    planOnly: false,
    ifRevision: args.planOptions.ifRevision,
    reuseExistingTextures: args.planOptions.reuseExistingTextures === true
  });
  if (isResponseError(applyRes)) return applyRes;
  if (resolutionOverride && args.planOptions.context.steps.plan) {
    const notes = args.planOptions.context.steps.plan.notes
      ? [...args.planOptions.context.steps.plan.notes]
      : [];
    notes.push(
      `Automatic recovery raised texture resolution to ${resolutionOverride.width}x${resolutionOverride.height} to resolve uv_scale_mismatch.`
    );
    if (resolutionOverride.notes && resolutionOverride.notes.length > 0) {
      notes.push(...resolutionOverride.notes);
    }
    args.planOptions.context.steps.plan.notes = notes;
  }
  const nextUsage = args.planOptions.context.preflightUsage;
  const nextUsageId = args.planOptions.context.currentUvUsageId;
  if (!nextUsage || !nextUsageId) {
    return args.planOptions.context.pipeline.error({
      code: 'invalid_state',
      message: 'UV recovery failed to produce usage.'
    }) as ToolResponse<UvGuardianResult>;
  }
  const recovery = buildPlanRecoveryInfo(args.reason, args.planOptions.context.steps.plan, plan);
  return { ok: true, data: { usage: nextUsage, uvUsageId: nextUsageId, recovery } };
};

export const recoverWithAtlas = async (args: {
  guardWith: GuardWithFn;
  deps: ProxyPipelineDeps;
  meta: MetaOptions;
  atlasOptions: UvRecoveryAtlasOptions;
  reason: UvRecoveryReason;
}): Promise<ToolResponse<UvGuardianResult>> => {
  let recoveryNotes: string[] | undefined;
  let resolutionOverride: { width: number; height: number; notes?: string[] } | null = null;
  if (args.reason === 'uv_scale_mismatch') {
    const preflight = args.deps.service.preflightTexture({ includeUsage: true });
    if (isUsecaseError(preflight)) return usecaseError(preflight, args.meta, args.deps.service);
    const usage = preflight.value.textureUsage
      ? toDomainTextureUsage(preflight.value.textureUsage)
      : undefined;
    const baseResolution =
      preflight.value.textureResolution ?? args.deps.service.getProjectTextureResolution();
    resolutionOverride = computeScaleResolutionOverride({
      usage,
      baseResolution,
      service: args.deps.service
    });
  }

  const mutationRes = args.deps.service.runWithoutRevisionGuard(() => {
    if (resolutionOverride) {
      const res = args.deps.service.setProjectTextureResolution({
        width: resolutionOverride.width,
        height: resolutionOverride.height,
        modifyUv: false,
        ifRevision: args.atlasOptions.ifRevision
      });
      if (isUsecaseError(res)) return usecaseError(res, args.meta, args.deps.service);
      const notes = [
        `Automatic recovery raised texture resolution to ${resolutionOverride.width}x${resolutionOverride.height} to resolve uv_scale_mismatch.`
      ];
      if (resolutionOverride.notes && resolutionOverride.notes.length > 0) {
        notes.push(...resolutionOverride.notes);
      }
      recoveryNotes = notes;
    }
    const atlasRes = args.deps.service.autoUvAtlas({ apply: true, ifRevision: args.atlasOptions.ifRevision });
    if (isUsecaseError(atlasRes)) return usecaseError(atlasRes, args.meta, args.deps.service);
    return { ok: true as const, data: atlasRes };
  });
  if (!mutationRes.ok) return mutationRes;
  const atlasRes = mutationRes.data;
  const preflightRes = args.deps.service.preflightTexture({});
  if (isUsecaseError(preflightRes)) return usecaseError(preflightRes, args.meta, args.deps.service);
  const guarded = args.guardWith(preflightRes.value.uvUsageId);
  if (!guarded.ok) return guarded;
  const recovery = buildAtlasRecoveryInfo(args.reason, atlasRes.value, recoveryNotes);
  return {
    ok: true,
    data: {
      usage: guarded.data.usage,
      uvUsageId: preflightRes.value.uvUsageId,
      recovery
    }
  };
};

export const refreshUsageId = async (args: {
  guardWith: GuardWithFn;
  deps: ProxyPipelineDeps;
  meta: MetaOptions;
  reason: UvRecoveryReason;
}): Promise<ToolResponse<UvGuardianResult>> => {
  const preflightRes = args.deps.service.preflightTexture({});
  if (isUsecaseError(preflightRes)) return usecaseError(preflightRes, args.meta, args.deps.service);
  const refreshed = args.guardWith(preflightRes.value.uvUsageId);
  if (!refreshed.ok) return refreshed;
  return {
    ok: true,
    data: {
      usage: refreshed.data.usage,
      uvUsageId: preflightRes.value.uvUsageId,
      recovery: buildPreflightRecoveryInfo(args.reason)
    }
  };
};

const computeScaleResolutionOverride = (args: {
  usage: TextureUsage | undefined;
  baseResolution: { width: number; height: number } | null;
  service: ProxyPipelineDeps['service'];
}): { width: number; height: number; notes?: string[] } | null => {
  if (!args.usage || !args.baseResolution) return null;
  const policy = args.service.getUvPolicy();
  const stateRes = args.service.getProjectState({ detail: 'full' });
  if (!stateRes.ok) return null;
  const cubes = (stateRes.value.project.cubes ?? []).map((cube) => toDomainCube(cube));
  if (cubes.length === 0) return null;
  const scaleResult = computeUvScaleIssues(args.usage, cubes, args.baseResolution, policy);
  if (scaleResult.issues.length === 0) return null;
  let scaleFactor = 1;
  scaleResult.issues.forEach((issue) => {
    const example = issue.example;
    if (!example) return;
    const widthRatio = example.actual.width > 0 ? example.expected.width / example.actual.width : 1;
    const heightRatio = example.actual.height > 0 ? example.expected.height / example.actual.height : 1;
    const ratio = Math.max(widthRatio, heightRatio);
    if (Number.isFinite(ratio) && ratio > scaleFactor) scaleFactor = ratio;
  });
  if (scaleFactor <= 1.05) return null;
  const maxSize = args.service.listCapabilities().limits.maxTextureSize;
  const rawWidth = roundUpResolution(args.baseResolution.width * scaleFactor);
  const rawHeight = roundUpResolution(args.baseResolution.height * scaleFactor);
  const nextWidth = clampResolution(rawWidth, maxSize);
  const nextHeight = clampResolution(rawHeight, maxSize);
  if (nextWidth <= args.baseResolution.width && nextHeight <= args.baseResolution.height) return null;
  const notes: string[] = [];
  if (rawWidth !== nextWidth || rawHeight !== nextHeight) {
    notes.push(`Requested resolution ${rawWidth}x${rawHeight} clamped to ${nextWidth}x${nextHeight}.`);
  }
  return { width: nextWidth, height: nextHeight, ...(notes.length > 0 ? { notes } : {}) };
};

const resolveBaseResolution = (
  planResolution: { width?: number; height?: number } | undefined,
  projectResolution: { width: number; height: number } | null
): { width: number; height: number } | null => {
  if (planResolution?.width && planResolution?.height) {
    return { width: planResolution.width, height: planResolution.height };
  }
  return projectResolution ?? null;
};

const roundUpResolution = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 32;
  if (value <= 32) return 32;
  return Math.ceil(value / 32) * 32;
};

const clampResolution = (value: number, maxSize: number): number => {
  if (!Number.isFinite(maxSize) || maxSize <= 0) return value;
  return Math.min(value, maxSize);
};

