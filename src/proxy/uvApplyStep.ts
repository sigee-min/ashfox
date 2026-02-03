import { buildUvApplyPlan } from '../domain/uv/apply';
import { guardUvUsageId } from '../domain/uv/guards';
import { requireUvUsageId } from '../domain/uv/usageId';
import { computeTextureUsageId } from '../domain/textureUsage';
import { collectTextureTargets } from '../domain/uv/targets';
import type { TextureUsage } from '../domain/model';
import type { UvAssignmentSpec } from '../domain/uv/apply';
import type { ToolError, ToolResponse } from '../types';
import type { ProxyPipelineDeps } from './types';
import type { MetaOptions } from './meta';
import { guardUvForUsage } from './uvGuard';
import { cacheUvUsage, loadUvContext } from './uvContext';
import { errorWithMeta, usecaseError } from './errorAdapter';
import { isUsecaseError } from '../shared/tooling/responseGuards';
import { toDomainTextureUsage } from '../usecases/domainMappers';
import { UV_USAGE_REQUIRED, buildUvApplyMessages, buildUvGuardMessages } from '../shared/messages';

const uvApplyMessages = buildUvApplyMessages();
const uvGuardMessages = buildUvGuardMessages();

export type UvApplyStepResult = {
  usage: TextureUsage;
  uvUsageId: string;
  cubeCount: number;
  faceCount: number;
  touchedTextures: Array<{ id?: string; name: string }>;
};

export const applyUvAssignments = (
  deps: ProxyPipelineDeps,
  meta: MetaOptions,
  args: {
    assignments: UvAssignmentSpec[];
    uvUsageId?: string;
    ifRevision?: string;
    uvUsageMessage?: string;
    usageOverride?: TextureUsage;
    refreshUsage?: boolean;
  }
): ToolResponse<UvApplyStepResult> => {
  const failWithMeta = (error: ToolError): ToolResponse<never> => errorWithMeta(error, meta, deps.service);
  const usageIdRes = requireUvUsageId(args.uvUsageId, {
    required: args.uvUsageMessage ?? UV_USAGE_REQUIRED
  });
  if (!usageIdRes.ok) {
    const error = args.uvUsageMessage ? { ...usageIdRes.error, code: 'invalid_state' as const } : usageIdRes.error;
    return failWithMeta(error);
  }
  const uvUsageId = usageIdRes.data;

  const contextRes = loadUvContext(deps.service, meta, args.usageOverride, {
    cache: deps.cache?.uv,
    expectedUvUsageId: uvUsageId
  });
  if (!contextRes.ok) return contextRes;
  const usage = contextRes.data.usage;
  const cubes = contextRes.data.cubes;

  const planRes = buildUvApplyPlan(
    usage,
    cubes,
    args.assignments,
    contextRes.data.resolution,
    uvApplyMessages
  );
  if (!planRes.ok) return failWithMeta(planRes.error);

  const targets = collectTextureTargets(planRes.data.touchedTextures);
  const usageIdError = guardUvUsageId(usage, uvUsageId, contextRes.data.resolution, uvGuardMessages);
  if (usageIdError) return failWithMeta(usageIdError);

  const guardRes = guardUvForUsage(deps.service, meta, {
    usage: planRes.data.usage,
    targets,
    cubes,
    resolution: contextRes.data.resolution,
    policy: contextRes.data.policy
  });
  if (!guardRes.ok) return guardRes;

  const applyResult = deps.service.runWithoutRevisionGuard(() => {
    for (const update of planRes.data.updates) {
      const res = deps.service.setFaceUv({
        cubeId: update.cubeId,
        cubeName: update.cubeName,
        faces: update.faces,
        ifRevision: args.ifRevision
      });
      if (isUsecaseError(res)) return usecaseError(res, meta, deps.service);
    }
    return { ok: true as const, data: undefined };
  });
  if (!applyResult.ok) return applyResult;

  const shouldRefresh = args.refreshUsage !== false;
  let nextUsage = planRes.data.usage;
  if (shouldRefresh) {
    const usageRes = deps.service.getTextureUsage({});
    if (isUsecaseError(usageRes)) return usecaseError(usageRes, meta, deps.service);
    nextUsage = toDomainTextureUsage(usageRes.value);
    const refreshedGuard = guardUvForUsage(deps.service, meta, {
      usage: nextUsage,
      targets,
      cubes,
      resolution: contextRes.data.resolution,
      policy: contextRes.data.policy
    });
    if (!refreshedGuard.ok) return refreshedGuard;
  }

  const nextUsageId = computeTextureUsageId(nextUsage, contextRes.data.resolution);
  cacheUvUsage(deps.cache?.uv, nextUsage, nextUsageId);
  return {
    ok: true,
    data: {
      usage: nextUsage,
      uvUsageId: nextUsageId,
      cubeCount: planRes.data.cubeCount,
      faceCount: planRes.data.faceCount,
      touchedTextures: planRes.data.touchedTextures
    }
  };
};




