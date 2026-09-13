import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
const runner = path.join(__dirname, 'performance.ts');
for (const workload of ['modal', 'output', 'fm']) {
  const result = spawnSync(process.execPath, ['-e',
    "require('ts-node').register({transpileOnly:true,compilerOptions:{module:'CommonJS'}});require(process.argv[1]);", runner, workload],
  { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  process.stdout.write(result.stdout);
}
