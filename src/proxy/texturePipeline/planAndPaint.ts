import type { FacePaintSpec, TexturePipelinePlan, TexturePipelinePreset, TextureSpec } from '../../spec';
import type { ToolResponse } from '../../types';
import { runAutoPlanStep } from './autoPlan';
import { runFacePaintWorkflow } from './facePaintWorkflow';
import { collectPlanCreateConflicts } from './planConflicts';
import { TEXTURE_PLAN_DUPLICATE_CREATE, TEXTURE_PLAN_DUPLICATE_CREATE_FIX } from '../../shared/messages';
import type { TexturePipelineContext } from './steps';

type PlanConflictSources = {
  textures?: TextureSpec[];
  presets?: TexturePipelinePreset[];
};

export type PlanAndPaintOptions = {
  ctx: TexturePipelineContext;
  plan?: TexturePipelinePlan;
  planOnly: boolean;
  ifRevision?: string;
  facePaintEntries: FacePaintSpec[];
  conflictSources?: PlanConflictSources;
  reuseExistingTextures?: boolean;
  resolutionOverride?: { width?: number; height?: number } | null;
};

export const runPlanAndFacePaint = async (options: PlanAndPaintOptions): Promise<ToolResponse<void>> => {
  const {
    ctx,
    plan,
    planOnly,
    ifRevision,
    facePaintEntries,
    conflictSources,
    reuseExistingTextures,
    resolutionOverride
  } = options;

  if (plan) {
    const planRes = await runAutoPlanStep(ctx, plan, { planOnly, ifRevision, reuseExistingTextures });
    if (!planRes.ok) return planRes;
  }

  const planTextureNames = ctx.planCreatedTextureNames ?? new Set<string>();

  if (!planOnly && planTextureNames.size > 0) {
    const conflicts = collectPlanCreateConflicts({
      textures: conflictSources?.textures,
      presets: conflictSources?.presets,
      planTextureNames
    });
    if (conflicts.length > 0) {
      return ctx.pipeline.error({
        code: 'invalid_payload',
        message: TEXTURE_PLAN_DUPLICATE_CREATE(conflicts.join(', ')),
        fix: TEXTURE_PLAN_DUPLICATE_CREATE_FIX,
        details: {
          reason: 'plan_texture_exists',
          textures: conflicts,
          planTextures: Array.from(planTextureNames)
        }
      });
    }
  }

  if (!planOnly && facePaintEntries.length > 0) {
    const facePaintRes = await runFacePaintWorkflow({
      ctx,
      entries: facePaintEntries,
      plan: {
        existingPlan: plan ?? null,
        ifRevision,
        reuseExistingTextures: reuseExistingTextures !== false
      },
      ifRevision,
      resolutionOverride: resolutionOverride ?? ctx.steps.plan?.resolution
    });
    if (!facePaintRes.ok) return facePaintRes;
    if (facePaintRes.data.applied > 0) {
      ctx.steps.facePaint = {
        applied: facePaintRes.data.applied,
        materials: facePaintRes.data.materials,
        textures: facePaintRes.data.textures,
        ...(facePaintRes.data.textureIds.length > 0 ? { textureIds: facePaintRes.data.textureIds } : {}),
        ...(facePaintRes.data.uvUsageId ? { uvUsageId: facePaintRes.data.uvUsageId } : {}),
        ...(facePaintRes.data.recovery ? { recovery: facePaintRes.data.recovery } : {})
      };
    }
  }

  return { ok: true, data: undefined };
};
