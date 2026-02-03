import type { ToolResponse } from '../types';
import type { MetaOptions } from './meta';
import type { ProxyPipelineDeps } from './types';
import { usecaseError } from './errorAdapter';
import { isUsecaseError } from '../shared/tooling/responseGuards';
import { TEXTURE_DELETE_IN_USE } from '../shared/messages';

export type TextureCleanupEntry = { id?: string; name?: string };

export type TextureCleanupResult = {
  applied: number;
  deleted: Array<{ id?: string; name: string }>;
};

export const applyTextureCleanup = (
  deps: ProxyPipelineDeps,
  meta: MetaOptions,
  entries: TextureCleanupEntry[],
  force: boolean,
  ifRevision?: string
): ToolResponse<TextureCleanupResult> => {
  const resolved = entries.map((entry) => resolveCleanupEntry(entry));
  const blocked: Array<{ id?: string; name: string; cubeCount: number; faceCount: number }> = [];

  for (const entry of resolved) {
    const usageRes = deps.service.getTextureUsage({ textureId: entry.id, textureName: entry.name });
    if (isUsecaseError(usageRes)) return usecaseError(usageRes, meta, deps.service);
    const usageEntry = usageRes.value.textures[0];
    const name = usageEntry?.name ?? entry.name ?? entry.id ?? 'texture';
    const cubeCount = usageEntry?.cubeCount ?? 0;
    const faceCount = usageEntry?.faceCount ?? 0;
    entry.name = usageEntry?.name ?? entry.name;
    entry.id = usageEntry?.id ?? entry.id;
    if (!force && (cubeCount > 0 || faceCount > 0)) {
      blocked.push({ id: entry.id, name, cubeCount, faceCount });
    }
  }

  if (blocked.length > 0) {
    const names = blocked
      .slice(0, 3)
      .map((entry) => `"${entry.name}"`)
      .join(', ');
    const suffix = blocked.length > 3 ? ` (+${blocked.length - 3} more)` : '';
    return {
      ok: false,
      error: {
        code: 'invalid_state',
        message: TEXTURE_DELETE_IN_USE(names, suffix, blocked.length !== 1),
        details: {
          reason: 'texture_in_use',
          blocked
        }
      }
    };
  }

  const deleted: Array<{ id?: string; name: string }> = [];
  const deleteRes = deps.service.runWithoutRevisionGuard(() => {
    for (const entry of resolved) {
      const res = deps.service.deleteTexture({ id: entry.id, name: entry.name, ifRevision });
      if (isUsecaseError(res)) return usecaseError(res, meta, deps.service);
      deleted.push({ id: res.value.id, name: res.value.name });
    }
    return { ok: true as const, data: undefined };
  });
  if (!deleteRes.ok) return deleteRes;

  return { ok: true, data: { applied: deleted.length, deleted } };
};

const resolveCleanupEntry = (entry: TextureCleanupEntry): TextureCleanupEntry => ({
  id: entry.id,
  name: entry.name
});



