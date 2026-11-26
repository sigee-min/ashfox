import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeStructureNbt } from '@ashfox/engine-core';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CLI = path.join(REPO_ROOT, 'apps/cli/dist/ashfox.cjs');

const runCli = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 120000,
  });

const runJson = (...args: string[]) => {
  const res = runCli(...args);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  return JSON.parse(res.stdout);
};

const testCheckShowcases = (temp: string): void => {
  const wsCheck = runJson(
    'check',
    '--json',
    path.join(REPO_ROOT, 'examples/structure/.ashfoxworkspace'),
  );
  assert.equal(wsCheck.ok, true);
  assert.equal(wsCheck.result.products.length, 4);

  const stage = path.join(temp, 'standalone_checks');
  fs.cpSync(path.join(REPO_ROOT, 'examples/structure/assets'), path.join(stage, 'assets'), {
    recursive: true,
  });
  for (const [rel, expectedSize] of [
    ['assets/structures/medieval_cottage.ashfox', [13, 12, 13]],
    ['assets/structures/watchtower.ashfox', [11, 18, 11]],
    ['assets/structures/blacksmith.ashfox', [14, 11, 12]],
    ['assets/structures/tavern.ashfox', [15, 15, 13]],
  ] as const) {
    const json = runJson('check', '--json', path.join(stage, rel));
    assert.equal(json.ok, true);
    assert.equal(json.result.audit.passed, true);
    assert.ok(json.result.audit.score >= 85);
    assert.deepEqual(json.result.structure.size, expectedSize);
    assert.ok(json.result.structure.customAssets.length >= 2);
    const previewNames = json.result.declarations.previews.map((p: { name: string }) => p.name);
    assert.ok(previewNames.includes('exterior') && previewNames.includes('interior'));
  }
};

const testExports = (temp: string): void => {
  const stage = path.join(temp, 'standalone_struct');
  fs.mkdirSync(path.join(stage, 'assets/structures'), { recursive: true });
  fs.mkdirSync(path.join(stage, 'assets/module'), { recursive: true });
  fs.mkdirSync(path.join(stage, 'assets/models/props'), { recursive: true });
  for (const rel of [
    'assets/structures/medieval_cottage.ashfox',
    'assets/module/furnishings.ashfox',
    'assets/models/props/rune_pillar.ashfox',
    'assets/models/props/wall_lantern.ashfox',
  ]) {
    fs.copyFileSync(path.join(REPO_ROOT, 'examples/structure', rel), path.join(stage, rel));
  }
  const cottage = path.join(stage, 'assets/structures/medieval_cottage.ashfox');
  const built = runJson('build', '--json', cottage).result;
  assert.equal(built.exports.length, 2);
  const nbtExp = built.exports.find((e: { id: string }) => e.id.includes('java_structure'));
  const glbExp = built.exports.find((e: { id: string }) => e.id.includes('glb'));
  assert.ok(nbtExp && glbExp);
  const decoded = decodeStructureNbt(
    fs.readFileSync(path.join(nbtExp.directory, `${nbtExp.id}.nbt`)),
  );
  assert.equal(decoded.dataVersion, 3955);
  assert.deepEqual(decoded.size, [13, 12, 13]);
  assert.ok(decoded.palette.some((entry) => entry.Name === 'minecraft:chiseled_stone_bricks'));
  assert.ok(
    decoded.palette.some(
      (entry) => entry.Name === 'minecraft:lantern' && entry.Properties?.hanging === 'false',
    ),
  );
  const glbMagic = fs
    .readFileSync(path.join(glbExp.directory, `${glbExp.id}.glb`))
    .subarray(0, 4)
    .toString('utf8');
  assert.equal(glbMagic, 'glTF');
};

const testWorkspaceDualBuild = (temp: string): void => {
  const wsDir = path.join(temp, 'town');
  fs.cpSync(path.join(REPO_ROOT, 'examples/structure'), wsDir, {
    recursive: true,
    filter: (p) => !p.split(path.sep).includes('dist'),
  });
  const cfgPath = path.join(wsDir, '.ashfoxworkspace');

  const built = runJson('build', cfgPath, '--json').result;
  assert.equal(built.exports.length, 8);
  const checkBundle = runCli('check', path.join(wsDir, 'dist/build'));
  assert.equal(checkBundle.status, 0, checkBundle.stdout + checkBundle.stderr);
  const catalog = JSON.parse(fs.readFileSync(built.catalogPath, 'utf8'));
  assert.equal(catalog.assets.length, 8);
  assert.ok(catalog.assets.every((a: { kind: string }) => a.kind === 'structure'));
  const exportFiles = built.exports.flatMap((exp: { directory: string }) =>
    fs.readdirSync(exp.directory, { recursive: true }).map((f) => String(f)),
  );
  assert.equal(exportFiles.filter((f: string) => f.endsWith('.nbt')).length, 4);
  assert.equal(exportFiles.filter((f: string) => f.endsWith('.glb')).length, 4);
};

const main = (): void => {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-structure-cli-'));
  try {
    testCheckShowcases(temp);
    testExports(temp);
    testWorkspaceDualBuild(temp);
    console.log('ashfox structure CLI integration tests ok');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
};

main();
