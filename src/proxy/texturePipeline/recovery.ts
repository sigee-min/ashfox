import type { TextureUsage } from '../../domain/model';
import type { TextureTargetSet } from '../../domain/uvTargets';
import { isRecord } from '../../domain/guards';
import type { ToolError, ToolResponse } from '../../types';
import { guardUvForTextureTargets } from '../uvGuard';
import type { MetaOptions } from '../meta';
import { withErrorMeta } from '../meta';
import type { ProxyPipelineDeps } from './types';

type UvGuardFailure = 'overlap' | 'scale' | 'usage_mismatch' | 'unknown';

const classifyUvGuardFailure = (error: ToolError): UvGuardFailure => {
  if (error.code !== 'invalid_state') return 'unknown';
  const details = error.details;
  if (!isRecord(details)) return 'unknown';
  if (Array.isArray(details.overlaps) && details.overlaps.length > 0) return 'overlap';
  if (Array.isArray(details.mismatches) && details.mismatches.length > 0) return 'scale';
  if (typeof details.expected === 'string' && typeof details.current === 'string') return 'usage_mismatch';
  return 'unknown';
};

export const tryRecoverUvForTextureSpec = (
  deps: ProxyPipelineDeps,
  payload: { autoRecover?: boolean },
  meta: MetaOptions,
  targets: TextureTargetSet,
  error: ToolError
): ToolResponse<{ usage: TextureUsage; uvUsageId: string; recovery: Record<string, unknown> }> | null => {
  if (!payload.autoRecover) return null;
  const failure = classifyUvGuardFailure(error);
  if (failure === 'unknown') return null;

  const recovery: Record<string, unknown> = { reason: failure };
  if (failure === 'overlap' || failure === 'scale') {
    const atlasRes = deps.service.autoUvAtlas({ apply: true, ifRevision: meta.ifRevision });
    if (!atlasRes.ok) return withErrorMeta(atlasRes.error, meta, deps.service);
    recovery.autoUvAtlas = atlasRes.value;
  }

  const preflightRes = deps.service.preflightTexture({});
  if (!preflightRes.ok) return withErrorMeta(preflightRes.error, meta, deps.service);
  recovery.uvUsageId = preflightRes.value.uvUsageId;

  const guardRes = guardUvForTextureTargets(deps.service, meta, preflightRes.value.uvUsageId, targets);
  if (!guardRes.ok) return guardRes;
  return {
    ok: true,
    data: {
      usage: guardRes.data.usage,
      uvUsageId: preflightRes.value.uvUsageId,
      recovery
    }
  };
};
