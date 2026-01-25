import { buildRenderPreviewContent, buildRenderPreviewStructured } from '../../mcp/content';
import { computeTextureUsageId } from '../../domain/textureUsage';
import { buildUvApplyPlan } from '../../domain/uvApply';
import type { TextureUsage } from '../../domain/model';
import { collectTextureTargets } from '../../domain/uvTargets';
import { toDomainCube, toDomainTextureUsage } from '../../usecases/domainMappers';
import { applyTextureSpecSteps, createApplyReport } from '../apply';
import { withErrorMeta } from '../meta';
import { createProxyPipeline } from '../pipeline';
import { toToolResponse } from '../../services/toolResponse';
import { guardUvForTextureTargets, guardUvForUsage } from '../uvGuard';
import { validateTexturePipeline } from '../validators';
import type { TexturePipelinePayload } from '../../spec';
import type { ToolResponse } from '../../types';
import { tryRecoverUvForTextureSpec } from './recovery';
import type { ProxyPipelineDeps } from './types';

export const texturePipelineProxy = async (
  deps: ProxyPipelineDeps,
  payload: TexturePipelinePayload
): Promise<ToolResponse<unknown>> => {
  const v = validateTexturePipeline(payload, deps.limits);
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
    const steps: Record<string, unknown> = {};
    const includePreflight = Boolean(payload.preflight);
    const includeUsage = Boolean(payload.preflight?.includeUsage);
    let currentUvUsageId: string | undefined;

    if (payload.assign && payload.assign.length > 0) {
      const results: Array<{ textureId?: string; textureName: string; cubeCount: number; faces?: string[] }> = [];
      for (const entry of payload.assign) {
        const res = deps.service.assignTexture({
          textureId: entry.textureId,
          textureName: entry.textureName,
          cubeIds: entry.cubeIds,
          cubeNames: entry.cubeNames,
          faces: entry.faces,
          ifRevision: payload.ifRevision
        });
        if (!res.ok) return withErrorMeta(res.error, pipeline.meta, deps.service);
        results.push(res.value);
      }
      steps.assign = { applied: results.length, results };
    }

    const needsPreflight = Boolean(
      payload.preflight ||
        payload.uv ||
        (payload.textures && payload.textures.length > 0) ||
        (payload.presets && payload.presets.length > 0)
    );
    if (needsPreflight) {
      const preflightRes = deps.service.preflightTexture({ includeUsage });
      if (!preflightRes.ok) return withErrorMeta(preflightRes.error, pipeline.meta, deps.service);
      currentUvUsageId = preflightRes.value.uvUsageId;
      if (includePreflight) {
        steps.preflight = { before: preflightRes.value };
      }
    }

    if (payload.uv) {
      if (!currentUvUsageId) {
        return withErrorMeta(
          { code: 'invalid_state', message: 'uvUsageId is missing. Call preflight_texture first.' },
          pipeline.meta,
          deps.service
        );
      }
      const usageRes = deps.service.getTextureUsage({});
      if (!usageRes.ok) return withErrorMeta(usageRes.error, pipeline.meta, deps.service);
      const usage = toDomainTextureUsage(usageRes.value);
      const stateRes = deps.service.getProjectState({ detail: 'full' });
      if (!stateRes.ok) return withErrorMeta(stateRes.error, pipeline.meta, deps.service);
      const project = stateRes.value.project;
      const planRes = buildUvApplyPlan(
        usage,
        (project.cubes ?? []).map((cube) => toDomainCube(cube)),
        payload.uv.assignments,
        project.textureResolution
      );
      if (!planRes.ok) return withErrorMeta(planRes.error, pipeline.meta, deps.service);
      const targets = collectTextureTargets(planRes.data.touchedTextures);
      const usageGuard = guardUvForTextureTargets(deps.service, pipeline.meta, currentUvUsageId, targets);
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
      steps.uv = {
        applied: true,
        cubes: planRes.data.cubeCount,
        faces: planRes.data.faceCount,
        uvUsageId: nextUsageId
      };
      currentUvUsageId = nextUsageId;

      const preflightRes = deps.service.preflightTexture({ includeUsage });
      if (!preflightRes.ok) return withErrorMeta(preflightRes.error, pipeline.meta, deps.service);
      currentUvUsageId = preflightRes.value.uvUsageId;
      if (includePreflight) {
        const existing = (steps.preflight ?? {}) as Record<string, unknown>;
        steps.preflight = { ...existing, after: preflightRes.value };
      }
    }

    const textures = payload.textures ?? [];
    const presets = payload.presets ?? [];
    if (textures.length > 0 || presets.length > 0) {
      if (!currentUvUsageId) {
        const preflightRes = deps.service.preflightTexture({ includeUsage });
        if (!preflightRes.ok) return withErrorMeta(preflightRes.error, pipeline.meta, deps.service);
        currentUvUsageId = preflightRes.value.uvUsageId;
        if (includePreflight) {
          const existing = (steps.preflight ?? {}) as Record<string, unknown>;
          steps.preflight = { ...existing, before: preflightRes.value };
        }
      }
      const targets = collectTextureTargets([...textures, ...presets]);
      const uvGuard = guardUvForTextureTargets(deps.service, pipeline.meta, currentUvUsageId, targets);
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
        currentUvUsageId = recoveredUvUsageId;
      } else {
        usage = uvGuard.data.usage;
      }

      if (textures.length > 0) {
        const report = createApplyReport();
        const applyRes = await applyTextureSpecSteps(
          deps.service,
          deps.dom,
          deps.limits,
          textures,
          report,
          pipeline.meta,
          deps.log,
          usage ?? undefined
        );
        if (!applyRes.ok) return applyRes;
        steps.textures = {
          applied: true,
          report,
          ...(recovery
            ? {
                recovery,
                uvUsageId: currentUvUsageId
              }
            : {})
        };
      }

      if (presets.length > 0) {
        const results: unknown[] = [];
        for (const preset of presets) {
          const presetRes = deps.service.generateTexturePreset({
            preset: preset.preset,
            width: preset.width,
            height: preset.height,
            uvUsageId: currentUvUsageId ?? '',
            name: preset.name,
            targetId: preset.targetId,
            targetName: preset.targetName,
            mode: preset.mode,
            seed: preset.seed,
            palette: preset.palette,
            uvPaint: preset.uvPaint,
            ifRevision: payload.ifRevision
          });
          if (!presetRes.ok) return withErrorMeta(presetRes.error, pipeline.meta, deps.service);
          results.push(presetRes.value);
        }
        steps.presets = {
          applied: results.length,
          results,
          ...(recovery
            ? {
                recovery,
                uvUsageId: currentUvUsageId
              }
            : {})
        };
      }
    }

    let content;
    let structuredContent;
    if (payload.preview) {
      const previewRes = toToolResponse(deps.service.renderPreview(payload.preview));
      if (!previewRes.ok) return withErrorMeta(previewRes.error, pipeline.meta, deps.service);
      steps.preview = previewRes.data;
      const previewContent = buildRenderPreviewContent(previewRes.data);
      const previewStructured = buildRenderPreviewStructured(previewRes.data);
      if (previewContent.length > 0) content = previewContent;
      structuredContent = previewStructured;
    }

    const response = pipeline.ok({
      applied: true,
      steps,
      ...(currentUvUsageId ? { uvUsageId: currentUvUsageId } : {})
    });
    if (content || structuredContent) {
      return { ...response, ...(content ? { content } : {}), ...(structuredContent ? { structuredContent } : {}) };
    }
    return response;
  });
};
