import type { TextureTargetSet } from '../../../domain/uv/targets';
import type { ToolResponse } from '../../../types';
import { ensureUvUsageForTargets } from '../../uvGuardian';
import type { UvGuardianResult } from '../../uvGuardian';
import type { TexturePipelineContext } from './context';
import { ensurePreflightUsage } from './preflight';

export const ensureUvUsageForTargetsInContext = async (
  ctx: TexturePipelineContext,
  options: {
    targets: TextureTargetSet;
    requireUv?: boolean;
    plan?: Parameters<typeof ensureUvUsageForTargets>[0]['plan'];
    atlas?: Parameters<typeof ensureUvUsageForTargets>[0]['atlas'];
    skipPreflight?: boolean;
  }
): Promise<ToolResponse<UvGuardianResult>> => {
  if (!options.skipPreflight) {
    const preflightRes = ensurePreflightUsage(ctx, 'before', { requireUsage: true });
    if (!preflightRes.ok) return preflightRes as ToolResponse<UvGuardianResult>;
  } else if (!ctx.currentUvUsageId || !ctx.preflightUsage) {
    return ctx.pipeline.error({
      code: 'invalid_state',
      message: 'UV preflight did not return usage.'
    }) as ToolResponse<UvGuardianResult>;
  }
  const resolved = await ensureUvUsageForTargets({
    deps: ctx.deps,
    meta: ctx.pipeline.meta,
    targets: options.targets,
    uvUsageId: ctx.currentUvUsageId,
    usageOverride: ctx.preflightUsage,
    requireUv: options.requireUv,
    plan: options.plan,
    atlas: options.atlas
  });
  if (!resolved.ok) return resolved;
  ctx.currentUvUsageId = resolved.data.uvUsageId;
  ctx.preflightUsage = resolved.data.usage;
  return resolved;
};

