import assert from 'node:assert/strict';

import { normalizeTraceContractValue, sanitizeTraceValue } from '../../src/trace/format';

{
  const input = {
    keep: 'ok',
    image: 'data:image/png;base64,abc',
    nested: { ctx: { secret: 'x' }, value: 1 },
  };
  const sanitized = sanitizeTraceValue(input) as Record<string, unknown>;
  assert.equal(sanitized.keep, 'ok');
  assert.equal(sanitized.image, '<redacted>');
  assert.deepEqual(sanitized.nested, { ctx: '<redacted>', value: 1 });
}

{
  const circular: { self?: unknown } = {};
  circular.self = circular;
  const sanitized = sanitizeTraceValue(circular) as Record<string, unknown>;
  assert.equal(sanitized.self, '[circular]');
}

{
  const large: Record<string, number> = {};
  for (let i = 0; i < 105; i += 1) {
    large[`k${i}`] = i;
  }
  const sanitized = sanitizeTraceValue(large) as Record<string, unknown>;
  assert.equal(Object.keys(sanitized).length, 101);
  assert.equal(sanitized.__ashfoxTruncatedKeys__, '[truncated:5]');
  assert.equal(sanitized.k0, 0);
  assert.equal(sanitized.k99, 99);
  assert.equal('k100' in sanitized, false);
}

{
  const sparse = new Array(2);
  sparse[1] = undefined;
  const sanitized = sanitizeTraceValue({
    omitted: undefined,
    nested: { omitted: undefined, kept: true },
    sparse,
    nonFinite: Number.NaN,
  });
  assert.deepEqual(sanitized, {
    nested: { kept: true },
    sparse: [null, null],
    nonFinite: null,
  });
}

{
  const input = JSON.parse('{"__proto__":{"safe":true},"nested":{"__proto__":"kept"}}') as Record<
    string,
    unknown
  >;
  for (const sanitized of [sanitizeTraceValue(input), normalizeTraceContractValue(input)]) {
    assert.ok(sanitized && typeof sanitized === 'object');
    const record = sanitized as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(record), Object.prototype);
    assert.equal(Object.prototype.hasOwnProperty.call(record, '__proto__'), true);
    assert.deepEqual(record.__proto__, { safe: true });
    const nested = record.nested as Record<string, unknown>;
    assert.equal(Object.prototype.hasOwnProperty.call(nested, '__proto__'), true);
    assert.equal(nested.__proto__, 'kept');
  }
}
