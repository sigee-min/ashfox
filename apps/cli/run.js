'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { discoverTests, selectTests } = require('../../scripts/tests/discovery');

const profile = process.argv[2] ?? 'default';
const profiles = {
  default: (file) => !['capture.test.ts', 'packaudio.test.ts'].includes(path.basename(file)),
  packs: (file) => ['packs.test.ts', 'packaudio.test.ts'].includes(path.basename(file)),
  capture: (file) => path.basename(file) === 'capture.test.ts',
};
if (!Object.hasOwn(profiles, profile) || process.argv.length > 3) {
  throw new Error('Usage: node run.js [default|packs|capture]');
}
const tests = selectTests(discoverTests(path.join(__dirname, 'tests')).filter(profiles[profile]), {
  label: `CLI ${profile} tests`,
});
require('./build');
for (const file of tests) {
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register', file], {
    cwd: __dirname,
    stdio: 'inherit',
    timeout: 600_000,
    env: {
      ...process.env,
      TS_NODE_PROJECT: path.resolve(__dirname, '../../tsconfig.tests.json'),
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({ module: 'CommonJS' }),
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
