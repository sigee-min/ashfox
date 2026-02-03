import assert from 'node:assert/strict';

import type { ApplyUvSpecPayload } from '../../src/spec';
import type { TextureUsageResult } from '../../src/ports/editor';
import { applyUvSpecProxy } from '../../src/proxy/texturePipeline/applyUvSpecProxy';
import { computeTextureUsageId } from '../../src/domain/textureUsage';
import { DEFAULT_UV_POLICY } from '../../src/domain/uv/policy';
import { toDomainTextureUsage } from '../../src/usecases/domainMappers';
import { DEFAULT_LIMITS, makeProxyDeps, ok, registerAsync } from './helpers';

const usageInitial: TextureUsageResult = {
  textures: [
    {
      id: 'tex-1',
      name: 'tex',
      cubeCount: 1,
      faceCount: 1,
      cubes: [
        { id: 'cube-1', name: 'cube', faces: [{ face: 'north', uv: [0, 0, 16, 16] }] }
      ]
    }
  ]
};
const usageAfter: TextureUsageResult = {
  textures: [
    {
      id: 'tex-1',
      name: 'tex',
      cubeCount: 1,
      faceCount: 1,
      cubes: [
        { id: 'cube-1', name: 'cube', faces: [{ face: 'north', uv: [0, 0, 8, 8] }] }
      ]
    }
  ]
};
const uvUsageId = computeTextureUsageId(toDomainTextureUsage(usageInitial));
const expectedUvUsageId = computeTextureUsageId(toDomainTextureUsage(usageAfter));

const project = {
  id: 'p',
  active: true,
  name: null,
  format: 'geckolib',
  revision: 'r1',
  counts: { bones: 0, cubes: 1, textures: 1, animations: 0 },
  cubes: [
    {
      id: 'cube-1',
      name: 'cube',
      from: [0, 0, 0],
      to: [1, 1, 1],
      bone: 'root'
    }
  ],
  textures: [],
  animations: []
};

const calls: { setFaceUv: unknown[] } = { setFaceUv: [] };
let usageCalls = 0;

const deps = makeProxyDeps({
  service: {
    getTextureUsage: (_payload: unknown) => {
      usageCalls += 1;
      return ok(usageCalls > 1 ? usageAfter : usageInitial);
    },
    getProjectState: (_payload: unknown) => ok({ project }),
    getUvPolicy: () => DEFAULT_UV_POLICY,
    setFaceUv: (payload: { cubeId?: string; cubeName?: string; faces: Record<string, [number, number, number, number]> }) => {
      calls.setFaceUv.push(payload);
      const faces = Object.keys(payload.faces ?? {});
      return ok({ cubeId: payload.cubeId, cubeName: payload.cubeName ?? 'cube', faces });
    }
  },
  limits: DEFAULT_LIMITS
});

const payload: ApplyUvSpecPayload = {
  uvUsageId,
  assignments: [{ cubeId: 'cube-1', faces: { north: [0, 0, 8, 8] } }]
};

registerAsync(
  (async () => {
    const res = await applyUvSpecProxy(deps, payload);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.data.applied, true);
      assert.equal(res.data.cubes, 1);
      assert.equal(res.data.faces, 1);
      assert.equal(res.data.uvUsageId, expectedUvUsageId);
      assert.ok(Array.isArray(res.nextActions));
    }
    assert.equal(calls.setFaceUv.length, 1);
    const call = calls.setFaceUv[0] as { cubeId?: string; faces: { north?: [number, number, number, number] } };
    assert.equal(call.cubeId, 'cube-1');
    assert.deepEqual(call.faces.north, [0, 0, 8, 8]);
  })()
);


