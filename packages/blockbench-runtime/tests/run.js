process.env.DISABLE_V8_COMPILE_CACHE = process.env.DISABLE_V8_COMPILE_CACHE || '1';

const path = require('path');
const { register } = require('ts-node');
const { discoverTests, requireTests, selectTests } = require('../../../scripts/tests/discovery');

register({
  transpileOnly: true,
  compilerOptions: {
    module: 'CommonJS',
  },
});

const originalNativeModuleLoader = globalThis.requireNativeModule;
globalThis.requireNativeModule = (name) => require(name);

globalThis.__ashfox_test_promises = [];

const tests = discoverTests(__dirname);
const testFilter = process.env.ASHFOX_TEST_FILTER;
const selectedTests = selectTests(tests, {
  filter: testFilter,
  label: 'runtime tests',
});

(async () => {
  requireTests(selectedTests);
  const pending = Array.isArray(globalThis.__ashfox_test_promises)
    ? globalThis.__ashfox_test_promises
    : [];
  if (pending.length > 0) {
    await Promise.all(pending);
  }
  console.log('tests ok');
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (originalNativeModuleLoader === undefined) {
      delete globalThis.requireNativeModule;
    } else {
      globalThis.requireNativeModule = originalNativeModuleLoader;
    }
  });
