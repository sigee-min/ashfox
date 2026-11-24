process.env.DISABLE_V8_COMPILE_CACHE = process.env.DISABLE_V8_COMPILE_CACHE || '1';

const path = require('path');
const { register } = require('ts-node');
const { discoverTests, requireTests, selectTests } = require('../../scripts/tests/discovery');

register({
  transpileOnly: true,
  compilerOptions: {
    module: 'CommonJS',
  },
});

globalThis.__ashfox_test_promises = [];

const testsDir = path.join(__dirname, 'tests');

const tests = discoverTests(testsDir);
const testFilter = process.env.ASHFOX_TEST_FILTER;
const selectedTests = selectTests(tests, {
  filter: testFilter,
  label: 'conformance tests',
});

(async () => {
  requireTests(selectedTests);
  const pending = Array.isArray(globalThis.__ashfox_test_promises)
    ? globalThis.__ashfox_test_promises
    : [];
  if (pending.length > 0) {
    await Promise.all(pending);
  }
  console.log('conformance tests ok');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
