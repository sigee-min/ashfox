const { spawnSync } = require('child_process');
const path = require('path');

const tests = [
  path.join('adapters', 'blockbench', 'animation', 'keyframes.test.ts'),
  path.join('dispatcher', 'viewport.test.ts'),
  path.join('usecases', 'texture-tools', 'faces', 'guard.test.ts'),
  path.join('usecases', 'texture-tools', 'faces', 'pass.test.ts'),
  path.join('plugin', 'runtime', 'services.test.ts'),
  path.join('transport', 'mcp', 'tools', 'schemas.test.ts'),
];

const run = (filter) => {
  console.log(`[practical] ${filter}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'run.js')], {
    stdio: 'inherit',
    env: { ...process.env, ASHFOX_TEST_FILTER: filter },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

for (const filter of tests) {
  run(filter);
}

console.log('practical tests ok');
