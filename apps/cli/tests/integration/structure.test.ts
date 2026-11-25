import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeStructureNbt } from '@ashfox/engine-core';
import { readSnapshot } from '@ashfox/asset-build';

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

const testCheckShowcases = (): void => {
  for (const [rel, expectedSize] of [
    ['examples/structure/medieval_cottage.ashfox', [13, 12, 13]],
    ['examples/structure/watchtower.ashfox', [11, 18, 11]],
  ] as const) {
    const json = runJson('check', '--json', path.join(REPO_ROOT, rel));
    assert.equal(json.ok, true);
    assert.equal(json.result.audit.passed, true);
    assert.ok(json.result.audit.score >= 85);
    assert.deepEqual(json.result.structure.size, expectedSize);
    assert.ok(json.result.structure.customAssets.length >= 2);
  }
};

const testExports = (temp: string): void => {
  const stage = path.join(temp, 'standalone_struct');
  fs.mkdirSync(path.join(stage, 'props'), { recursive: true });
  for (const rel of [
    'medieval_cottage.ashfox',
    'furnishings.ashfox',
    'props/rune_pillar.ashfox',
    'props/wall_lantern.ashfox',
  ]) {
    fs.copyFileSync(path.join(REPO_ROOT, 'examples/structure', rel), path.join(stage, rel));
  }
  const cottage = path.join(stage, 'medieval_cottage.ashfox');
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
  fs.mkdirSync(path.join(wsDir, 'props'), { recursive: true });
  for (const rel of [
    'medieval_cottage.ashfox',
    'furnishings.ashfox',
    'props/rune_pillar.ashfox',
    'props/wall_lantern.ashfox',
  ]) {
    fs.copyFileSync(path.join(REPO_ROOT, 'examples/structure', rel), path.join(wsDir, rel));
  }
  const cottageEntry = path.join(wsDir, 'medieval_cottage.ashfox');
  const baseCfg = readSnapshot(cottageEntry).config;
  const cfgPath = path.join(wsDir, '.ashfoxworkspace');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      ...baseCfg,
      build: { directory: 'build' },
      exports: [
        {
          name: 'nbt',
          entry: { packageName: 'standalone', entryName: 'medieval_cottage' },
          format: 'java_structure',
          directory: 'exports/nbt',
        },
        {
          name: 'glb',
          entry: { packageName: 'standalone', entryName: 'medieval_cottage' },
          format: 'glb',
          directory: 'exports/glb',
        },
      ],
    }),
  );

  const built = runJson('build', cfgPath, '--json').result;
  const checkBundle = runCli('check', path.join(wsDir, 'build'));
  assert.equal(checkBundle.status, 0, checkBundle.stdout + checkBundle.stderr);
  const catalog = JSON.parse(fs.readFileSync(built.catalogPath, 'utf8'));
  assert.equal(catalog.assets[0].kind, 'structure');
  const exportFiles = built.exports.flatMap((exp: { directory: string }) =>
    fs.readdirSync(exp.directory, { recursive: true }).map((f) => String(f)),
  );
  assert.ok(exportFiles.some((f: string) => f.endsWith('.nbt')));
  assert.ok(exportFiles.some((f: string) => f.endsWith('.glb')));
};

const main = (): void => {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-structure-cli-'));
  try {
    testCheckShowcases();
    testExports(temp);
    testWorkspaceDualBuild(temp);
    console.log('ashfox structure CLI integration tests ok');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
};

main();
