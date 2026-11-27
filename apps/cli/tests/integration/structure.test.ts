import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { decodeStructureNbt } from '@ashfox/engine-core';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CLI = path.join(REPO_ROOT, 'apps/cli/dist/ashfox.cjs');

const runCli = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });

const runJson = (...args: string[]) => {
  const res = runCli(...args);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  return JSON.parse(res.stdout);
};

const copyStructureStandaloneFixtures = (destDir: string): string => {
  for (const rel of [
    'assets/structures/tavern.ashfox',
    'assets/structures/blacksmith.ashfox',
    'assets/models/wall_lantern.ashfox',
  ]) {
    const target = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'showcase', rel), target);
  }
  return destDir;
};

const testCheckShowcases = (temp: string): void => {
  const wsJson = runJson(
    'check',
    '--json',
    '--no-cache',
    path.join(REPO_ROOT, 'showcase/.ashfoxworkspace'),
  );
  assert.equal(wsJson.ok, true);
  const products = wsJson.result.products as {
    kind: string;
    entry: { entryName: string };
    audit: { passed: boolean; score: number; grade: string };
  }[];
  assert.equal(products.filter((p) => p.kind === 'structure').length, 6);
  for (const prod of products) {
    if (prod.audit) {
      assert.equal(prod.audit.passed, true, prod.entry.entryName);
      assert.ok(prod.audit.score >= 85, `${prod.entry.entryName} scored ${prod.audit.score}`);
      assert.equal(prod.audit.grade, 'excellent');
    }
  }

  const standaloneDir = copyStructureStandaloneFixtures(path.join(temp, 'standalone_check'));
  for (const [rel, expectedSize] of [
    ['assets/structures/tavern.ashfox', [19, 22, 17]],
    ['assets/structures/blacksmith.ashfox', [16, 19, 15]],
  ] as const) {
    const json = runJson('check', '--json', path.join(standaloneDir, rel));
    assert.equal(json.ok, true);
    assert.equal(json.result.audit.passed, true);
    assert.ok(json.result.audit.score >= 85);
    assert.deepEqual(json.result.structure.size, expectedSize);
    assert.equal(json.result.structure.density, 2);
    assert.ok(json.result.structure.customAssets.length >= 1);
    assert.ok(json.result.structure.playableMeta.zoneCount >= 2);
  }
};

const testWorkspaceDualAndGamePackBuild = (temp: string): void => {
  const wsDir = path.join(temp, 'structures');
  fs.cpSync(path.join(REPO_ROOT, 'showcase'), wsDir, {
    recursive: true,
    filter: (p) => !p.split(path.sep).some((part) => part === 'dist' || part === '.ashfox-cache'),
  });
  const cfgPath = path.join(wsDir, '.ashfoxworkspace');
  const built = runJson('build', cfgPath, '--json').result;
  const checkBundle = runCli('check', path.join(wsDir, 'dist/build'));
  assert.equal(checkBundle.status, 0, checkBundle.stdout + checkBundle.stderr);

  const catalog = JSON.parse(fs.readFileSync(built.catalogPath, 'utf8'));
  assert.ok(catalog.assets.filter((a: { kind: string }) => a.kind === 'structure').length >= 3);

  const nbtExp = built.exports.find((e: { id: string }) => e.id === 'tavern_nbt');
  const glbExp = built.exports.find((e: { id: string }) => e.id === 'tavern');
  const packExp = built.exports.find((e: { id: string }) => e.id === 'voxel_game');
  assert.ok(nbtExp && glbExp && packExp);

  const decoded = decodeStructureNbt(
    fs.readFileSync(path.join(nbtExp.directory, `${nbtExp.id}.nbt`)),
  );
  assert.equal(decoded.dataVersion, 3955);
  assert.deepEqual(decoded.size, [19, 22, 17]);
  assert.ok(decoded.palette.some((entry) => entry.Name === 'minecraft:jigsaw'));
  assert.ok(decoded.palette.some((entry) => entry.Name === 'minecraft:lantern'));

  const glbMagic = fs
    .readFileSync(path.join(glbExp.directory, `${glbExp.id}.glb`))
    .subarray(0, 4)
    .toString('utf8');
  assert.equal(glbMagic, 'glTF');
  const playableMeta = JSON.parse(
    fs.readFileSync(path.join(glbExp.directory, `${glbExp.id}.structure.json`), 'utf8'),
  );
  assert.ok(Array.isArray(playableMeta.colliders) && playableMeta.colliders.length > 0);
  assert.ok(Array.isArray(playableMeta.zones) && playableMeta.zones.length >= 2);
  assert.ok(Array.isArray(playableMeta.lights) && playableMeta.lights.length > 0);

  const packZip = unzipSync(fs.readFileSync(path.join(packExp.directory, 'voxel_game.zip')));
  const manifest = JSON.parse(String(Buffer.from(packZip['assets.json']!)));
  assert.ok(manifest.assets.filter((a: { kind: string }) => a.kind === 'structure').length >= 3);
  for (const entry of manifest.assets.filter((a: { kind: string }) => a.kind === 'structure')) {
    assert.equal(entry.kind, 'structure');
    assert.ok(packZip[entry.model], entry.model);
    assert.ok(packZip[entry.meta], entry.meta);
  }
};

const main = (): void => {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-structure-cli-'));
  try {
    testCheckShowcases(temp);
    testWorkspaceDualAndGamePackBuild(temp);
    console.log('ashfox structure CLI integration tests ok');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
};

main();
