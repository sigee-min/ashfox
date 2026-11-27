'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const root = path.resolve(__dirname, '../../../..');
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-standalone-'));
const run = (command: string, input: string) => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, '../../dist/ashfox.cjs'), command, input, '--json'],
    { encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(result.signal, null, result.stderr);
  return JSON.parse(String(result.stdout));
};
try {
  for (const [folder, file, kind] of [
    ['showcase/assets', 'sprites/iron_sword.ashfox', 'sprite'],
    ['showcase/assets', 'models/wall_lantern.ashfox', 'model'],
    ['showcase/assets', 'sounds/claw_hit.ashfox', 'sound'],
  ]) {
    const baseDir = path.join(temp, kind, folder.endsWith('/assets') ? 'assets' : '');
    fs.cpSync(path.join(root, folder), baseDir, { recursive: true });
    const input = path.join(baseDir, file);
    fs.writeFileSync(path.join(path.dirname(input), 'unrelated.ashfox'), 'invalid unrelated file');
    const check = run('check', input);
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.deepEqual(
      check.result.products.map((p: { kind: string }) => p.kind),
      [kind],
    );
    const build = run('build', input);
    assert.equal(build.ok, true, JSON.stringify(build));
    assert.equal(run('build', input).result.bundleHash, build.result.bundleHash);
    const id = check.result.products[0].entry.entryName;
    assert.equal(run('check', path.join(baseDir, 'dist', id, 'build')).ok, true);
    assert.equal(fs.existsSync(path.join(temp, kind, '.ashfoxworkspace')), false);
  }
  const sword = path.join(temp, 'sprite/assets/sprites/iron_sword.ashfox');
  const original = fs.readFileSync(sword, 'utf8');
  const pointer = fs.readFileSync(
    path.join(temp, 'sprite/assets/dist/iron_sword/build/current.json'),
  );
  fs.writeFileSync(sword, original.replace('"std/sprite/item/weapon"', '"../../outside.ashfox"'));
  assert.equal(run('build', sword).ok, false);
  assert.deepEqual(
    fs.readFileSync(path.join(temp, 'sprite/assets/dist/iron_sword/build/current.json')),
    pointer,
  );
  fs.writeFileSync(sword, '\uFEFF' + original);
  assert.equal(run('check', sword).ok, false, 'BOM must not be silently removed by the host');
  fs.writeFileSync(sword, original);
  assert.equal(run('check', path.join(temp, 'sprite/assets/module/fox/fox_fur.ashfox')).ok, false);
  fs.writeFileSync(path.join(temp, '.ashfoxworkspace'), '{}');
  assert.equal(
    run('check', sword).ok,
    false,
    'invalid ancestor policy must not silently fall back',
  );
  console.log(
    'standalone native model/sprite/sound: no workspace, deterministic build, import boundary, stale output and policy precedence ok',
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
