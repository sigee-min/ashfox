import type { TextureUsage } from '../../../domain/model';
import type { PreflightTextureResult, ToolResponse } from '../../../types';
import { toDomainTextureUsage } from '../../../usecases/domainMappers';
import type { TexturePipelineContext } from './context';
import { cacheUvUsage } from '../../uvContext';

export const runPreflightStep = (
  ctx: TexturePipelineContext,
  phase?: 'before' | 'after'
): ToolResponse<PreflightTextureResult> => {
  const preflightRes = ctx.pipeline.wrap(ctx.deps.service.preflightTexture({ includeUsage: ctx.includeUsage }));
  if (!preflightRes.ok) return preflightRes;
  ctx.currentUvUsageId = preflightRes.data.uvUsageId;
  if (ctx.includeUsage && preflightRes.data.textureUsage) {
    ctx.preflightUsage = toDomainTextureUsage(preflightRes.data.textureUsage);
    cacheUvUsage(ctx.deps.cache?.uv, ctx.preflightUsage, preflightRes.data.uvUsageId);
  }
  if (phase && ctx.includePreflight) {
    const existing = ctx.steps.preflight ?? {};
    ctx.steps.preflight = { ...existing, [phase]: preflightRes.data };
  }
  return preflightRes;
};

export const ensurePreflightUsage = (
  ctx: TexturePipelineContext,
  phase: 'before' | 'after' = 'before',
  options: { requireUsage?: boolean } = {}
): ToolResponse<void> => {
  const requireUsage = options.requireUsage ?? ctx.includeUsage;
  const needsPreflight = !ctx.currentUvUsageId || (requireUsage && !ctx.preflightUsage);
  if (needsPreflight) {
    const preflightRes = runPreflightStep(ctx, phase);
    if (!preflightRes.ok) return preflightRes;
  }
  if (!ctx.currentUvUsageId || (requireUsage && !ctx.preflightUsage)) {
    return ctx.pipeline.error({ code: 'invalid_state', message: 'UV preflight did not return usage.' });
  }
  return { ok: true, data: undefined };
};

export const updatePreflightUsage = (
  ctx: TexturePipelineContext,
  usage: TextureUsage,
  uvUsageId: string
) => {
  ctx.currentUvUsageId = uvUsageId;
  ctx.preflightUsage = usage;
};
