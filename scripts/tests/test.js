'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoverTests, requireTests, selectTests } = require('./discovery');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-tests-'));
try {
  const nested = path.join(root, 'owner', 'nested');
  fs.mkdirSync(nested, { recursive: true });
  const first = path.join(root, 'root.test.js');
  const second = path.join(nested, 'sentinel.test.js');
  fs.writeFileSync(first, 'globalThis.__ashfoxDiscoverySentinel.push("root");');
  fs.writeFileSync(second, 'globalThis.__ashfoxDiscoverySentinel.push("nested");');
  fs.writeFileSync(path.join(nested, 'ignored.ts'), 'ignored');
  const discovered = discoverTests(root, '.test.js');
  assert.deepEqual(
    discovered,
    [second, first],
    'test discovery recursively includes nested owner tests in stable order',
  );
  assert.throws(
    () => selectTests([], { label: 'contract tests' }),
    /No contract tests discovered/,
    'runner contract rejects an accidentally empty suite',
  );
  assert.deepEqual(
    selectTests(['C:\\repo\\tests\\schema\\policy.test.ts'], {
      filter: path.win32.join('schema', 'policy.test.ts'),
      label: 'Windows tests',
    }),
    ['C:\\repo\\tests\\schema\\policy.test.ts'],
    'platform-native practical filters match Windows test paths',
  );
  globalThis.__ashfoxDiscoverySentinel = [];
  requireTests(selectTests(discovered, { label: 'contract tests' }));
  assert.deepEqual(
    globalThis.__ashfoxDiscoverySentinel,
    ['nested', 'root'],
    'runner contract executes nested tests in discovered order',
  );
  delete globalThis.__ashfoxDiscoverySentinel;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('test discovery contract ok');
