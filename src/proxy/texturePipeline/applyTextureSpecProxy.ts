import type { TextureUsage } from '../../domain/model';
import { collectTextureTargets } from '../../domain/uvTargets';
import type { ApplyTextureSpecPayload } from '../../spec';
import type { ToolResponse } from '../../types';
import { applyTextureSpecSteps, createApplyReport } from '../apply';
import { createProxyPipeline } from '../pipeline';
import { guardUvForTextureTargets } from '../uvGuard';
import { validateTextureSpec } from '../validators';
import { tryRecoverUvForTextureSpec } from './recovery';
import type { ProxyPipelineDeps } from './types';

export const applyTextureSpecProxy = async (
  deps: ProxyPipelineDeps,
  payload: ApplyTextureSpecPayload
): Promise<ToolResponse<unknown>> => {
  const v = validateTextureSpec(payload, deps.limits);
  if (!v.ok) return v;
  const pipeline = createProxyPipeline({
    service: deps.service,
    payload,
    includeStateByDefault: deps.includeStateByDefault,
    includeDiffByDefault: deps.includeDiffByDefault,
    runWithoutRevisionGuard: (fn) => deps.runWithoutRevisionGuard(fn)
  });
  const guard = pipeline.guardRevision();
  if (guard) return guard;
  const targets = collectTextureTargets(payload.textures);
  const uvGuard = guardUvForTextureTargets(deps.service, pipeline.meta, payload.uvUsageId, targets);
  let usage: TextureUsage | null = null;
  let recovery: Record<string, unknown> | undefined;
  let recoveredUvUsageId: string | undefined;
  if (!uvGuard.ok) {
    const recovered = tryRecoverUvForTextureSpec(deps, payload, pipeline.meta, targets, uvGuard.error);
    if (!recovered) return uvGuard;
    if (!recovered.ok) return recovered;
    usage = recovered.data.usage;
    recovery = recovered.data.recovery;
    recoveredUvUsageId = recovered.data.uvUsageId;
  } else {
    usage = uvGuard.data.usage;
  }
  return pipeline.run(async () => {
    const report = createApplyReport();
    const result = await applyTextureSpecSteps(
      deps.service,
      deps.dom,
      deps.limits,
      payload.textures,
      report,
      pipeline.meta,
      deps.log,
      usage ?? undefined
    );
    if (!result.ok) return result;
    deps.log.info('applyTextureSpec applied', { textures: payload.textures.length });
    return pipeline.ok({
      applied: true,
      report,
      ...(recovery
        ? {
            recovery,
            uvUsageId: recoveredUvUsageId
          }
        : {})
    });
  });
};
