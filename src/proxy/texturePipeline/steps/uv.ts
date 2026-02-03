import type { TexturePipelinePayload } from '../../../spec';
import type { ToolResponse } from '../../../types';
import { applyUvAssignments } from '../../uvApplyStep';
import { UV_USAGE_MISSING_MESSAGE } from '../../../shared/messages';
import type { TexturePipelineContext } from './context';
import { isResponseError } from '../../../shared/tooling/responseGuards';

export const runUvStep = (
  ctx: TexturePipelineContext,
  assignments: NonNullable<TexturePipelinePayload['uv']>['assignments'],
  ifRevision?: string
): ToolResponse<void> => {
  const uvRes = applyUvAssignments(ctx.deps, ctx.pipeline.meta, {
    assignments,
    uvUsageId: ctx.currentUvUsageId,
    uvUsageMessage: UV_USAGE_MISSING_MESSAGE,
    ifRevision,
    usageOverride: ctx.preflightUsage
  });
  if (isResponseError(uvRes)) return uvRes;
  ctx.steps.uv = {
    applied: true,
    cubes: uvRes.data.cubeCount,
    faces: uvRes.data.faceCount,
    uvUsageId: uvRes.data.uvUsageId
  };
  ctx.currentUvUsageId = uvRes.data.uvUsageId;
  ctx.preflightUsage = uvRes.data.usage;
  return { ok: true, data: undefined };
};


