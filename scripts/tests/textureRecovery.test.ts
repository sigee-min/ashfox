import assert from 'node:assert/strict';

import type { TextureUsageResult } from '../../src/ports/editor';
import { computeTextureUsageId } from '../../src/domain/textureUsage';
import { DEFAULT_UV_POLICY } from '../../src/domain/uv/policy';
import { toDomainTextureUsage } from '../../src/usecases/domainMappers';
import { ensureUvUsageForTargets } from '../../src/proxy/uvGuardian';
import { DEFAULT_LIMITS, makeProxyDeps, noopLog, registerAsync } from './helpers';

const usageResult: TextureUsageResult = {
  textures: [
    {
      id: 'tex-1',
      name: 'tex',
      cubeCount: 2,
      faceCount: 2,
      cubes: [
        {
          id: 'cube-1',
          name: 'cube-1',
          faces: [{ face: 'north', uv: [0, 0, 16, 16] }]
        },
        {
          id: 'cube-2',
          name: 'cube-2',
          faces: [{ face: 'south', uv: [8, 8, 16, 16] }]
        }
      ]
    }
  ]
};

const uvUsageId = computeTextureUsageId(toDomainTextureUsage(usageResult));

const calls = { autoUvAtlas: 0, preflight: 0 };

const project = {
  id: 'p',
  active: true,
  name: null,
  format: null,
  revision: 'r1',
  counts: { bones: 0, cubes: 0, textures: 1, animations: 0 },
  cubes: [],
  textures: [],
  animations: []
};

const service = {
  autoUvAtlas: (_payload: unknown) => {
    calls.autoUvAtlas += 1;
    return {
      ok: true,
      value: { applied: true, steps: 1, resolution: { width: 16, height: 16 }, textures: [] }
    };
  },
  preflightTexture: (_payload: unknown) => {
    calls.preflight += 1;
    return {
      ok: true,
      value: {
        uvUsageId,
        usageSummary: { textureCount: 1, cubeCount: 1, faceCount: 1, unresolvedCount: 0 }
      }
    };
  },
  getTextureUsage: (_payload: unknown) => ({ ok: true, value: usageResult }),
  getProjectState: (_payload: unknown) => ({ ok: true, value: { project } }),
  getUvPolicy: () => DEFAULT_UV_POLICY
};

const deps = makeProxyDeps({
  service,
  log: noopLog,
  limits: DEFAULT_LIMITS
});

const meta = { includeState: false, includeDiff: false, diffDetail: 'summary' } as const;
registerAsync(
  (async () => {
    const res = await ensureUvUsageForTargets({
      deps,
      meta,
      targets: { ids: new Set<string>(), names: new Set(['tex']) },
      uvUsageId
    });
    assert.equal(res.ok, false);
    assert.equal(calls.autoUvAtlas, 0);
    assert.equal(calls.preflight, 0);
  })()
);


