import type { Cube, TextureUsage } from '../domain/model';
import type { TextureTargetSet } from '../domain/uvTargets';
import type { ToolError, ToolResponse } from '../types';
import { guardUvUsageId } from '../domain/uvGuards';
import { requireUvUsageId } from '../domain/uvUsageId';
import { summarizeUvUsage } from '../domain/uvUsageSummary';
import type { TexturePipelinePlan } from '../spec';
import type { ProxyPipelineDeps } from './types';
import type { MetaOptions } from './meta';
import { errorWithMeta, isResponseError, isUsecaseError, usecaseError } from './guardHelpers';
import { guardUvForTextureTargets, guardUvForUsage } from './uvGuard';
import { loadUvContext, type UvContext } from './uvContext';
import type { TexturePipelineContext } from './texturePipeline/steps';
import { runAutoPlanStep } from './texturePipeline/autoPlan';
import type { TexturePipelineSteps } from './texturePipeline/types';

type UvGuardFailure =
  | 'uv_overlap'
  | 'uv_scale_mismatch'
  | 'uv_usage_mismatch'
  | 'uv_usage_missing'
  | 'unknown';

type UvRecoveryPlanOptions = {
  context: TexturePipelineContext;
  existingPlan?: TexturePipelinePlan | null;
  name?: string;
  maxTextures?: number;
  ifRevision?: string;
  reuseExistingTextures?: boolean;
};

type UvRecoveryAtlasOptions = {
  ifRevision?: string;
};

export type UvGuardianOptions = {
  deps: ProxyPipelineDeps;
  meta: MetaOptions;
  targets: TextureTargetSet;
  uvUsageId?: string;
  usageOverride?: TextureUsage;
  uvContext?: { cubes: Cube[]; resolution?: { width: number; height: number } };
  autoRecover?: boolean;
  requireUv?: boolean;
  plan?: UvRecoveryPlanOptions;
  atlas?: UvRecoveryAtlasOptions;
};

export type UvGuardianResult = {
  usage: TextureUsage;
  uvUsageId: string;
  recovery?: Record<string, unknown>;
};

export const ensureUvUsageForTargets = async (
  options: UvGuardianOptions
): Promise<ToolResponse<UvGuardianResult>> => {
  const { deps, meta, targets } = options;
  const autoRecover = options.autoRecover !== false;
  const requireUv = options.requireUv === true;
  const failWithMeta = (error: ToolError) => errorWithMeta(error, meta, deps.service);

  const guardWith = (
    uvUsageId: string | undefined,
    usageOverride?: TextureUsage
  ): ToolResponse<UvGuardianResult> => {
    if (usageOverride) {
      const usageIdRes = requireUvUsageId(uvUsageId);
      if (!usageIdRes.ok) return failWithMeta(usageIdRes.error);
      const contextRes: ToolResponse<UvContext> = options.uvContext
        ? {
            ok: true,
            data: {
              usage: usageOverride,
              cubes: options.uvContext.cubes,
              resolution: options.uvContext.resolution,
              policy: deps.service.getUvPolicy()
            }
          }
        : loadUvContext(deps.service, meta, usageOverride, {
            cache: deps.cache?.uv,
            expectedUvUsageId: usageIdRes.data
          });
      if (!contextRes.ok) return contextRes;
      const usageIdError = guardUvUsageId(contextRes.data.usage, usageIdRes.data);
      if (usageIdError) return failWithMeta(usageIdError);
      const guardRes = guardUvForUsage(deps.service, meta, {
        usage: contextRes.data.usage,
        targets,
        cubes: contextRes.data.cubes,
        resolution: contextRes.data.resolution,
        policy: contextRes.data.policy
      });
      if (!guardRes.ok) return guardRes;
      return { ok: true, data: { usage: contextRes.data.usage, uvUsageId: usageIdRes.data } };
    }
    const guardRes = guardUvForTextureTargets(deps.service, meta, uvUsageId, targets, { cache: deps.cache?.uv });
    if (!guardRes.ok) return guardRes;
    return { ok: true, data: { usage: guardRes.data.usage, uvUsageId: uvUsageId ?? '' } };
  };

  const needsUvRecovery = (usage: TextureUsage): boolean => {
    const summary = summarizeUvUsage(usage, targets);
    return usage.textures.length === 0 || summary.missingUvFaces > 0;
  };

  const recoverWithPlan = async (
    planOptions: UvRecoveryPlanOptions,
    usage: TextureUsage | undefined
  ): Promise<ToolResponse<UvGuardianResult>> => {
    const plan = buildAutoRecoverPlan({
      existingPlan: planOptions.existingPlan ?? null,
      name: planOptions.name,
      usage,
      maxTextures: planOptions.maxTextures
    });
    if (!plan) return guardWith(options.uvUsageId, options.usageOverride);
    const applyRes = await runAutoPlanStep(planOptions.context, plan, {
      planOnly: false,
      ifRevision: planOptions.ifRevision,
      reuseExistingTextures: planOptions.reuseExistingTextures === true
    });
    if (isResponseError(applyRes)) return applyRes;
    const nextUsage = planOptions.context.preflightUsage;
    const nextUsageId = planOptions.context.currentUvUsageId;
    if (!nextUsage || !nextUsageId) {
      return {
        ok: false,
        error: failWithMeta({ code: 'invalid_state', message: 'UV recovery failed to produce usage.' }).error
      };
    }
    const recovery = buildAutoRecoverPlanDetails(planOptions.context.steps.plan, plan, 'autoRecover');
    return { ok: true, data: { usage: nextUsage, uvUsageId: nextUsageId, recovery } };
  };

  const recoverWithAtlas = async (
    atlasOptions: UvRecoveryAtlasOptions,
    reason: string
  ): Promise<ToolResponse<UvGuardianResult>> => {
    const atlasRes = deps.service.autoUvAtlas({ apply: true, ifRevision: atlasOptions.ifRevision });
    if (isUsecaseError(atlasRes)) return usecaseError(atlasRes, meta, deps.service);
    const preflightRes = deps.service.preflightTexture({});
    if (isUsecaseError(preflightRes)) return usecaseError(preflightRes, meta, deps.service);
    const guarded = guardWith(preflightRes.value.uvUsageId);
    if (!guarded.ok) return guarded;
    const recovery = {
      reason,
      source: 'autoRecover',
      method: 'auto_uv_atlas',
      ...(atlasRes.value
        ? { steps: atlasRes.value.steps, resolution: atlasRes.value.resolution }
        : {})
    };
    return {
      ok: true,
      data: {
        usage: guarded.data.usage,
        uvUsageId: preflightRes.value.uvUsageId,
        recovery
      }
    };
  };

  const recover = async (
    usage: TextureUsage | undefined,
    reason: string,
    fallback: ToolResponse<UvGuardianResult>
  ): Promise<ToolResponse<UvGuardianResult>> => {
    if (options.plan) {
      return recoverWithPlan(options.plan, usage);
    }
    if (options.atlas) {
      return recoverWithAtlas(options.atlas, reason);
    }
    return fallback;
  };

  let guarded = guardWith(options.uvUsageId, options.usageOverride);

  if (guarded.ok) {
    if (requireUv && autoRecover && needsUvRecovery(guarded.data.usage)) {
      const recovered = await recover(guarded.data.usage, 'uv_missing', guarded);
      if (recovered.ok) return recovered;
      return recovered;
    }
    return guarded;
  }

  if (!autoRecover) return guarded;

  const failure = classifyUvGuardFailure(guarded.error);

  if (failure === 'uv_usage_mismatch' || failure === 'uv_usage_missing') {
    const preflightRes = deps.service.preflightTexture({});
    if (isUsecaseError(preflightRes)) return usecaseError(preflightRes, meta, deps.service);
    const refreshed = guardWith(preflightRes.value.uvUsageId);
    if (!refreshed.ok) return refreshed;
    const recovery = { reason: failure, source: 'autoRecover' };
    if (requireUv && needsUvRecovery(refreshed.data.usage)) {
      const recovered = await recover(refreshed.data.usage, 'uv_missing', refreshed);
      if (recovered.ok) return recovered;
      return recovered;
    }
    return {
      ok: true,
      data: {
        usage: refreshed.data.usage,
        uvUsageId: preflightRes.value.uvUsageId,
        recovery
      }
    };
  }

  if (failure === 'uv_overlap' || failure === 'uv_scale_mismatch') {
    return recover(options.usageOverride, failure, guarded);
  }

  return guarded;
};

const classifyUvGuardFailure = (error: ToolError): UvGuardFailure => {
  if (error.code !== 'invalid_state' && error.code !== 'invalid_payload') return 'unknown';
  const details = error.details;
  if (!details || typeof details !== 'object') return 'unknown';
  const reason = typeof (details as { reason?: string }).reason === 'string'
    ? (details as { reason?: string }).reason
    : null;
  if (reason === 'uv_overlap') return 'uv_overlap';
  if (reason === 'uv_scale_mismatch') return 'uv_scale_mismatch';
  if (reason === 'uv_usage_mismatch') return 'uv_usage_mismatch';
  if (reason === 'uv_usage_missing') return 'uv_usage_missing';
  const overlaps = (details as { overlaps?: unknown[] }).overlaps;
  const mismatches = (details as { mismatches?: unknown[] }).mismatches;
  if (Array.isArray(overlaps) && overlaps.length > 0) return 'uv_overlap';
  if (Array.isArray(mismatches) && mismatches.length > 0) return 'uv_scale_mismatch';
  const expected = (details as { expected?: unknown }).expected;
  const current = (details as { current?: unknown }).current;
  if (typeof expected === 'string' && typeof current === 'string') return 'uv_usage_mismatch';
  return 'unknown';
};

const buildAutoRecoverPlan = (args: {
  existingPlan?: TexturePipelinePlan | null;
  name?: string;
  usage?: TextureUsage;
  maxTextures?: number;
}): TexturePipelinePlan | null => {
  const name = args.name ?? args.usage?.textures[0]?.name;
  const base = args.existingPlan ? { ...args.existingPlan } : { name };
  if (!base.name && name) base.name = name;
  if (base.allowSplit === undefined || base.allowSplit === false) base.allowSplit = true;
  const desiredMax = args.maxTextures ?? 16;
  const currentMax = typeof base.maxTextures === 'number' && Number.isFinite(base.maxTextures)
    ? Math.max(1, Math.trunc(base.maxTextures))
    : 1;
  if (!Number.isFinite(base.maxTextures)) {
    base.maxTextures = desiredMax;
  } else {
    base.maxTextures = Math.max(currentMax, desiredMax);
  }
  return base;
};

const buildAutoRecoverPlanDetails = (
  planStep: TexturePipelineSteps['plan'] | undefined,
  plan: TexturePipelinePlan,
  source: 'autoRecover'
): Record<string, unknown> => {
  return {
    reason: 'plan',
    source,
    ...(planStep
      ? {
          detail: planStep.detail,
          resolution: planStep.resolution,
          textureCount: planStep.textures.length,
          notes: planStep.notes,
          planName: plan?.name
        }
      : { planName: plan?.name })
  };
};
