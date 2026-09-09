'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-standalone-'));
const run = (command, input) => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'dist/ashfox.cjs'), command, input, '--json'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.signal, null, result.stderr);
  return JSON.parse(result.stdout);
};
try {
  for (const [folder, file, kind] of [
    ['examples/items/src', 'apple.ashfox', 'sprite'],
    ['examples/fox/creatures', 'fox.ashfox', 'model'],
    ['examples/sounds/src', 'claw_hit.ashfox', 'sound']
  ]) {
    const directory = path.join(temp, kind);
    fs.cpSync(path.join(root, folder), directory, { recursive: true });
    const input = path.join(directory, file);
    fs.writeFileSync(path.join(directory, 'unrelated.ashfox'), 'invalid unrelated file');
    const check = run('check', input);
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.deepEqual(check.result.products.map(p => p.kind), [kind]);
    const build = run('build', input);
    assert.equal(build.ok, true, JSON.stringify(build));
    assert.equal(run('build', input).result.bundleHash, build.result.bundleHash);
    const id = check.result.products[0].entry.entryName;
    assert.equal(run('verify', path.join(directory, 'dist', id, 'build')).ok, true);
    assert.equal(fs.existsSync(path.join(directory, '.ashfoxworkspace')), false);
  }
  const apple = path.join(temp, 'sprite/apple.ashfox');
  const original = fs.readFileSync(apple, 'utf8');
  const pointer = fs.readFileSync(path.join(temp, 'sprite/dist/apple/build/current.json'));
  fs.writeFileSync(apple, original.replace('./shared.ashfox', '../outside.ashfox'));
  assert.equal(run('build', apple).ok, false);
  assert.deepEqual(fs.readFileSync(path.join(temp, 'sprite/dist/apple/build/current.json')), pointer);
  fs.writeFileSync(apple, '\uFEFF' + original);
  assert.equal(run('check', apple).ok, false, 'BOM must not be silently removed by the host');
  fs.writeFileSync(apple, original);
  assert.equal(run('check', path.join(temp, 'sprite/shared.ashfox')).ok, false);
  fs.writeFileSync(path.join(temp, '.ashfoxworkspace'), '{}');
  assert.equal(run('check', apple).ok, false, 'invalid ancestor policy must not silently fall back');
  console.log('standalone native model/sprite/sound: no workspace, deterministic build, import boundary, stale output and policy precedence ok');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
