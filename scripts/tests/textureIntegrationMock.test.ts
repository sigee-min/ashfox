import assert from 'node:assert/strict';

import type { TexturePipelinePayload, ApplyTextureSpecPayload } from '../../src/spec';
import type { TextureUsageResult } from '../../src/ports/editor';
import { texturePipelineProxy } from '../../src/proxy/texturePipeline/texturePipelineProxy';
import { applyTextureSpecProxy } from '../../src/proxy/texturePipeline/applyTextureSpecProxy';
import { ensureUvUsageForTargets } from '../../src/proxy/uvGuardian';
import { computeTextureUsageId } from '../../src/domain/textureUsage';
import { DEFAULT_UV_POLICY } from '../../src/domain/uv/policy';
import { toDomainTextureUsage } from '../../src/usecases/domainMappers';
import { createMockDom, DEFAULT_LIMITS, makeProxyDeps, ok, registerAsync } from './helpers';

// Trace 1: texture_pipeline automatic recovery + plan + resolution change.
{
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

  const calls = { autoPlan: 0, updateTexture: 0 };
  let currentTextureSize = { width: 16, height: 16 };

  const deps = makeProxyDeps({
    service: {
      getProjectState: (_payload: unknown) => ok({ project }),
      listCapabilities: () =>
        ({
          limits: { maxTextureSize: 64 },
          formats: [{ format: 'geckolib', animations: false, enabled: true }]
        }) as unknown,
      getUvPolicy: () => DEFAULT_UV_POLICY,
      getProjectTextureResolution: () => ({ width: 16, height: 16 }),
      setProjectTextureResolution: (_payload: unknown) => {
        calls.autoPlan += 1;
        const payload = _payload as { width?: number; height?: number };
        const width = Number.isFinite(payload.width) ? (payload.width as number) : 64;
        const height = Number.isFinite(payload.height) ? (payload.height as number) : 64;
        project.textureResolution = { width, height };
        return ok({ width, height });
      },
      preflightTexture: (payload: { includeUsage?: boolean }) =>
        ok({
          uvUsageId,
          usageSummary: { textureCount: 1, cubeCount: 1, faceCount: 2, unresolvedCount: 0 },
          ...(payload.includeUsage ? { textureUsage: usageResult } : {})
        }),
      assignTexture: (_payload: unknown) => ok({ textureName: 'tex', cubeCount: 1 }),
      setFaceUv: (_payload: unknown) => ok({ cubeName: 'cube', faces: ['north', 'south'] }),
      updateTexture: (payload: { width?: number; height?: number }) => {
        calls.updateTexture += 1;
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
    },
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
      assert.equal(res.ok, true);
      if (res.ok) {
        const recovery = res.data.steps.textures?.recovery;
        assert.equal(recovery?.method, 'plan');
        assert.equal(recovery?.reason, 'uv_scale_mismatch');
      }
      assert.equal(calls.autoPlan > 0, true);
      assert.equal(calls.updateTexture > 0, true);
      assert.equal(currentTextureSize.width, 32);
      assert.equal(currentTextureSize.height, 32);
    })()
  );
}

// Trace 2: apply_texture_spec -> auto_uv_atlas recovery flow.
{
  let usageState: TextureUsageResult = {
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
  const uvUsageId = computeTextureUsageId(toDomainTextureUsage(usageState), { width: 16, height: 16 });
  const calls = { autoUvAtlas: 0, updateTexture: 0 };
  let currentTextureSize = { width: 16, height: 16 };

  const deps = makeProxyDeps({
    service: {
      getProjectState: (_payload: unknown) =>
        ok({
          project: {
            id: 'p2',
            active: true,
            name: null,
            format: 'geckolib',
            revision: 'r1',
            counts: { bones: 0, cubes: 1, textures: 1, animations: 0 },
            textureResolution: { width: 16, height: 16 },
            cubes: [{ id: 'cube-1', name: 'cube', from: [0, 0, 0], to: [16, 16, 16], bone: 'root' }],
            textures: [{ id: 'tex-1', name: 'tex', width: 16, height: 16 }],
            bones: [],
            animations: []
          }
        }),
      getTextureUsage: (_payload: unknown) => ok(usageState),
      preflightTexture: (_payload: unknown) => {
        const nextId = computeTextureUsageId(toDomainTextureUsage(usageState), { width: 16, height: 16 });
        return ok({
          uvUsageId: nextId,
          usageSummary: { textureCount: 1, cubeCount: 1, faceCount: 1, unresolvedCount: 0 }
        });
      },
      autoUvAtlas: (_payload: unknown) => {
        calls.autoUvAtlas += 1;
        usageState = {
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
                  faces: [{ face: 'north', uv: [0, 0, 16, 16] }]
                }
              ]
            }
          ]
        };
        return ok({ applied: true, steps: 1, resolution: { width: 16, height: 16 }, textures: [] });
      },
      updateTexture: (payload: { width?: number; height?: number }) => {
        calls.updateTexture += 1;
        if (Number.isFinite(payload.width) && Number.isFinite(payload.height)) {
          currentTextureSize = { width: payload.width as number, height: payload.height as number };
        }
        return ok({ id: 'tex-1', name: 'tex' });
      },
      readTexture: (_payload: unknown) =>
        ok({
          name: 'tex',
          width: currentTextureSize.width,
          height: currentTextureSize.height
        })
    },
    dom: createMockDom(),
    limits: DEFAULT_LIMITS
  });

  const payload: ApplyTextureSpecPayload = {
    uvUsageId,
    textures: [
      {
        mode: 'update',
        targetName: 'tex',
        width: 16,
        height: 16,
        background: '#222222'
      }
    ]
  };

  registerAsync(
    (async () => {
      const res = await applyTextureSpecProxy(deps, payload);
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.data.recovery?.method, 'auto_uv_atlas');
      }
      assert.equal(calls.autoUvAtlas, 1);
      assert.equal(calls.updateTexture > 0, true);
    })()
  );
}

// Trace 3: project-resolution-only change triggers preflight refresh.
{
  const usageState: TextureUsageResult = {
    textures: [
      {
        id: 'tex-1',
        name: 'tex',
        cubeCount: 1,
        faceCount: 1,
        cubes: [{ id: 'cube-1', name: 'cube', faces: [{ face: 'north', uv: [0, 0, 8, 8] }] }]
      }
    ]
  };
  const staleId = computeTextureUsageId(toDomainTextureUsage(usageState), { width: 16, height: 16 });
  const currentId = computeTextureUsageId(toDomainTextureUsage(usageState), { width: 64, height: 64 });
  const calls = { preflight: 0 };

  const deps = makeProxyDeps({
    service: {
      getTextureUsage: (_payload: unknown) => ok(usageState),
      getProjectState: (_payload: unknown) =>
        ok({
          project: {
            id: 'p3',
            active: true,
            name: null,
            format: 'geckolib',
            revision: 'r1',
            counts: { bones: 0, cubes: 0, textures: 1, animations: 0 },
            textureResolution: { width: 64, height: 64 },
            cubes: [],
            textures: [],
            bones: [],
            animations: []
          }
        }),
      getUvPolicy: () => DEFAULT_UV_POLICY,
      preflightTexture: (_payload: unknown) => {
        calls.preflight += 1;
        return ok({
          uvUsageId: currentId,
          usageSummary: { textureCount: 1, cubeCount: 1, faceCount: 1, unresolvedCount: 0 }
        });
      }
    },
    limits: DEFAULT_LIMITS
  });

  const meta = { includeState: false, includeDiff: false, diffDetail: 'summary' } as const;
  registerAsync(
    (async () => {
      const res = await ensureUvUsageForTargets({
        deps,
        meta,
        targets: { ids: new Set<string>(), names: new Set(['tex']) },
        uvUsageId: staleId
      });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.data.uvUsageId, currentId);
        assert.equal(res.data.recovery?.method, 'preflight_refresh');
        assert.equal(res.data.recovery?.reason, 'uv_usage_mismatch');
      }
      assert.equal(calls.preflight, 1);
    })()
  );
}

// Trace 4: facePaint pipeline flow.
{
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
            faces: [{ face: 'north', uv: [0, 0, 16, 16] }]
          }
        ]
      }
    ]
  };
  const uvUsageId = computeTextureUsageId(toDomainTextureUsage(usageResult), { width: 16, height: 16 });
  const calls = { preset: 0, meta: 0 };

  const deps = makeProxyDeps({
    service: {
      getProjectState: (_payload: unknown) =>
        ok({
          project: {
            id: 'p4',
            active: true,
            name: null,
            format: 'geckolib',
            revision: 'r1',
            counts: { bones: 0, cubes: 1, textures: 1, animations: 0 },
            textureResolution: { width: 16, height: 16 },
            cubes: [{ id: 'cube-1', name: 'cube', from: [0, 0, 0], to: [16, 16, 16], bone: 'root' }],
            textures: [{ id: 'tex-1', name: 'tex', width: 16, height: 16 }],
            bones: [],
            animations: []
          }
        }),
      preflightTexture: (payload: { includeUsage?: boolean }) =>
        ok({
          uvUsageId,
          usageSummary: { textureCount: 1, cubeCount: 1, faceCount: 1, unresolvedCount: 0 },
          ...(payload.includeUsage ? { textureUsage: usageResult } : {})
        }),
      getUvPolicy: () => DEFAULT_UV_POLICY,
      generateTexturePreset: (_payload: unknown) => {
        calls.preset += 1;
        return ok({ id: 'tex-1', name: 'tex', width: 16, height: 16 });
      },
      setProjectMeta: (_payload: unknown) => {
        calls.meta += 1;
        return ok({ ok: true });
      }
    },
    dom: createMockDom(),
    limits: DEFAULT_LIMITS
  });

  const payload: TexturePipelinePayload = {
    facePaint: [
      {
        material: 'wood',
        cubeNames: ['cube'],
        faces: ['north']
      }
    ]
  };

  registerAsync(
    (async () => {
      const res = await texturePipelineProxy(deps, payload);
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.data.steps.facePaint?.applied, 1);
        assert.equal(res.data.steps.presets?.applied, 1);
      }
      assert.equal(calls.preset, 1);
      assert.equal(calls.meta, 1);
    })()
  );
}

// Trace 5: facePaint unknown material -> invalid_payload.
{
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
            faces: [{ face: 'north', uv: [0, 0, 16, 16] }]
          }
        ]
      }
    ]
  };
  const uvUsageId = computeTextureUsageId(toDomainTextureUsage(usageResult), { width: 16, height: 16 });

  const deps = makeProxyDeps({
    service: {
      getProjectState: (_payload: unknown) =>
        ok({
          project: {
            id: 'p5',
            active: true,
            name: null,
            format: 'geckolib',
            revision: 'r1',
            counts: { bones: 0, cubes: 1, textures: 1, animations: 0 },
            textureResolution: { width: 16, height: 16 },
            cubes: [{ id: 'cube-1', name: 'cube', from: [0, 0, 0], to: [16, 16, 16], bone: 'root' }],
            textures: [{ id: 'tex-1', name: 'tex', width: 16, height: 16 }],
            bones: [],
            animations: []
          }
        }),
      preflightTexture: (payload: { includeUsage?: boolean }) =>
        ok({
          uvUsageId,
          usageSummary: { textureCount: 1, cubeCount: 1, faceCount: 1, unresolvedCount: 0 },
          ...(payload.includeUsage ? { textureUsage: usageResult } : {})
        }),
      getUvPolicy: () => DEFAULT_UV_POLICY,
      generateTexturePreset: (_payload: unknown) => ok({ id: 'tex-1', name: 'tex', width: 16, height: 16 })
    },
    dom: createMockDom(),
    limits: DEFAULT_LIMITS
  });

  const payload: TexturePipelinePayload = {
    facePaint: [
      {
        material: 'mystery_material',
        cubeNames: ['cube'],
        faces: ['north']
      }
    ]
  };

  registerAsync(
    (async () => {
      const res = await texturePipelineProxy(deps, payload);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'invalid_payload');
      }
    })()
  );
}



