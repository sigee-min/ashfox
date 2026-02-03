import type { ToolError, ToolResponse } from '../types';
import { guardUvUsage } from '../domain/uv/guards';
import type { TextureTargetSet } from '../domain/uv/targets';
import type { Cube, TextureUsage } from '../domain/model';
import type { UvPolicyConfig } from '../domain/uv/policy';
import { requireUvUsageId } from '../domain/uv/usageId';
import { UV_USAGE_REQUIRED, buildUvGuardMessages } from '../shared/messages';
import type { ToolService } from '../usecases/ToolService';
import type { MetaOptions } from './meta';
import { loadUvContext, type UvContextCache } from './uvContext';
import { errorWithMeta } from './errorAdapter';
import { isResponseError } from '../shared/tooling/responseGuards';

export type UvGuardResult = { usage: TextureUsage };

export type UvGuardContext = {
  usage: TextureUsage;
  targets: TextureTargetSet;
  cubes: Cube[];
  resolution?: { width: number; height: number };
  policy: UvPolicyConfig;
  expectedUsageId?: string;
};

const UV_GUARD_MESSAGES = buildUvGuardMessages();

export const guardUvForUsage = (
  service: ToolService,
  meta: MetaOptions,
  context: UvGuardContext
): ToolResponse<UvGuardResult> => {
  const failWithMeta = (error: ToolError) => errorWithMeta(error, meta, service);
  const guardError = guardUvUsage({
    usage: context.usage,
    cubes: context.cubes,
    expectedUsageId: context.expectedUsageId,
    resolution: context.resolution,
    policy: context.policy,
    targets: context.targets,
    messages: UV_GUARD_MESSAGES
  });
  if (guardError) return failWithMeta(guardError);
  return { ok: true, data: { usage: context.usage } };
};

export const guardUvForTextureTargets = (
  service: ToolService,
  meta: MetaOptions,
  uvUsageId: string | undefined,
  targets: TextureTargetSet,
  options?: { cache?: UvContextCache }
): ToolResponse<UvGuardResult> => {
  const failWithMeta = (error: ToolError) => errorWithMeta(error, meta, service);
  const usageIdRes = requireUvUsageId(uvUsageId, { required: UV_USAGE_REQUIRED });
  if (!usageIdRes.ok) return failWithMeta(usageIdRes.error);
  const contextRes = loadUvContext(service, meta, undefined, {
    cache: options?.cache,
    expectedUvUsageId: usageIdRes.data
  });
  if (isResponseError(contextRes)) return contextRes;
  return guardUvForUsage(service, meta, {
    usage: contextRes.data.usage,
    targets,
    cubes: contextRes.data.cubes,
    resolution: contextRes.data.resolution,
    policy: contextRes.data.policy,
    expectedUsageId: usageIdRes.data
  });
};




