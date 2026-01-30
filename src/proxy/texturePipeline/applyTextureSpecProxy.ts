import { collectTextureTargets } from '../../domain/uvTargets';
import type { ApplyTextureSpecPayload } from '../../spec';
import type { ToolResponse } from '../../types';
import { validateTextureSpec } from '../validators';
import type { ProxyPipelineDeps } from '../types';
import { buildTexturePipelineNextActions, collectTextureLabels } from '../nextActionHelpers';
import { applyTextureSpecs } from './textureFlow';
import type { ApplyTextureSpecResult } from './types';
import { TEXTURE_PREVIEW_VALIDATE_REASON } from '../../shared/messages';
import { runProxyPipeline } from '../pipelineRunner';
import { ensureUvUsageForTargets } from '../uvGuardian';

export const applyTextureSpecProxy = async (
  deps: ProxyPipelineDeps,
  payload: ApplyTextureSpecPayload
): Promise<ToolResponse<ApplyTextureSpecResult>> => {
  return runProxyPipeline<ApplyTextureSpecPayload, ApplyTextureSpecResult>(deps, payload, {
    validate: validateTextureSpec,
    run: async (pipeline) => {
      const targets = collectTextureTargets(payload.textures);
      const autoRecoverEnabled = payload.autoRecover !== false;

      const resolved = await ensureUvUsageForTargets({
        deps,
        meta: pipeline.meta,
        targets,
        uvUsageId: payload.uvUsageId,
        autoRecover: payload.autoRecover,
        requireUv: true,
        atlas: autoRecoverEnabled ? { ifRevision: payload.ifRevision } : undefined
      });

      if (!resolved.ok) {
        return autoRecoverEnabled ? addPlanRecoveryHint(resolved) : resolved;
      }

      const recovery = resolved.data.recovery;
      const recoveredUvUsageId = resolved.data.uvUsageId;
      const reportRes = await applyTextureSpecs({
        deps,
        meta: pipeline.meta,
        textures: payload.textures,
        usage: resolved.data.usage
      });
      if (!reportRes.ok) return reportRes;
      deps.log.info('applyTextureSpec applied', { textures: payload.textures.length });
      const result: ApplyTextureSpecResult = {
        applied: true,
        report: reportRes.data,
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

const addPlanRecoveryHint = <T>(response: ToolResponse<T>): ToolResponse<T> => {
  if (response.ok) return response;
  const error = response.error;
  const hint =
    'Use texture_pipeline.plan (auto-assign + auto-UV) for higher-level recovery if autoRecover fails.';
  const fix = error.fix ? `${error.fix} ${hint}` : hint;
  return { ok: false, error: { ...error, fix } };
};
