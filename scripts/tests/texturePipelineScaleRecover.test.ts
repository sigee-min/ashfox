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
      faceCount: 2,
      cubes: [
        {
          id: 'cube-1',
          name: 'cube',
          faces: [
            { face: 'north', uv: [0, 0, 8, 16] },
            { face: 'south', uv: [8, 0, 16, 8] }
          ]
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
  counts: { bones: 0, cubes: 1, textures: 1, animations: 0 },
  textureResolution: { width: 16, height: 16 },
  bones: [],
  cubes: [
    {
      id: 'cube-1',
      name: 'cube',
      bone: 'root',
      from: [0, 0, 0],
      to: [16, 16, 16]
    }
  ],
  textures: [{ id: 'tex-1', name: 'tex', width: 16, height: 16 }],
  animations: []
};

const calls = {
  preflight: 0,
  setFaceUv: 0,
  assignTexture: 0,
  setResolution: 0,
  updateTexture: 0,
  importTexture: 0
};

let currentTextureSize = { width: 16, height: 16 };

const service = {
  getProjectState: (_payload: unknown) => ok({ project }),
  listCapabilities: () =>
    ({
      limits: { maxTextureSize: 64 },
      formats: [{ format: 'geckolib', animations: false, enabled: true }]
    }) as unknown,
  getUvPolicy: () => DEFAULT_UV_POLICY,
  getProjectTextureResolution: () => ({ width: 16, height: 16 }),
  setProjectTextureResolution: (_payload: unknown) => {
    calls.setResolution += 1;
    const payload = _payload as { width?: number; height?: number };
    return ok({
      width: Number.isFinite(payload.width) ? (payload.width as number) : 64,
      height: Number.isFinite(payload.height) ? (payload.height as number) : 64
    });
  },
  preflightTexture: (payload: { includeUsage?: boolean }) => {
    calls.preflight += 1;
    return ok({
      uvUsageId,
      usageSummary: { textureCount: 1, cubeCount: 1, faceCount: 2, unresolvedCount: 0 },
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
    const payload = _payload as { width?: number; height?: number };
    if (Number.isFinite(payload.width) && Number.isFinite(payload.height)) {
      currentTextureSize = { width: payload.width as number, height: payload.height as number };
    }
    return ok({ id: 'tex-1', name: 'tex' });
  },
  updateTexture: (_payload: unknown) => {
    calls.updateTexture += 1;
    const payload = _payload as { width?: number; height?: number };
    if (Number.isFinite(payload.width) && Number.isFinite(payload.height)) {
      currentTextureSize = { width: payload.width as number, height: payload.height as number };
    }
    return ok({ id: 'tex-1', name: 'tex' });
  },
  readTexture: (_payload: unknown) =>
    ok({
      name: 'tex',
      width: currentTextureSize.width,
      height: currentTextureSize.height,
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,',
      image: { width: currentTextureSize.width, height: currentTextureSize.height } as unknown as CanvasImageSource
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
      background: '#00ff00'
    }
  ]
};

registerAsync(
  (async () => {
    const res = await texturePipelineProxy(deps, payload);
    if (!res.ok) {
      assert.fail(res.error.message);
    }
    assert.equal(res.data.applied, true);
    assert.ok(res.data.steps.plan);
    const recovery = res.data.steps.textures?.recovery;
    assert.equal(recovery?.method, 'plan');
    assert.equal(recovery?.reason, 'uv_scale_mismatch');
    assert.ok(calls.preflight > 0);
    assert.ok(calls.setFaceUv > 0);
    assert.ok(calls.assignTexture > 0);
    assert.ok(calls.updateTexture > 0 || calls.importTexture > 0);
    assert.equal(currentTextureSize.width, 32);
    assert.equal(currentTextureSize.height, 32);
  })()
);


