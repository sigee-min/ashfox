import assert from 'node:assert/strict';

import { isSidecarMessage, normalizeSidecarMessage } from '../../../../src/transport/protocol';

{
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(
    isSidecarMessage({
      type: 'response',
      id: 'r1',
      ok: true,
      data: circular,
      ts: 1,
    }),
    false,
  );
}

{
  let deeplyNested: Record<string, unknown> = {};
  for (let depth = 0; depth < 100; depth += 1) {
    deeplyNested = { child: deeplyNested };
  }
  assert.doesNotThrow(() =>
    isSidecarMessage({
      type: 'response',
      id: 'r1',
      ok: true,
      data: deeplyNested,
      ts: 1,
    }),
  );
  assert.equal(
    isSidecarMessage({
      type: 'response',
      id: 'r1',
      ok: true,
      data: deeplyNested,
      ts: 1,
    }),
    false,
  );
}

{
  const nested = (depth: number): Record<string, unknown> => {
    let value: Record<string, unknown> = {};
    for (let index = 0; index < depth; index += 1) {
      value = { child: value };
    }
    return value;
  };
  for (let depth = 62; depth <= 66; depth += 1) {
    const message = {
      type: 'response',
      id: `depth-${depth}`,
      ok: true,
      data: nested(depth),
      ts: 1,
    };
    assert.equal(
      normalizeSidecarMessage(message) !== null,
      isSidecarMessage(message),
      `normalization and validation depth ${depth}`,
    );
  }
}

{
  const sparse = new Array(1);
  const compensated = new Array(1) as unknown[] & { extra?: string };
  compensated.extra = 'must not mask the missing index';
  for (const extension of [
    { content: sparse },
    { nextActions: sparse },
    { content: compensated },
  ]) {
    assert.equal(
      isSidecarMessage({
        type: 'response',
        id: 'r1',
        ok: true,
        data: {},
        ts: 1,
        ...extension,
      }),
      false,
    );
  }

  const customPrototype = [Number.NaN];
  Object.setPrototypeOf(customPrototype, { every: () => true });
  const nullPrototype = [1];
  Object.setPrototypeOf(nullPrototype, null);
  for (const data of [customPrototype, nullPrototype]) {
    assert.doesNotThrow(() =>
      isSidecarMessage({
        type: 'response',
        id: 'r1',
        ok: true,
        data,
        ts: 1,
      }),
    );
    assert.equal(
      isSidecarMessage({
        type: 'response',
        id: 'r1',
        ok: true,
        data,
        ts: 1,
      }),
      false,
    );
  }
}

{
  const content = { type: 'text' as const, text: 'shared' };
  const argument = { material: 'stone' };
  const nextAction = {
    type: 'call_tool' as const,
    tool: 'paint_faces',
    arguments: { first: argument, second: argument },
    reason: 'Reuse one observed selection.',
  };
  const message = {
    type: 'response' as const,
    id: 'shared-aliases',
    ok: true as const,
    data: {},
    content: [content, content],
    nextActions: [nextAction, nextAction],
    ts: 1,
  };
  assert.equal(isSidecarMessage(message), true);
  assert.notEqual(normalizeSidecarMessage(message), null);
}

{
  let shared: Record<string, unknown> = { leaf: true };
  for (let depth = 0; depth < 17; depth += 1) {
    shared = { left: shared, right: shared };
  }
  const message = {
    type: 'response',
    id: 'shared-dag-budget',
    ok: true,
    data: shared,
    ts: 1,
  };
  assert.equal(isSidecarMessage(message), false);
  assert.equal(normalizeSidecarMessage(message), null);
}

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
  assert.equal(
    isSidecarMessage({
      type: 'response',
      id: 'aggregate-next-actions-budget',
      ok: true,
      data: {},
      nextActions: [action, action, action, action],
      ts: 1,
    }),
    false,
  );
}
