import { collectTextureTargets } from '../../domain/uvTargets';
import type { ApplyTextureSpecPayload } from '../../spec';
import type { ToolResponse } from '../../types';
import { validateTextureSpec } from '../validators';
import type { ProxyPipelineDeps } from '../types';
import { buildTexturePipelineNextActions, collectTextureLabels } from '../nextActionHelpers';
import { resolveTextureUsageForTargets } from './usageResolver';
import { applyTextureSpecs } from './textureFlow';
import type { ApplyTextureSpecResult } from './types';
import { TEXTURE_PREVIEW_VALIDATE_REASON } from '../../shared/messages';
import { runProxyPipeline } from '../pipelineRunner';

export const applyTextureSpecProxy = async (
  deps: ProxyPipelineDeps,
  payload: ApplyTextureSpecPayload
): Promise<ToolResponse<ApplyTextureSpecResult>> => {
  return runProxyPipeline(deps, payload, {
    validate: validateTextureSpec,
    run: async (pipeline) => {
    const targets = collectTextureTargets(payload.textures);
    const payloadNoRecover = payload.autoRecover ? { ...payload, autoRecover: false } : payload;
    const resolved = resolveTextureUsageForTargets({
      deps,
      payload: payloadNoRecover,
      meta: pipeline.meta,
      targets,
      uvUsageId: payload.uvUsageId
    });
    if (!resolved.ok) {
      if (payload.autoRecover) {
        return addPlanRecoveryHint(resolved);
      }
      return resolved;
    }
    const recovery = resolved.recovery;
    const recoveredUvUsageId = resolved.uvUsageId;
    const report = pipeline.require(
      await applyTextureSpecs({
        deps,
        meta: pipeline.meta,
        textures: payload.textures,
        usage: resolved.usage
      })
    );
    deps.log.info('applyTextureSpec applied', { textures: payload.textures.length });
    const result: ApplyTextureSpecResult = {
      applied: true,
      report,
      ...(recovery
        ? {
            recovery,
            uvUsageId: recoveredUvUsageId
          }
        : {})
    };
    const response = pipeline.ok(result);

    const textureLabels = collectTextureLabels(payload.textures);
    const nextActions = buildTexturePipelineNextActions({
      textureLabels,
      didPaint: true,
      didAssign: false,
      didPreview: false,
      assign: {
        includeAssignTool: true,
        includeGuide: true,
        priorityBase: 1
      },
      preview: {
        reason: TEXTURE_PREVIEW_VALIDATE_REASON,
        priorityBase: 5,
        includeStateFetch: false
      }
    });
    return {
      ...response,
      nextActions
    };
    }
  });
};

const addPlanRecoveryHint = (response: ToolResponse<unknown>): ToolResponse<never> => {
  if (response.ok) return response as ToolResponse<never>;
  const error = response.error;
  const hint =
    'Use texture_pipeline.plan (auto-assign + auto-UV) to recover UV scale/overlap issues instead of auto_uv_atlas.';
  const fix = error.fix ? `${error.fix} ${hint}` : hint;
  return { ok: false, error: { ...error, fix } };
};
