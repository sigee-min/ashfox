import assert from 'node:assert/strict';

import { isNextActionContract } from '@ashfox/blockbench-contracts/types/internal';
import { normalizeToolResponseShape } from '../../../src/shared/tooling/toolResponseGuard';

// ok path should pass through data.
{
  const res = normalizeToolResponseShape({ ok: true, data: { a: 1 } });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.data, { a: 1 });
  }
}

// NextAction arguments share the finite-JSON traversal budget and retain $ref semantics.
{
  const shared = { material: 'stone' };
  assert.equal(
    isNextActionContract({
      type: 'call_tool',
      tool: 'paint_faces',
      arguments: { first: shared, second: shared },
      reason: 'Reuse the same selection.',
    }),
    true,
  );

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(
    isNextActionContract({
      type: 'call_tool',
      tool: 'paint_faces',
      arguments: { cyclic },
      reason: 'Rejected cycle.',
    }),
    false,
  );

  let dag: Record<string, unknown> = { leaf: true };
  for (let depth = 0; depth < 16; depth += 1) {
    dag = { left: dag, right: dag };
  }
  assert.equal(
    isNextActionContract({
      type: 'call_tool',
      tool: 'paint_faces',
      arguments: { dag },
      reason: 'Rejected traversal bomb.',
    }),
    false,
  );

  assert.equal(
    isNextActionContract({
      type: 'call_tool',
      tool: 'paint_faces',
      arguments: {
        toolValue: {
          $ref: {
            kind: 'tool',
            tool: 'get_project_state',
            pointer: '/data/id',
            note: 'Use the observed project.',
          },
        },
        userValue: { $ref: { kind: 'user', hint: 'Choose a texture.' } },
      },
      reason: 'Resolve declared references.',
    }),
    true,
  );
  assert.equal(
    isNextActionContract({
      type: 'call_tool',
      tool: 'paint_faces',
      arguments: {
        invalid: {
          $ref: { kind: 'user', hint: 'Choose a texture.' },
          extra: true,
        },
      },
      reason: 'Reject ambiguous references.',
    }),
    false,
  );

  const throwingArguments = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw new Error('hostile reflection');
      },
    },
  );
  const hostileAction = {
    type: 'call_tool',
    tool: 'paint_faces',
    arguments: throwingArguments,
    reason: 'Reject hostile arguments.',
  };
  assert.doesNotThrow(() => isNextActionContract(hostileAction));
  assert.equal(isNextActionContract(hostileAction), false);
}

// malformed response should produce error.
{
  const res = normalizeToolResponseShape({ nope: true });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'unknown');
  }
}

// Tool errors use the same closed code/details contract as sidecar and trace.
{
  const res = normalizeToolResponseShape({
    ok: false,
    error: {
      code: 'invented',
      message: 'not declared',
      details: { value: Number.NaN },
    },
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'unknown');
    assert.equal(res.error.details?.reason, 'malformed_tool_response');
  }
}

// Required ToolError fields must be owned, even if Object.prototype is dirty.
{
  Object.defineProperty(Object.prototype, 'code', {
    value: 'unknown',
    configurable: true,
  });
  Object.defineProperty(Object.prototype, 'message', {
    value: 'inherited',
    configurable: true,
  });
  try {
    const res = normalizeToolResponseShape({ ok: false, error: {} });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.details?.reason, 'malformed_tool_error');
    }
  } finally {
    delete (Object.prototype as Record<string, unknown>).code;
    delete (Object.prototype as Record<string, unknown>).message;
  }
}

// Extension arrays retain only entries accepted by their shared contract.
{
  const res = normalizeToolResponseShape({
    ok: true,
    data: {},
    content: [
      { type: 'text', text: 'ok' },
      { type: 'text', text: 'bad', extra: true },
    ],
    nextActions: [
      { type: 'noop', reason: 'done' },
      { type: 'noop', reason: '', extra: true },
    ],
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.content, [{ type: 'text', text: 'ok' }]);
    assert.deepEqual(res.nextActions, [{ type: 'noop', reason: 'done' }]);
  }
}

// One aggregate finite-JSON budget covers the complete nextActions extension.
{
  let dag: Record<string, unknown> = { leaf: true };
  for (let depth = 0; depth < 14; depth += 1) {
    dag = { left: dag, right: dag };
  }
  const action = {
    type: 'call_tool',
    tool: 'paint_faces',
    arguments: { dag },
    reason: 'Reject aggregate traversal amplification.',
  };
  assert.equal(isNextActionContract(action), true);
  const response = normalizeToolResponseShape({
    ok: true,
    data: {},
    nextActions: [action, action, action, action],
  });
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.details?.reason, 'malformed_tool_response');
  }
}

// Flexible success values are snapshotted once or rejected as malformed.
{
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const cyclicResponse = normalizeToolResponseShape({
    ok: true,
    data: {},
    content: [{ type: 'text', text: 'ok' }],
    structuredContent: cyclic,
  });
  assert.equal(cyclicResponse.ok, false);
  assert.doesNotThrow(() => JSON.stringify(cyclicResponse));

  let descriptorReads = 0;
  const hostileError = new Proxy(
    { code: 'unknown', message: 'boom' },
    {
      getOwnPropertyDescriptor: (target, key) => {
        descriptorReads += 1;
        if (descriptorReads > 2) throw new Error('second reflection pass');
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  let hostileResponse: ReturnType<typeof normalizeToolResponseShape> | undefined;
  assert.doesNotThrow(() => {
    hostileResponse = normalizeToolResponseShape({
      ok: false,
      error: hostileError,
    });
  });
  assert.equal(hostileResponse?.ok, false);
  assert.equal(descriptorReads, 2);
  assert.doesNotThrow(() => JSON.stringify(hostileResponse));
}
