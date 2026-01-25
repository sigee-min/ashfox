import { buildUvApplyPlan } from '../../domain/uvApply';
import { computeTextureUsageId } from '../../domain/textureUsage';
import { collectTextureTargets } from '../../domain/uvTargets';
import type { ApplyUvSpecPayload } from '../../spec';
import type { ToolResponse } from '../../types';
import { toDomainCube, toDomainTextureUsage } from '../../usecases/domainMappers';
import { withErrorMeta } from '../meta';
import { createProxyPipeline } from '../pipeline';
import { guardUvForTextureTargets, guardUvForUsage } from '../uvGuard';
import { validateUvSpec } from '../validators';
import type { ProxyPipelineDeps } from './types';

export const applyUvSpecProxy = async (
  deps: ProxyPipelineDeps,
  payload: ApplyUvSpecPayload
): Promise<ToolResponse<unknown>> => {
  const v = validateUvSpec(payload);
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
  return pipeline.run(async () => {
    const usageRes = deps.service.getTextureUsage({});
    if (!usageRes.ok) return withErrorMeta(usageRes.error, pipeline.meta, deps.service);
    const usage = toDomainTextureUsage(usageRes.value);
    const stateRes = deps.service.getProjectState({ detail: 'full' });
    if (!stateRes.ok) return withErrorMeta(stateRes.error, pipeline.meta, deps.service);
    const project = stateRes.value.project;
    const planRes = buildUvApplyPlan(
      usage,
      (project.cubes ?? []).map((cube) => toDomainCube(cube)),
      payload.assignments,
      project.textureResolution
    );
    if (!planRes.ok) return withErrorMeta(planRes.error, pipeline.meta, deps.service);

    const targets = collectTextureTargets(planRes.data.touchedTextures);
    const usageGuard = guardUvForTextureTargets(deps.service, pipeline.meta, payload.uvUsageId, targets);
    if (!usageGuard.ok) return usageGuard;
    const guardRes = guardUvForUsage(deps.service, pipeline.meta, {
      usage: planRes.data.usage,
      targets,
      cubes: (project.cubes ?? []).map((cube) => toDomainCube(cube)),
      resolution: project.textureResolution,
      policy: deps.service.getUvPolicy()
    });
    if (!guardRes.ok) return guardRes;

    for (const update of planRes.data.updates) {
      const res = deps.service.setFaceUv({
        cubeId: update.cubeId,
        cubeName: update.cubeName,
        faces: update.faces,
        ifRevision: payload.ifRevision
      });
      if (!res.ok) return withErrorMeta(res.error, pipeline.meta, deps.service);
    }
    const nextUsageId = computeTextureUsageId(planRes.data.usage);
    const result = {
      applied: true,
      cubes: planRes.data.cubeCount,
      faces: planRes.data.faceCount,
      uvUsageId: nextUsageId
    };
    return pipeline.ok(result);
  });
};
