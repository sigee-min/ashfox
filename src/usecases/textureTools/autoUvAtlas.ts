import type { AutoUvAtlasPayload, AutoUvAtlasResult } from '../../types';
import { buildUvAtlasPlan } from '../../domain/uv/atlas';
import { toDomainSnapshot, toDomainTextureUsage } from '../domainMappers';
import { withActiveOnly } from '../guards';
import { fromDomainResult } from '../fromDomain';
import { fail, ok, type UsecaseResult } from '../result';
import {
  TEXTURE_AUTO_UV_NO_TEXTURES,
  TEXTURE_AUTO_UV_RESOLUTION_MISSING,
  TEXTURE_AUTO_UV_UNRESOLVED_REFS
} from '../../shared/messages';
import type { TextureToolContext } from './context';
import { uvAtlasMessages } from './context';

export const runAutoUvAtlas = (
  ctx: TextureToolContext,
  payload: AutoUvAtlasPayload
): UsecaseResult<AutoUvAtlasResult> => {
  return withActiveOnly<AutoUvAtlasResult>(ctx.ensureActive, () => {
    const apply = payload.apply !== false;
    if (apply) {
      const revisionErr = ctx.ensureRevisionMatch(payload.ifRevision);
      if (revisionErr) return fail(revisionErr);
    }
    const usageRes = ctx.editor.getTextureUsage({});
    if (usageRes.error) return fail(usageRes.error);
    const usageRaw = usageRes.result ?? { textures: [] };
    const usage = toDomainTextureUsage(usageRaw);
    if (usage.textures.length === 0) {
      return fail({ code: 'invalid_state', message: TEXTURE_AUTO_UV_NO_TEXTURES });
    }
    const unresolvedCount = usage.unresolved?.length ?? 0;
    if (unresolvedCount > 0) {
      return fail({
        code: 'invalid_state',
        message: TEXTURE_AUTO_UV_UNRESOLVED_REFS(unresolvedCount)
      });
    }
    const resolution = ctx.editor.getProjectTextureResolution();
    if (!resolution) {
      return fail({
        code: 'invalid_state',
        message: TEXTURE_AUTO_UV_RESOLUTION_MISSING
      });
    }
    const padding =
      typeof payload.padding === 'number' && Number.isFinite(payload.padding)
        ? Math.max(0, Math.trunc(payload.padding))
        : 0;
    const snapshot = ctx.getSnapshot();
    const domainSnapshot = toDomainSnapshot(snapshot);
    const planRes = fromDomainResult(
      buildUvAtlasPlan({
        usage,
        cubes: domainSnapshot.cubes,
        resolution,
        maxResolution: { width: ctx.capabilities.limits.maxTextureSize, height: ctx.capabilities.limits.maxTextureSize },
        padding,
        policy: ctx.getUvPolicyConfig(),
        messages: uvAtlasMessages
      })
    );
    if (!planRes.ok) return fail(planRes.error);
    const plan = planRes.value;
    if (!apply) {
      return ok({
        applied: false,
        steps: plan.steps,
        resolution: plan.resolution,
        textures: plan.textures
      });
    }
    if (plan.resolution.width !== resolution.width || plan.resolution.height !== resolution.height) {
      const err = ctx.editor.setProjectTextureResolution(plan.resolution.width, plan.resolution.height, false);
      if (err) return fail(err);
    }
    const updatesByCube = new Map<string, Record<string, [number, number, number, number]>>();
    plan.assignments.forEach((assignment) => {
      const entry = updatesByCube.get(assignment.cubeName) ?? {};
      entry[assignment.face] = assignment.uv;
      updatesByCube.set(assignment.cubeName, entry);
    });
    const cubeIdByName = new Map(snapshot.cubes.map((cube) => [cube.name, cube.id]));
    for (const [cubeName, faces] of updatesByCube.entries()) {
      const cubeId = cubeIdByName.get(cubeName);
      const err = ctx.editor.setFaceUv({ cubeId, cubeName, faces });
      if (err) return fail(err);
    }
    return ok({
      applied: true,
      steps: plan.steps,
      resolution: plan.resolution,
      textures: plan.textures
    });
  });
};

