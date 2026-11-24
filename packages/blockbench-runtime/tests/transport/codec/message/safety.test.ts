import assert from 'node:assert/strict';

import { isSidecarMessage } from '../../../../src/transport/protocol';

{
  const hiddenToJson = { name: 'safe' };
  Object.defineProperty(hiddenToJson, 'toJSON', {
    enumerable: false,
    value: () => ({ name: 'changed', extra: true }),
  });
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'hidden-object',
      tool: 'add_bone',
      payload: hiddenToJson,
      ts: 1,
    }),
    false,
  );

  const pivot = [0, 0, 0];
  Object.defineProperty(pivot, 'toJSON', {
    enumerable: false,
    value: () => [0, 0, Number.POSITIVE_INFINITY],
  });
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'hidden-array',
      tool: 'add_bone',
      payload: { name: 'safe', pivot },
      ts: 1,
    }),
    false,
  );

  const symbolPayload: Record<string | symbol, unknown> = { name: 'safe' };
  symbolPayload[Symbol('hidden')] = true;
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'hidden-symbol',
      tool: 'add_bone',
      payload: symbolPayload,
      ts: 1,
    }),
    false,
  );

  let getterReads = 0;
  const accessorPayload: Record<string, unknown> = {};
  Object.defineProperty(accessorPayload, 'name', {
    enumerable: true,
    get: () => {
      getterReads += 1;
      return 'unsafe';
    },
  });
  assert.equal(
    isSidecarMessage({
      type: 'request',
      id: 'accessor',
      tool: 'add_bone',
      payload: accessorPayload,
      ts: 1,
    }),
    false,
  );
  assert.equal(getterReads, 0);
}
