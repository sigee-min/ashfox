import assert from 'node:assert/strict';

import { MAX_TEXTURE_OPS } from '../../../../src/domain/textureOps';
import type {
  PaintTexturePayload,
  TextureUsageResult,
} from '@ashfox/blockbench-contracts/types/internal';
import { runPaintTexture } from '../../../../src/usecases/textureTools/texturePaint';
import {
  createHarness,
  createPayload,
  createUsage,
  fillOp,
  updatePayload,
  usageIdFor,
} from './fixture';

{
  const { ctx } = createHarness();
  const res = runPaintTexture(ctx, createPayload({ mode: 'bad' as unknown as 'create' }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}

for (const payload of [
  createPayload({ name: '   ' }),
  updatePayload({ targetName: '   ' }),
  createPayload({ name: undefined }),
  updatePayload({ targetName: undefined, targetId: undefined }),
  createPayload({ width: 0 }),
  createPayload({ width: 16.5 }),
]) {
  const { ctx } = createHarness();
  const res = runPaintTexture(ctx, payload);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}

{
  const { ctx } = createHarness();
  const res = runPaintTexture(ctx, createPayload({ width: 128, height: 128 }));
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
    assert.ok(typeof res.error.fix === 'string');
  }
}

{
  const { ctx } = createHarness();
  const res = runPaintTexture(
    ctx,
    createPayload({
      uvPaint: { scope: 'bad' as unknown as 'rects' },
    }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}

{
  const { ctx } = createHarness();
  const res = runPaintTexture(
    ctx,
    createPayload({
      ops: {} as unknown as PaintTexturePayload['ops'],
    }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}

{
  const { ctx } = createHarness();
  const ops = Array.from({ length: MAX_TEXTURE_OPS + 1 }, () => fillOp);
  const res = runPaintTexture(ctx, createPayload({ ops }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}

{
  const { ctx } = createHarness();
  const res = runPaintTexture(
    ctx,
    createPayload({
      ops: [{ op: 'oops' } as unknown as typeof fillOp],
    }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}

{
  const { ctx } = createHarness();
  const res = runPaintTexture(ctx, updatePayload({ targetName: 'missing' }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}

{
  const { ctx } = createHarness({
    snapshotTextures: [
      { id: 'tex1', name: 'atlas', width: 16, height: 16 },
      { id: 'tex2', name: 'duplicate', width: 16, height: 16 },
    ],
  });
  const res = runPaintTexture(
    ctx,
    updatePayload({
      targetName: 'atlas',
      name: 'duplicate',
    }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}

{
  const { ctx } = createHarness();
  const res = runPaintTexture(ctx, createPayload({ name: 'atlas' }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}

{
  const { ctx } = createHarness();
  const res = runPaintTexture(
    ctx,
    updatePayload({
      uvPaint: { source: { width: 128, height: 16 } },
    }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
    assert.ok(typeof res.error.fix === 'string');
  }
}

{
  const { ctx } = createHarness();
  const res = runPaintTexture(ctx, updatePayload({ uvPaint: {} }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}

{
  const { ctx } = createHarness({
    usageError: { code: 'invalid_state', message: 'usage read failed' },
  });
  const res = runPaintTexture(
    ctx,
    updatePayload({
      uvPaint: {},
      uvUsageId: 'any',
    }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.error.message.startsWith('usage read failed'));
}

{
  const { ctx } = createHarness();
  const res = runPaintTexture(
    ctx,
    updatePayload({
      uvPaint: {},
      uvUsageId: 'wrong-id',
    }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_state');
    assert.equal(res.error.details?.reason, 'uv_usage_mismatch');
  }
}

{
  const usage: TextureUsageResult = {
    textures: [
      {
        id: 'tex2',
        name: 'other',
        width: 16,
        height: 16,
        cubeCount: 1,
        faceCount: 1,
        cubes: [
          {
            id: 'cube1',
            name: 'cube',
            faces: [{ face: 'north', uv: [0, 0, 16, 16] }],
          },
        ],
      },
    ],
  };
  const { ctx } = createHarness({
    usage,
    snapshotTextures: [{ id: 'tex1', name: 'atlas', width: 16, height: 16 }],
  });
  const res = runPaintTexture(
    ctx,
    updatePayload({
      uvPaint: {},
      uvUsageId: usageIdFor(usage),
    }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_state');
    assert.equal(res.error.details?.reason, 'usage_missing');
  }
}

for (const payload of [
  createPayload({ background: '#xyz' }),
  createPayload({
    ops: [
      {
        op: 'fill_rect',
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        color: '#xyz',
      },
    ],
  }),
]) {
  const { ctx } = createHarness();
  const res = runPaintTexture(ctx, payload);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}

{
  const { ctx } = createHarness();
  const res = runPaintTexture(
    ctx,
    createPayload({
      ops: [
        {
          op: 'draw_line',
          x1: 0,
          y1: 0,
          x2: 3,
          y2: 3,
          lineWidth: Number.NaN,
          color: '#ffffff',
        },
      ],
    }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_payload');
    assert.equal(res.error.details?.opIndex, 0);
  }
}

{
  const usage = createUsage('atlas', [0, 0, 80, 80]);
  const { ctx } = createHarness({ usage });
  const res = runPaintTexture(
    ctx,
    updatePayload({
      uvPaint: {},
      uvUsageId: usageIdFor(usage),
    }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'invalid_payload');
}
