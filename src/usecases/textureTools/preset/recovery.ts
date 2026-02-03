import type { GenerateTexturePresetPayload } from '../../../types';
import { computeTextureUsageId } from '../../../domain/textureUsage';
import { toDomainTextureUsage } from '../../domainMappers';
import { fail, ok, type UsecaseResult } from '../../result';
import { runAutoUvAtlas } from '../autoUvAtlas';
import type { TextureToolContext } from '../context';
import type { TextureUsage } from '../../../domain/model';

export const tryAutoRecoverPreset = (
  ctx: TextureToolContext,
  payload: GenerateTexturePresetPayload
): UsecaseResult<{ uvUsageId: string; usage: TextureUsage; resolution?: { width: number; height: number } }> => {
  const atlasRes = runAutoUvAtlas(ctx, { apply: true, ifRevision: payload.ifRevision });
  if (!atlasRes.ok) return atlasRes;
  const usageRes = ctx.editor.getTextureUsage({});
  if (usageRes.error) return fail(usageRes.error);
  const usage = toDomainTextureUsage(usageRes.result ?? { textures: [] });
  const uvUsageId = computeTextureUsageId(usage, atlasRes.value.resolution);
  return ok({ uvUsageId, usage, resolution: atlasRes.value.resolution });
};
