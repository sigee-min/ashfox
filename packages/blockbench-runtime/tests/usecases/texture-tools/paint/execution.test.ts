import assert from 'node:assert/strict';

import { runPaintTexture } from '../../../../src/usecases/textureTools/texturePaint';
import { createHarness, createPayload, createUsage, fillOp, usageIdFor } from './fixture';

{
  const { ctx } = createHarness({ noRenderer: true });
  const res = runPaintTexture(ctx, createPayload());
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'not_implemented');
}

{
  const { ctx } = createHarness({
    renderError: { code: 'io_error', message: 'render failed' },
  });
  const res = runPaintTexture(ctx, createPayload());
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.error.message.startsWith('render failed'));
}

{
  const { ctx } = createHarness({ renderWithoutResult: true });
  const res = runPaintTexture(ctx, createPayload());
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'not_implemented');
}

{
  const { ctx } = createHarness({
    updateError: { code: 'io_error', message: 'update failed' },
  });
  const res = runPaintTexture(ctx, {
    mode: 'update',
    targetName: 'atlas',
    width: 16,
    height: 16,
    ops: [fillOp],
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.error.message.startsWith('update failed'));
}

{
  const { ctx } = createHarness({
    importError: { code: 'io_error', message: 'import failed' },
  });
  const res = runPaintTexture(ctx, createPayload());
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.error.message.startsWith('import failed'));
}

{
  const { ctx, calls } = createHarness();
  const res = runPaintTexture(ctx, createPayload());
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.width, 16);
    assert.equal(res.value.height, 16);
    assert.equal(res.value.opsApplied, 1);
  }
  assert.equal(calls.importCount, 1);
}

{
  const usage = createUsage();
  const { ctx, calls } = createHarness({ usage });
  const res = runPaintTexture(ctx, {
    targetName: 'atlas',
    width: 16,
    height: 16,
    ops: [fillOp],
    uvPaint: { mapping: 'stretch' },
    uvUsageId: usageIdFor(usage),
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.uvUsageId, usageIdFor(usage));
    assert.equal(res.value.opsApplied, 1);
  }
  assert.equal(calls.updateCount, 1);
}
