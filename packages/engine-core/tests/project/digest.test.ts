import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256ByteDigest, sha256Digest } from '../../src/provenance/digest';

const expected = (bytes: Uint8Array): string =>
  'sha256:' + createHash('sha256').update(bytes).digest('hex');

// Cover both padding branches, exact blocks, multiple blocks, and offset views.
for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1024, 1048576]) {
  const storage = Uint8Array.from({ length: length + 19 }, (_, index) => (index * 31 + 7) & 255);
  const bytes = storage.subarray(7, length + 7);
  const original = storage.slice();
  assert.equal(sha256ByteDigest(bytes), expected(bytes), `length ${length}`);
  assert.deepEqual(storage, original, 'Hashing must not change the input or surrounding bytes');
  if (length <= 129) {
    assert.equal(sha256ByteDigest(Array.from(bytes)), expected(bytes));
    assert.equal(sha256ByteDigest(Object.assign({ length }, Array.from(bytes))), expected(bytes));
  }
}
for (const value of ['', 'abc', '새소리 🐦', '\ud800', 'a'.repeat(1000000)]) {
  assert.equal(sha256Digest(value), 'sha256:' + createHash('sha256').update(value).digest('hex'));
}
const converted = [256, -1, 1.5, NaN, Infinity];
assert.equal(sha256ByteDigest(converted), expected(Uint8Array.from(converted)));
console.log('SHA-256: independent reference, padding boundaries, offset views and input preservation pass');
