'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const cli = path.join(__dirname, '../../dist/ashfox.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-onboarding-'));
const run = (...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: temp,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      ASHFOX_CHROME_PATH: path.join(temp, 'missing-chrome'),
      ASHFOX_FFMPEG_PATH: path.join(temp, 'missing-ffmpeg'),
    },
  });
try {
  for (const args of [[], ['--help'], ['help']]) {
    const result = run(...args);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /init <new-folder>/);
  }
  assert.equal(run('--version').stdout.trim(), require('../../../../package.json').version);
  assert.notEqual(run('--version', 'extra').status, 0);
  const diagnosed = run('doctor', '--json');
  assert.equal(diagnosed.status, 0);
  assert.equal(JSON.parse(String(diagnosed.stdout)).result.capture.available, false);
  assert.equal(JSON.parse(String(diagnosed.stdout)).result.ogg.available, false);
  assert.deepEqual(fs.readdirSync(temp), []);
  const invalid = run('init');
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /Usage: ashfox init/);
  const invalidJson = run('init', '--json');
  assert.equal(invalidJson.status, 2);
  assert.equal(JSON.parse(String(invalidJson.stdout)).ok, false);
  assert.equal(invalidJson.stderr, '');
  assert.notEqual(run('init', 'assets', '--bogus').status, 0);
  assert.equal(run('init', 'assets', '--json').status, 0);
  assert.equal(
    fs.existsSync(path.join(temp, 'assets/package.json')),
    false,
    'does not create a nested npm project',
  );
  const original = fs.readFileSync(path.join(temp, 'assets/asset/items/sword.ashfox'));
  assert.notEqual(run('init', 'assets').status, 0);
  assert.deepEqual(fs.readFileSync(path.join(temp, 'assets/asset/items/sword.ashfox')), original);
  assert.equal(run('export', 'assets/asset/items/sword.ashfox', '--output', 'sword.png').status, 0);
  assert.equal(fs.readFileSync(path.join(temp, 'sword.png')).subarray(1, 4).toString(), 'PNG');
  assert.notEqual(run('init', 'missing/child').status, 0);
  assert.equal(fs.existsSync(path.join(temp, 'missing')), false);
  fs.mkdirSync(path.join(temp, 'empty'));
  fs.writeFileSync(path.join(temp, 'file'), 'preserve');
  fs.symlinkSync(path.join(temp, 'assets'), path.join(temp, 'link'), 'junction');
  for (const target of ['empty', 'file', 'link']) assert.equal(run('init', target).status, 2);
  assert.equal(fs.readFileSync(path.join(temp, 'file'), 'utf8'), 'preserve');
  assert.deepEqual(fs.readFileSync(path.join(temp, 'assets/asset/items/sword.ashfox')), original);
  assert.equal(run('init', 'my assets').status, 0);
  assert.equal(
    run('export', 'my assets/asset/items/sword.ashfox', '--output', 'second.png').status,
    0,
  );
  for (const args of [
    ['doctor', '--json', '--json'],
    ['doctor', 'extra'],
    ['--help', 'extra'],
  ]) {
    assert.equal(run(...args).status, 2);
  }
  console.log(
    'CLI onboarding: help/version, optional tools, offline starter and collision preservation pass',
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
