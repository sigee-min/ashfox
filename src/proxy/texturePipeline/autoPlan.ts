import type { TexturePipelinePlan } from '../../spec';
import type { ToolResponse } from '../../types';
import { toDomainCube } from '../../usecases/domainMappers';
import { usecaseError } from '../errorAdapter';
import { isUsecaseError } from '../../shared/tooling/responseGuards';
import { loadProjectState } from '../projectState';
import type { TexturePipelineContext } from './steps';
import { applyTextureSpecSteps, createApplyReport } from '../apply';
import { TEXTURE_PLAN_NO_CUBES } from '../../shared/messages';
import { buildAutoPlan } from './autoPlanBuilder';

export const runAutoPlanStep = async (
  ctx: TexturePipelineContext,
  plan: TexturePipelinePlan,
  options: { planOnly: boolean; ifRevision?: string; reuseExistingTextures?: boolean }
): Promise<ToolResponse<void>> => {
  const projectRes = loadProjectState(ctx.deps.service, ctx.pipeline.meta, 'full', { includeUsage: false });
  if (!projectRes.ok) return projectRes;
  const project = projectRes.data;
  const cubes = (project.cubes ?? []).map((cube) => toDomainCube(cube));
  if (cubes.length === 0) {
    return ctx.pipeline.error({ code: 'invalid_state', message: TEXTURE_PLAN_NO_CUBES });
  }

  const buildRes = buildAutoPlan({
    plan,
    cubes,
    textures: project.textures ?? [],
    caps: ctx.deps.service.listCapabilities(),
    policy: ctx.deps.service.getUvPolicy(),
    format: project.format ?? undefined,
    reuseExistingTextures: options.reuseExistingTextures
  });
  if (!buildRes.ok) {
    return ctx.pipeline.error(buildRes.error);
  }

  const { detail, padding, layout, groups, atlas, uvPlan, uvUsageId, notes, textureSpecs } = buildRes.data;
  const planNotes = notes.length > 0 ? notes : undefined;
  const createdNames = new Set(
    textureSpecs
      .filter((spec) => spec.mode === 'create')
      .map((spec) => (spec.mode === 'create' ? spec.name : null))
      .filter((name): name is string => typeof name === 'string')
  );
  ctx.planCreatedTextureNames = createdNames;

  ctx.steps.plan = {
    applied: !options.planOnly,
    detail,
    resolution: layout.resolution,
    textures: groups.map((group) => ({ name: group.name, cubeCount: group.cubes.length })),
    padding,
    ...(plan.paint ? { paint: plan.paint } : {}),
    ...(planNotes ? { notes: planNotes } : {}),
    autoUvAtlas: {
      applied: !options.planOnly,
      steps: atlas.steps,
      resolution: atlas.resolution,
      textures: atlas.textures
    }
  };

  if (options.planOnly) {
    return { ok: true, data: undefined };
  }

  const currentResolution = ctx.deps.service.getProjectTextureResolution();
  if (currentResolution) {
    const nextResolution = layout.resolution;
    if (currentResolution.width !== nextResolution.width || currentResolution.height !== nextResolution.height) {
      const note = `Project texture resolution updated from ${currentResolution.width}x${currentResolution.height} to ${nextResolution.width}x${nextResolution.height}.`;
      if (ctx.steps.plan) {
        const notes = ctx.steps.plan.notes ? [...ctx.steps.plan.notes] : [];
        notes.push(note);
        ctx.steps.plan.notes = notes;
      }
    }
  }
  if (
    !currentResolution ||
    currentResolution.width !== layout.resolution.width ||
    currentResolution.height !== layout.resolution.height
  ) {
    const res = ctx.deps.service.setProjectTextureResolution({
      width: layout.resolution.width,
      height: layout.resolution.height,
      modifyUv: false,
      ifRevision: options.ifRevision
    });
    if (isUsecaseError(res)) return usecaseError(res, ctx.pipeline.meta, ctx.deps.service);
  }

  if (textureSpecs.length > 0) {
    const report = createApplyReport();
    const applyRes = await applyTextureSpecSteps(
      ctx.deps.service,
      ctx.deps.dom,
      ctx.deps.limits,
      textureSpecs,
      report,
      ctx.pipeline.meta,
      ctx.deps.log,
      undefined,
      options.ifRevision
    );
    if (!applyRes.ok) return applyRes;
  }

  const assignRes = ctx.deps.service.runWithoutRevisionGuard(() => {
    for (const group of groups) {
      const cubeIds = group.cubes.map((cube) => cube.id).filter(Boolean) as string[];
      const cubeNames = group.cubes.map((cube) => cube.name);
      const res = ctx.deps.service.assignTexture({
        textureName: group.name,
        cubeIds: cubeIds.length > 0 ? cubeIds : undefined,
        cubeNames: cubeNames.length > 0 ? cubeNames : undefined,
        ifRevision: options.ifRevision
      });
      if (isUsecaseError(res)) return usecaseError(res, ctx.pipeline.meta, ctx.deps.service);
    }
    return { ok: true as const, data: undefined };
  });
  if (!assignRes.ok) return assignRes;

  const uvUpdateRes = ctx.deps.service.runWithoutRevisionGuard(() => {
    for (const update of uvPlan.updates) {
      const res = ctx.deps.service.setFaceUv({
        cubeId: update.cubeId,
        cubeName: update.cubeName,
        faces: update.faces,
        ifRevision: options.ifRevision
      });
      if (isUsecaseError(res)) return usecaseError(res, ctx.pipeline.meta, ctx.deps.service);
    }
    return { ok: true as const, data: undefined };
  });
  if (!uvUpdateRes.ok) return uvUpdateRes;

  ctx.currentUvUsageId = uvUsageId;
  ctx.preflightUsage = uvPlan.usage;

  const planPaint = plan.paint;
  const planPreset = planPaint?.preset;
  if (planPreset) {
    const presetBatch = ctx.deps.service.runWithoutRevisionGuard(() => {
      const results = [];
      for (const group of groups) {
        const presetRes = ctx.deps.service.generateTexturePreset({
          preset: planPreset,
          width: layout.resolution.width,
          height: layout.resolution.height,
          uvUsageId,
          mode: 'update',
          targetName: group.name,
          seed: planPaint.seed,
          palette: planPaint.palette,
          ifRevision: options.ifRevision
        });
        if (isUsecaseError(presetRes)) return usecaseError(presetRes, ctx.pipeline.meta, ctx.deps.service);
        results.push(presetRes.value);
      }
      return { ok: true as const, data: results };
    });
    if (!presetBatch.ok) return presetBatch;
    const results = presetBatch.data;
    if (results.length > 0) {
      ctx.steps.presets = {
        applied: results.length,
        results,
        uvUsageId
      };
    }
  }

  return { ok: true, data: undefined };
};

