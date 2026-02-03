import type { TextureUsage } from '../../../domain/model';
import type { TextureSpec } from '../../../spec';
import type { ToolResponse } from '../../../types';
import type { ApplyTextureSpecResult } from '../types';
import type { UvRecoveryInfo } from '../../uvRecovery';
import type { TexturePipelineContext } from './context';
import { applyTextureSpecSteps, createApplyReport } from '../../apply';
import { isResponseError } from '../../../shared/tooling/responseGuards';

export const runTextureApplyStep = async (
  ctx: TexturePipelineContext,
  textures: TextureSpec[],
  usage: TextureUsage,
  recovery?: UvRecoveryInfo
): Promise<ToolResponse<ApplyTextureSpecResult>> => {
  const report = createApplyReport();
  const applyRes = await applyTextureSpecSteps(
    ctx.deps.service,
    ctx.deps.dom,
    ctx.deps.limits,
    textures,
    report,
    ctx.pipeline.meta,
    ctx.deps.log,
    usage,
    ctx.pipeline.meta.ifRevision
  );
  if (isResponseError(applyRes)) return applyRes;
  const result: ApplyTextureSpecResult = {
    applied: true,
    report: applyRes.data,
    ...(recovery
      ? {
          recovery,
          uvUsageId: ctx.currentUvUsageId
        }
      : {})
  };
  ctx.steps.textures = result;
  return { ok: true, data: result };
};

