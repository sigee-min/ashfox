import assert from 'node:assert/strict';

import { isSidecarMessage } from '../../../../src/transport/protocol';

{
  assert.equal(
    isSidecarMessage({
      type: 'response',
      id: 'r1',
      ok: false,
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'response',
      id: 'r1',
      ok: false,
      error: { code: 'invalid_state', message: 'x', details: 'bad' },
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'response',
      id: 'r1',
      ok: false,
      error: { code: 'invalid_state', message: 'x', details: { reason: 'y' } },
      ts: 1,
    }),
    true,
  );
  assert.equal(
    isSidecarMessage({
      type: 'response',
      id: 'r1',
      ok: false,
      error: { code: 'invented', message: 'not declared' },
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'response',
      id: 'r1',
      ok: true,
      data: { value: Number.NaN },
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'response',
      id: 'r1',
      ok: true,
      data: new Date('2026-01-01T00:00:00.000Z'),
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'response',
      id: 'r1',
      ok: true,
      data: { ok: true },
      error: { code: 'unknown', message: 'mixed branch' },
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'response',
      id: 'r1',
      ok: true,
      data: { ok: true },
      ts: 1,
    }),
    true,
  );
  assert.equal(isSidecarMessage({ type: 'noop', ts: 1 }), false);
  assert.equal(
    isSidecarMessage({
      type: 'error',
      message: 'boom',
      id: 1,
      ts: 1,
    }),
    false,
  );
  assert.equal(
    isSidecarMessage({
      type: 'error',
      message: 'boom',
      details: { reason: 'x' },
      ts: 1,
    }),
    true,
  );
}
