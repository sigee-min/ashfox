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

const testsDir = path.join(__dirname, 'tests');
const tests = discoverTests(testsDir);

globalThis.__ashfoxEngineTestPromises = [];

const main = async () => {
  requireTests(selectTests(tests, { label: 'engine-core tests' }));
  await Promise.all(globalThis.__ashfoxEngineTestPromises);
  console.log('engine-core tests ok');
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
