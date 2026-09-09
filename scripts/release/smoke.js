'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { unzipSync } = require('fflate');
const { verify } = require('./artifacts');
const root = path.resolve(__dirname, '../..');
const directory = path.resolve(process.argv[2] || path.join(root, 'dist/release'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-release-smoke-'));
const run = (exe, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(exe, args, { cwd, shell: process.platform === 'win32' && exe === 'npm',
    env: { ...process.env, npm_config_cache: path.join(temp, 'cache') }, timeout: 120000 });
  const stdout = [], stderr = [];
  child.stdout.on('data', bytes => stdout.push(bytes));
  child.stderr.on('data', bytes => stderr.push(bytes));
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(Buffer.concat(stdout)) :
    reject(new Error(`${exe} failed (${code}): ${Buffer.concat(stderr)}`)));
});
const main = async () => {
  verify(directory);
  const server = http.createServer((request, response) => {
    if (request.url !== '/ashfox-cli.tgz') { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', 'application/octet-stream');
    response.end(fs.readFileSync(path.join(directory, 'ashfox-cli.tgz')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const mode of ['url', 'offline']) {
      const folder = path.join(temp, mode);
      fs.mkdirSync(folder);
      for (const [name, bytes] of Object.entries(unzipSync(fs.readFileSync(path.join(directory, 'starter.zip'))))) {
        assert.ok(!name.split('/').includes('..') && !path.isAbsolute(name));
        const file = path.join(folder, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
      }
      fs.copyFileSync(path.join(directory, 'ashfox-cli.tgz'), path.join(folder, 'ashfox-cli.tgz'));
      const target = mode === 'url' ? `http://127.0.0.1:${server.address().port}/ashfox-cli.tgz` : './ashfox-cli.tgz';
      await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev',
        ...(mode === 'offline' ? ['--offline'] : []), target], folder);
      const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'node_modules/@ashfox/cli/package.json')));
      assert.equal(metadata.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
      assert.equal(metadata.scripts, undefined);
      assert.equal(metadata.dependencies, undefined);
      assert.ok(fs.existsSync(path.join(folder, 'node_modules/@ashfox/cli/LICENSE')));
      const execute = (...args) => run(process.execPath, [path.join(folder, 'node_modules/@ashfox/cli/dist/ashfox.cjs'), ...args], folder);
      assert.equal(JSON.parse(await execute('capabilities')).ok, true);
      for (const [source, magic] of [['fox.ashfox', 'glTF'], ['sword.ashfox', '\x89PNG'], ['claw_hit.ashfox', 'RIFF']]) {
        assert.equal((await execute('export', source)).subarray(0, 4).toString('latin1'), magic);
      }
      fs.rmSync(path.join(folder, 'node_modules'), { recursive: true });
      await run('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], folder);
      assert.equal(JSON.parse(await execute('capabilities')).ok, true);
    }
    console.log('Release URL/offline installation, version, exports and lockfile restoration pass');
  } finally { server.close(); }
};
main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
