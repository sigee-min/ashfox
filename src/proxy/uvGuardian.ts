import type { TextureUsage } from '../domain/model';
import type { ToolError, ToolResponse } from '../types';
import { requireUvUsageId } from '../domain/uv/usageId';
import { UV_USAGE_REQUIRED } from '../shared/messages';
import { errorWithMeta } from './errorAdapter';
import { guardUvForTextureTargets, guardUvForUsage } from './uvGuard';
import { loadUvContext, type UvContext } from './uvContext';
import type { UvGuardianOptions, UvGuardianResult } from './uvGuardian/types';
import { classifyUvGuardFailure, needsUvRecovery } from './uvGuardian/helpers';
import { recoverWithAtlas, recoverWithPlan, refreshUsageId } from './uvGuardian/recovery';
import type { UvRecoveryReason } from './uvRecovery';

export type { UvGuardianOptions, UvGuardianResult } from './uvGuardian/types';

export const ensureUvUsageForTargets = async (
  options: UvGuardianOptions
): Promise<ToolResponse<UvGuardianResult>> => {
  const { deps, meta, targets } = options;
  const requireUv = options.requireUv === true;
  const failWithMeta = (error: ToolError) => errorWithMeta(error, meta, deps.service);

  const guardWith = (
    uvUsageId: string | undefined,
    usageOverride?: TextureUsage
  ): ToolResponse<UvGuardianResult> => {
    if (usageOverride) {
      const usageIdRes = requireUvUsageId(uvUsageId, { required: UV_USAGE_REQUIRED });
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
      const guardRes = guardUvForUsage(deps.service, meta, {
        usage: contextRes.data.usage,
        targets,
        cubes: contextRes.data.cubes,
        resolution: contextRes.data.resolution,
        policy: contextRes.data.policy,
        expectedUsageId: usageIdRes.data
      });
      if (!guardRes.ok) return guardRes;
      return { ok: true, data: { usage: contextRes.data.usage, uvUsageId: usageIdRes.data } };
    }
    const guardRes = guardUvForTextureTargets(deps.service, meta, uvUsageId, targets, { cache: deps.cache?.uv });
    if (!guardRes.ok) return guardRes;
    return { ok: true, data: { usage: guardRes.data.usage, uvUsageId: uvUsageId ?? '' } };
  };

  const recover = async (
    usage: TextureUsage | undefined,
    reason: UvRecoveryReason,
    fallback: ToolResponse<UvGuardianResult>
  ): Promise<ToolResponse<UvGuardianResult>> => {
    if (options.plan) {
      return recoverWithPlan({
        guardWith,
        planOptions: options.plan,
        usage,
        reason
      });
    }
    if (options.atlas) {
      return recoverWithAtlas({
        guardWith,
        deps,
        meta,
        atlasOptions: options.atlas,
        reason
      });
    }
    return fallback;
  };

  const maybeRecoverMissingUv = async (
    guarded: ToolResponse<UvGuardianResult>
  ): Promise<ToolResponse<UvGuardianResult>> => {
    if (!guarded.ok) return guarded;
    if (requireUv && needsUvRecovery(guarded.data.usage, targets)) {
      return recover(guarded.data.usage, 'uv_missing', guarded);
    }
    return guarded;
  };

  const guarded = guardWith(options.uvUsageId, options.usageOverride);

  if (guarded.ok) {
    return maybeRecoverMissingUv(guarded);
  }

  const failure = classifyUvGuardFailure(guarded.error);

  if (failure === 'uv_usage_mismatch' || failure === 'uv_usage_missing') {
    const refreshed = await refreshUsageId({ guardWith, deps, meta, reason: failure });
    if (!refreshed.ok) return refreshed;
    return maybeRecoverMissingUv(refreshed);
  }

  if (failure === 'uv_overlap' || failure === 'uv_scale_mismatch') {
    return recover(options.usageOverride, failure, guarded);
  }

  return guarded;
};




