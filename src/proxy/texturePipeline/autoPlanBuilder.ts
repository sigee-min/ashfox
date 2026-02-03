import type { Cube } from '../../domain/model';
import { buildUvApplyPlan } from '../../domain/uv/apply';
import { computeTextureUsageId } from '../../domain/textureUsage';
import type { UvPolicyConfig } from '../../domain/uv/policy';
import type { TexturePipelinePlan } from '../../spec';
import type { DomainResult } from '../../domain/result';
import { ok } from '../../domain/result';
import { buildUvApplyMessages } from '../../shared/messages';
import { buildAutoPlanContext } from './autoPlan/context';
import { buildTextureSpecs } from './autoPlan/specs';
import { buildAtlasWithRetries } from './autoPlan/atlas';
import { buildUsage, buildUvAssignments } from './autoPlan/usage';
import type { AutoPlanBuildResult } from './autoPlan/types';

export type { AutoPlanBuildResult, AutoPlanContext, AutoPlanTextureSpec } from './autoPlan/types';

const uvApplyMessages = buildUvApplyMessages();

export const buildAutoPlan = (args: {
  plan: TexturePipelinePlan;
  cubes: Cube[];
  textures: Array<{ name: string }>;
  caps: { limits: { maxTextureSize: number }; formats: Array<{ format: string; flags?: { singleTexture?: boolean; perTextureUvSize?: boolean } }> };
  policy: UvPolicyConfig;
  format?: string;
  reuseExistingTextures?: boolean;
}): DomainResult<AutoPlanBuildResult> => {
  const notes: string[] = [];
  const context = buildAutoPlanContext({ ...args, notes });
  const usage = buildUsage(context.groups, context.layout.resolution);
  const atlasRes = buildAtlasWithRetries({
    usage,
    cubes: args.cubes,
    resolution: context.layout.resolution,
    padding: context.padding,
    policy: args.policy,
    ppuTarget: context.layout.ppuUsed,
    notes
  });
  if (!atlasRes.ok) {
    return atlasRes;
  }
  const atlas = atlasRes.data;

  const assignments = buildUvAssignments(atlas.assignments);
  const uvPlanRes = buildUvApplyPlan(usage, args.cubes, assignments, context.layout.resolution, uvApplyMessages);
  if (!uvPlanRes.ok) {
    return uvPlanRes;
  }

  const uvUsageId = computeTextureUsageId(uvPlanRes.data.usage, context.layout.resolution);
  const reuseExisting = args.reuseExistingTextures === true;
  const textureSpecs = buildTextureSpecs(context.groups, context.layout.resolution, args.plan.paint?.background, {
    existingNames: context.existingNames,
    reuseExisting,
    allowExistingUpdate: reuseExisting || Boolean(args.plan.paint?.background)
  });

  return ok({
    detail: context.detail,
    padding: context.padding,
    layout: context.layout,
    groups: context.groups,
    atlas,
    uvPlan: uvPlanRes.data,
    uvUsageId,
    notes,
    textureSpecs
  });
};

