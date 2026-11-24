import assert from 'node:assert/strict';

import { createLineDecoder, encodeMessage } from '../../../../src/transport/codec';

{
  const messages: unknown[] = [];
  let errors = 0;
  const decoder = createLineDecoder(
    (message) => {
      messages.push(message);
    },
    () => {
      errors += 1;
    },
    200,
  );

  decoder.push('x'.repeat(250));
  assert.equal(errors, 1);

  decoder.push('\n');
  decoder.push('{"type":"ready","version":1,"ts":2}\n');
  assert.equal(messages.length, 1);
}

{
  const first = encodeMessage({ type: 'ready', version: 1, ts: 11 });
  const second = encodeMessage({ type: 'ready', version: 1, ts: 12 });
  const messages: unknown[] = [];
  const errors: Error[] = [];
  const frameLimit = Math.max(Buffer.byteLength(first, 'utf8'), Buffer.byteLength(second, 'utf8'));
  assert.ok(Buffer.byteLength(first + second, 'utf8') > frameLimit);
  const decoder = createLineDecoder(
    (message) => messages.push(message),
    (error) => errors.push(error),
    frameLimit,
  );
  decoder.push(first + second);
  assert.deepEqual(errors, []);
  assert.equal(messages.length, 2);
}

{
  const encoded = encodeMessage({
    type: 'error',
    ts: 13,
    message: '🐾'.repeat(12),
  });
  const codeUnitLimit = encoded.length;
  assert.ok(Buffer.byteLength(encoded, 'utf8') > codeUnitLimit);
  const messages: unknown[] = [];
  const errors: Error[] = [];
  const decoder = createLineDecoder(
    (message) => messages.push(message),
    (error) => errors.push(error),
    codeUnitLimit,
  );
  decoder.push(encoded);
  assert.equal(messages.length, 0);
  assert.equal(errors.length, 1);
}
