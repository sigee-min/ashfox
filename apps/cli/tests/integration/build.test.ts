'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
const root = path.resolve(__dirname, '../../../..');
const cli = path.join(__dirname, '../../dist/ashfox.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-cli-'));
const project = path.join(temp, 'project');
fs.cpSync(path.join(root, 'examples/pipeline'), project, {
  recursive: true,
  filter: (source) => !source.split(path.sep).includes('dist'),
});
const config = path.join(project, '.ashfoxworkspace');
const run = (command: string, input = config, executable = cli) => {
  const child = spawnSync(process.execPath, [executable, command, input, '--json'], {
    encoding: 'utf8',
    timeout: 120000,
  });
  if (child.error) throw child.error;
  assert.equal(child.signal, null, child.stderr);
  let reply;
  try {
    reply = JSON.parse(String(child.stdout));
  } catch (error) {
    throw new Error(child.stdout + child.stderr, { cause: error });
  }
  assert.equal(reply.format, 'ashfox-cli-result');
  assert.equal(reply.version, 1);
  assert.equal(child.stdout.trim().split('\n').length, 1);
  return { code: child.status, ...reply };
};
const success = (value: ReturnType<typeof run>) => {
  assert.equal(value.code, 0, JSON.stringify(value));
  assert.equal(value.ok, true);
  return value.result;
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const interrupt = async (change: (child: import('node:child_process').ChildProcess) => void) => {
  const child = spawn(process.execPath, [cli, 'build', config, '--json']);
  let output = '',
    errors = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    errors += data;
  });
  const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.on('close', (code, signal) => resolve({ code, signal })),
  );
  const lock = path.join(project, 'dist/build/.writer');
  for (let i = 0; i < 1000 && !fs.existsSync(lock); i++) await wait(5);
  assert.ok(fs.existsSync(lock), 'worker acquired writer lock');
  await change(child);
  const exit = await finished;
  assert.equal(exit.signal, null, errors);
  return { code: exit.code, ...JSON.parse(String(output)) };
};
const main = async () => {
  const checked = success(run('check'));
  assert.deepEqual(checked.products.map((p: { kind: string }) => p.kind).sort(), [
    'model',
    'sound',
    'sprite',
  ]);
  const first = success(run('build'));
  const current = path.join(project, 'dist/build/current.json'),
    pointer = fs.readFileSync(current);
  const verified = success(run('verify', path.join(project, 'dist/build')));
  assert.equal(verified.bundleHash, first.bundleHash);
  const again = success(run('build'));
  assert.equal(again.bundleHash, first.bundleHash);
  const second = path.join(temp, 'second');
  fs.cpSync(project, second, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes('dist'),
  });
  assert.equal(
    success(run('build', path.join(second, '.ashfoxworkspace'))).bundleHash,
    first.bundleHash,
    'cold build is independent of absolute path',
  );
  const catalog = verified.catalog;
  const allFiles = catalog.assets.flatMap(
    (a: { files: { path: string; sha256: string }[] }) => a.files,
  );
  const glb = allFiles.find((f: { path: string }) => f.path.endsWith('.glb'));
  const glbBytes = fs.readFileSync(path.join(first.bundlePath, glb.path));
  const report = await require('gltf-validator').validateBytes(new Uint8Array(glbBytes));
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues));
  const png = allFiles.find((f: { path: string }) => f.path.endsWith('.png'));
  const pngBytes = fs.readFileSync(path.join(first.bundlePath, png.path));
  assert.equal(pngBytes.readUInt32BE(16), 16);
  assert.equal(pngBytes.readUInt32BE(20), 16);
  const waves = allFiles.filter((f: { path: string }) => f.path.endsWith('.wav'));
  assert.equal(waves.length, 2);
  for (const wave of waves) {
    const bytes = fs.readFileSync(path.join(first.bundlePath, wave.path));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 48000);
    assert.equal(bytes.readUInt32LE(40), 2 * 48000 * 2);
    let peak = 0;
    for (let i = 44; i < bytes.length; i += 2)
      peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
    assert.ok(peak > 0 && peak < 32767);
  }
  assert.notEqual(waves[0].sha256, waves[1].sha256);
  for (const item of first.exports) assert.ok(fs.statSync(item.directory).isDirectory());
  const soundPath = path.join(project, 'sounds/claw_hit.ashfox'),
    original = fs.readFileSync(soundPath, 'utf8');
  fs.writeFileSync(soundPath, original.replace('sampleRate = 48000', 'sampleRate = 44100'));
  assert.equal(run('build').code, 1);
  assert.deepEqual(fs.readFileSync(current), pointer);
  fs.writeFileSync(soundPath, original);
  const lock = path.join(project, 'dist/build/.writer');
  fs.mkdirSync(lock);
  assert.equal(run('build').code, 4);
  fs.rmdirSync(lock);
  const cancelled = await interrupt((child: import('node:child_process').ChildProcess) => {
    child.kill('SIGINT');
  });
  assert.equal(cancelled.code, 130);
  assert.deepEqual(fs.readFileSync(current), pointer);
  assert.ok(!fs.existsSync(lock), 'cancel releases lock');
  const stale = await interrupt(() => {
    fs.appendFileSync(soundPath, '\n// concurrent edit\n');
  });
  assert.equal(stale.code, 1);
  assert.deepEqual(fs.readFileSync(current), pointer);
  fs.writeFileSync(soundPath, original);
  const storageFailure = await interrupt((child: import('node:child_process').ChildProcess) => {
    fs.writeFileSync(
      path.join(project, 'dist/build', `.current-${child.pid}.json`),
      'injected incomplete pointer',
    );
  });
  assert.equal(storageFailure.code, 3);
  assert.deepEqual(fs.readFileSync(current), pointer);
  assert.ok(!fs.existsSync(lock), 'storage exception releases lock');
  const pngPath = path.join(first.bundlePath, png.path);
  fs.writeFileSync(pngPath, Buffer.from('corrupt'));
  assert.equal(run('verify', path.join(project, 'dist/build')).code, 3);
  fs.writeFileSync(pngPath, pngBytes);
  const extra = path.join(first.bundlePath, 'unexpected.txt');
  fs.writeFileSync(extra, 'extra');
  assert.equal(run('verify', path.join(project, 'dist/build')).code, 3);
  fs.unlinkSync(extra);
  const configBytes = fs.readFileSync(config);
  fs.writeFileSync(config, '{"format":"ashfox-workspace","version":1}');
  assert.equal(run('check').code, 2);
  fs.writeFileSync(config, configBytes);
  const ignored = JSON.parse(String(configBytes));
  ignored.ignore.push('sounds/**');
  fs.writeFileSync(config, JSON.stringify(ignored));
  assert.equal(run('check').code, 2);
  fs.writeFileSync(config, configBytes);
  const ignoredTree = JSON.parse(String(configBytes));
  ignoredTree.ignore.push('ignored/**');
  fs.writeFileSync(config, JSON.stringify(ignoredTree));
  fs.mkdirSync(path.join(project, 'ignored'));
  fs.symlinkSync(project, path.join(project, 'ignored/loop'));
  success(run('check'));
  fs.unlinkSync(path.join(project, 'ignored/loop'));
  fs.rmdirSync(path.join(project, 'ignored'));
  fs.writeFileSync(config, configBytes);
  const link = path.join(project, 'linked.ashfox');
  fs.symlinkSync(soundPath, link);
  assert.equal(run('check').code, 1);
  fs.unlinkSync(link);
  const clean = path.join(temp, 'unowned');
  fs.cpSync(project, clean, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes('dist'),
  });
  fs.mkdirSync(path.join(clean, 'dist/items'), { recursive: true });
  fs.writeFileSync(path.join(clean, 'dist/items/user.txt'), 'preserve');
  assert.equal(run('build', path.join(clean, '.ashfoxworkspace')).code, 3);
  assert.equal(fs.readFileSync(path.join(clean, 'dist/items/user.txt'), 'utf8'), 'preserve');
  const packed = spawnSync(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', temp],
    { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const filename = JSON.parse(String(packed.stdout))[0].filename,
    consumer = path.join(temp, 'consumer');
  fs.mkdirSync(consumer);
  const installed = spawnSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, filename)],
    { cwd: consumer, encoding: 'utf8' },
  );
  assert.equal(installed.status, 0, installed.stderr);
  const installedCli = path.join(consumer, 'node_modules/@ashfox/cli/dist/ashfox.cjs');
  assert.equal(success(run('build', config, installedCli)).bundleHash, first.bundleHash);
  process.stdout.write(
    'CLI mixed assets, cold reproducibility, validator, failure/stale/cancel/lock, integrity and isolated npm installation passed\n',
  );
};
main()
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }))
  .catch((error) => {
    process.stderr.write(String(error.stack) + '\n');
    process.exitCode = 1;
  });
