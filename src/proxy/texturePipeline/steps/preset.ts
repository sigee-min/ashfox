import type { TexturePipelinePayload } from '../../../spec';
import type { ToolResponse, GenerateTexturePresetResult } from '../../../types';
import { UV_USAGE_MISSING_MESSAGE } from '../../../shared/messages';
import type { TexturePipelineContext } from './context';
import type { UvRecoveryInfo } from '../../uvRecovery';
import { runPipelineBatch } from './batch';
import { isResponseError } from '../../../shared/tooling/responseGuards';

export const runPresetStep = (
  ctx: TexturePipelineContext,
  presets: NonNullable<TexturePipelinePayload['presets']>,
  recovery?: UvRecoveryInfo,
  ifRevision?: string
): ToolResponse<void> => {
  const uvUsageId = ctx.currentUvUsageId;
  if (!uvUsageId) {
    return ctx.pipeline.error({
      code: 'invalid_state',
      message: UV_USAGE_MISSING_MESSAGE,
      details: { reason: 'uv_usage_missing' }
    });
  }
  const batch = ctx.deps.service.runWithoutRevisionGuard(() =>
    runPipelineBatch(presets, (preset) =>
      ctx.pipeline.wrap(
        ctx.deps.service.generateTexturePreset({
          preset: preset.preset,
          width: preset.width,
          height: preset.height,
          uvUsageId,
          name: preset.name,
          targetId: preset.targetId,
          targetName: preset.targetName,
          mode: preset.mode,
          seed: preset.seed,
          palette: preset.palette,
          uvPaint: preset.uvPaint,
          ifRevision
        })
      )
    )
  );
  if (isResponseError(batch)) return batch;
  const results = batch.data as GenerateTexturePresetResult[];
  const existing = ctx.steps.presets;
  const mergedResults = existing ? [...existing.results, ...results] : results;
  const applied = (existing?.applied ?? 0) + results.length;
  const nextRecovery = existing?.recovery ?? recovery;
  const nextUvUsageId = existing?.uvUsageId ?? (recovery ? uvUsageId : undefined);
  ctx.steps.presets = {
    applied,
    results: mergedResults,
    ...(nextRecovery
      ? {
          recovery: nextRecovery,
          uvUsageId: nextUvUsageId
        }
      : {})
  };
  return { ok: true, data: undefined };
};

