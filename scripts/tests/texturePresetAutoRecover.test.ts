import assert from 'node:assert/strict';

import type { TextureUsageResult } from '../../src/ports/editor';
import type { GenerateTexturePresetPayload } from '../../src/types';
import { DEFAULT_UV_POLICY } from '../../src/domain/uvPolicy';
import { runGenerateTexturePreset } from '../../src/usecases/textureTools';
import { ok, registerAsync } from './helpers';

const snapshot = {
  bones: [{ id: 'root', name: 'root', parent: null, pivot: [0, 0, 0] }],
  cubes: [
    {
      id: 'cube-1',
      name: 'cube',
      bone: 'root',
      from: [0, 0, 0],
      to: [1, 1, 1]
    }
  ],
  textures: [{ id: 'tex-1', name: 'tex', width: 16, height: 16 }],
  animations: [],
  animationsStatus: 'idle'
};

let usageResult: TextureUsageResult = {
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

const calls = { setFaceUv: 0 };

const editor = {
  getTextureUsage: (_payload: unknown) => ({ result: usageResult }),
  getProjectTextureResolution: () => ({ width: 16, height: 16 }),
  setProjectTextureResolution: (_w: number, _h: number, _modify?: boolean) => null,
  setFaceUv: (payload: { cubeId?: string; cubeName: string; faces: Record<string, [number, number, number, number]> }) => {
    calls.setFaceUv += 1;
    const faceUv = payload.faces.north ?? [0, 0, 1, 1];
    usageResult = {
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
              faces: [{ face: 'north', uv: faceUv }]
            }
          ]
        }
      ]
    };
    return null;
  }
};

const ctx = {
  ensureActive: () => null,
  ensureRevisionMatch: () => null,
  getSnapshot: () => snapshot,
  editor,
  textureRenderer: {
    renderPixels: (input: { width: number; height: number; data: Uint8ClampedArray }) => ({
      result: { image: {}, width: input.width, height: input.height }
    })
  },
  capabilities: { limits: { maxTextureSize: 64 }, formats: [] },
  getUvPolicyConfig: () => DEFAULT_UV_POLICY,
  importTexture: (payload: { name: string }) => ok({ id: 'tex-1', name: payload.name }),
  updateTexture: (payload: { name?: string; newName?: string }) =>
    ok({ id: 'tex-1', name: payload.newName ?? payload.name ?? 'tex' })
};

const payload: GenerateTexturePresetPayload = {
  preset: 'wood',
  width: 16,
  height: 16,
  uvUsageId: 'stale',
  targetName: 'tex',
  mode: 'update',
  autoRecover: true
};

registerAsync(
  (async () => {
    const res = runGenerateTexturePreset(ctx as unknown as Parameters<typeof runGenerateTexturePreset>[0], payload);
    assert.equal(res.ok, true);
    assert.ok(calls.setFaceUv > 0);
  })()
);
