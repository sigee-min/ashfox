import type { GenerateTexturePresetPayload, GenerateTexturePresetResult } from '../../types';
import { withActiveAndRevision } from '../guards';
import { fail, ok, type UsecaseResult } from '../result';
import type { TextureToolContext } from './context';
import { buildPaintedTexture } from './preset/paint';
import { upsertTextureFromPreset } from './preset/update';
import { tryAutoRecoverPreset } from './preset/recovery';
import { isUvRecoveryCandidate, resolveRecoveredPresetSize, validateTexturePresetContext } from './preset/context';

export const runGenerateTexturePreset = (
  ctx: TextureToolContext,
  payload: GenerateTexturePresetPayload
): UsecaseResult<GenerateTexturePresetResult> => {
  return withActiveAndRevision(ctx.ensureActive, ctx.ensureRevisionMatch, payload.ifRevision, () => {
    let effectivePayload = payload;
    let ctxRes = validateTexturePresetContext(ctx, effectivePayload);
    if (!ctxRes.ok && isUvRecoveryCandidate(ctxRes.error)) {
      const recovery = tryAutoRecoverPreset(ctx, payload);
      if (!recovery.ok) return fail(recovery.error);
      const recoveredSize = resolveRecoveredPresetSize(payload, recovery.value);
      const retryPayload = {
        ...payload,
        uvUsageId: recovery.value.uvUsageId,
        ...(recoveredSize ? { width: recoveredSize.width, height: recoveredSize.height } : {})
      };
      effectivePayload = retryPayload;
      ctxRes = validateTexturePresetContext(ctx, retryPayload);
    }
    if (!ctxRes.ok) return fail(ctxRes.error);
    const paintRes = buildPaintedTexture(ctx, ctxRes.value);
    if (!paintRes.ok) return fail(paintRes.error);
    const { image, coverage } = paintRes.value;
    const updateRes = upsertTextureFromPreset(ctx, effectivePayload, ctxRes.value, image);
    if (!updateRes.ok) return fail(updateRes.error);
    return ok({
      textureId: updateRes.value.id,
      textureName: updateRes.value.name,
      preset: payload.preset,
      mode: ctxRes.value.mode,
      width: ctxRes.value.width,
      height: ctxRes.value.height,
      seed: ctxRes.value.preset.seed,
      coverage
    });
  });
};
