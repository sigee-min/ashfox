import assert from 'node:assert/strict';

import type { TexturePipelinePayload } from '../../src/spec';
import type { TextureUsageResult } from '../../src/ports/editor';
import { texturePipelineProxy } from '../../src/proxy/texturePipeline/texturePipelineProxy';
import { computeTextureUsageId } from '../../src/domain/textureUsage';
import { DEFAULT_UV_POLICY } from '../../src/domain/uv/policy';
import { toDomainTextureUsage } from '../../src/usecases/domainMappers';
import { createMockDom, DEFAULT_LIMITS, makeProxyDeps, ok, registerAsync } from './helpers';

const usageResult: TextureUsageResult = {
  textures: [
    {
      id: 'tex-1',
      name: 'tex',
      cubeCount: 1,
      faceCount: 1,
      cubes: [
        {
          id: 'cube-1',
          name: 'cube',
          faces: [{ face: 'north' }]
        }
      ]
    }
  ]
};

const uvUsageId = computeTextureUsageId(toDomainTextureUsage(usageResult), { width: 16, height: 16 });

const project = {
  id: 'p1',
  active: true,
  name: null,
  format: 'geckolib',
  revision: 'r1',
  counts: { bones: 0, cubes: 1, textures: 0, animations: 0 },
  textureResolution: { width: 16, height: 16 },
  bones: [],
  cubes: [
    {
      id: 'cube-1',
      name: 'cube',
      bone: 'root',
      from: [0, 0, 0],
      to: [1, 1, 1]
    }
  ],
  textures: [],
  animations: []
};

const calls = {
  preflight: 0,
  assignTexture: 0,
  setFaceUv: 0,
  importTexture: 0,
  updateTexture: 0
};

const service = {
  getProjectState: (_payload: unknown) => ok({ project }),
  listCapabilities: () =>
    ({
      limits: { maxTextureSize: 64 },
      formats: []
    }) as unknown,
  getUvPolicy: () => DEFAULT_UV_POLICY,
  getProjectTextureResolution: () => ({ width: 16, height: 16 }),
  setProjectTextureResolution: (_payload: unknown) => ok({ width: 16, height: 16 }),
  preflightTexture: (payload: { includeUsage?: boolean }) => {
    calls.preflight += 1;
    return ok({
      uvUsageId,
      usageSummary: { textureCount: 1, cubeCount: 1, faceCount: 1, unresolvedCount: 0 },
      ...(payload.includeUsage ? { textureUsage: usageResult } : {})
    });
  },
  assignTexture: (_payload: unknown) => {
    calls.assignTexture += 1;
    return ok({ textureName: 'tex', cubeCount: 1 });
  },
  setFaceUv: (_payload: unknown) => {
    calls.setFaceUv += 1;
    return ok({ cubeName: 'cube', faces: ['north'] });
  },
  importTexture: (_payload: unknown) => {
    calls.importTexture += 1;
    return ok({ id: 'tex-1', name: 'tex' });
  },
  updateTexture: (_payload: unknown) => {
    calls.updateTexture += 1;
    return ok({ id: 'tex-1', name: 'tex' });
  },
  readTexture: (_payload: unknown) =>
    ok({
      name: 'tex',
      width: 16,
      height: 16,
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,'
    })
};

const deps = makeProxyDeps({
  service,
  dom: createMockDom(),
  limits: DEFAULT_LIMITS
});

const payload: TexturePipelinePayload = {
  textures: [
    {
      mode: 'update',
      targetName: 'tex',
      width: 16,
      height: 16,
      background: '#ff0000'
    }
  ]
};

registerAsync(
  (async () => {
    const res = await texturePipelineProxy(deps, payload);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.data.applied, true);
      assert.ok(res.data.steps.textures);
    }
    assert.ok(calls.preflight > 0);
    assert.ok(calls.assignTexture > 0);
    assert.ok(calls.setFaceUv > 0);
    assert.ok(calls.importTexture > 0);
    assert.ok(calls.updateTexture > 0);
  })()
);


