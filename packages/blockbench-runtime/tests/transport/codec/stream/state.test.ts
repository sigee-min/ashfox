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
  );

  decoder.push(new Uint8Array(Buffer.from('{"type":"ready","version":1,"ts":3}\n', 'utf8')));
  decoder.push(' \n');
  decoder.push('{"type":"ready","version":1}\n');
  assert.equal(messages.length, 1);
  assert.equal(errors, 1);
}

{
  const messages: unknown[] = [];
  const errors: Error[] = [];
  const decoder = createLineDecoder(
    (message) => messages.push(message),
    (error) => errors.push(error),
    80,
  );
  decoder.push(new Uint8Array(Buffer.from('x'.repeat(60), 'utf8')));
  decoder.push(new Uint8Array([0xff]));
  assert.equal(errors.length, 1);
  decoder.push(encodeMessage({ type: 'ready', version: 1, ts: 14 }));
  assert.equal(errors.length, 1);
  assert.equal(messages.length, 1);
}

{
  const expected = {
    type: 'request' as const,
    id: 'unicode-request',
    tool: 'add_bone' as const,
    payload: { name: '가🐾' },
    ts: 5,
  };
  const bytes = Buffer.from(encodeMessage(expected), 'utf8');
  for (let split = 1; split < bytes.length; split += 1) {
    const messages: unknown[] = [];
    const errors: Error[] = [];
    const decoder = createLineDecoder(
      (message) => messages.push(message),
      (error) => errors.push(error),
    );
    decoder.push(new Uint8Array(bytes.subarray(0, split)));
    decoder.push(new Uint8Array(bytes.subarray(split)));
    assert.deepEqual(errors, [], `UTF-8 split ${split}`);
    assert.deepEqual(messages, [expected], `UTF-8 split ${split}`);
  }
}

{
  const errors: Error[] = [];
  const decoder = createLineDecoder(
    () => undefined,
    (error) => errors.push(error),
  );
  decoder.push(new Uint8Array([0xe1]));
  decoder.end();
  assert.equal(errors.length, 1);
}

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
  );

  decoder.push('{"type":"ready","version":1,');
  decoder.end();
  decoder.push('"ts":4}\n');
  assert.equal(messages.length, 0);
  assert.equal(errors, 1);
}
