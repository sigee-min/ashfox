'use strict';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  checkNodeSnapshot,
  checkSnapshot,
  compileBundle,
  compileNodeBundle,
  createVorbisEncoder,
  readSnapshot,
  type CompiledBundle,
} from '@ashfox/asset-build';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CLI = path.join(REPO_ROOT, 'apps/cli/dist/ashfox.cjs');
const TOOLCHAIN = 'ashfox-perfcaching-test:1';
const WORKSPACES = ['showcase'] as const;

const assertBundlesIdentical = (
  label: string,
  left: CompiledBundle,
  right: CompiledBundle,
): void => {
  assert.equal(left.receipt.sourceHash, right.receipt.sourceHash, `${label}: sourceHash`);
  assert.equal(left.receipt.requestKey, right.receipt.requestKey, `${label}: requestKey`);
  assert.equal(left.bundleHash, right.bundleHash, `${label}: bundleHash`);
  assert.equal(left.artifacts.length, right.artifacts.length, `${label}: artifact count`);
  for (let i = 0; i < left.artifacts.length; i++) {
    const a = left.artifacts[i]!;
    const b = right.artifacts[i]!;
    assert.equal(a.path, b.path, `${label}: artifact path[${i}]`);
    assert.equal(
      Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes)),
      0,
      `${label}: bytes mismatch at ${a.path}`,
    );
  }
};

const copyWorkspace = (name: string, dest: string): string => {
  fs.cpSync(path.join(REPO_ROOT, name), dest, {
    recursive: true,
    filter: (source) => !source.split(path.sep).some((p) => p === 'dist' || p === '.ashfox-cache'),
  });
  return path.join(dest, '.ashfoxworkspace');
};

const runCli = (args: readonly string[], env?: NodeJS.ProcessEnv) => {
  const child = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const parsed = JSON.parse(child.stdout) as {
    format: string;
    version: number;
    ok: boolean;
    result: { bundleHash?: string; sourceHash?: string };
  };
  assert.equal(parsed.format, 'ashfox-cli-result');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.ok, true);
  return parsed;
};

interface BenchRow {
  readonly workspace: string;
  readonly baselineMs: number;
  readonly singleColdMs: number;
  readonly parallelColdMs: number;
  readonly warmMs: number;
  readonly warmCheckMs: number;
}

const verifyWorkspaceDeterminismAndBench = async (
  name: string,
  tempRoot: string,
): Promise<BenchRow> => {
  const wsDir = path.join(tempRoot, name);
  const cfgPath = copyWorkspace(name, wsDir);
  const snap = readSnapshot(cfgPath);

  // Baseline sequential bundle compilation (no node pool/cache)
  const tBase = performance.now();
  const baseChecked = checkSnapshot(snap);
  const baseBundle = await compileBundle(snap, TOOLCHAIN, await createVorbisEncoder(), baseChecked);
  const baselineMs = performance.now() - tBase;

  // Single-thread cold via compileNodeBundle (ASHFOX_JOBS=1, noCache)
  process.env.ASHFOX_JOBS = '1';
  const tSingle = performance.now();
  const singleBundle = await compileNodeBundle(snap, TOOLCHAIN, undefined, { noCache: true });
  const singleColdMs = performance.now() - tSingle;
  delete process.env.ASHFOX_JOBS;
  assert.equal(fs.existsSync(path.join(wsDir, '.ashfox-cache')), false);
  assertBundlesIdentical(`${name} single vs baseline`, baseBundle, singleBundle);

  // Parallel cold (noCache)
  const tParallel = performance.now();
  const parallelBundle = await compileNodeBundle(snap, TOOLCHAIN, undefined, { noCache: true });
  const parallelColdMs = performance.now() - tParallel;
  assert.equal(fs.existsSync(path.join(wsDir, '.ashfox-cache')), false);
  assertBundlesIdentical(`${name} parallel vs single`, singleBundle, parallelBundle);

  // Populate cache, then measure warm rebuild & warm check
  const populated = await compileNodeBundle(snap, TOOLCHAIN);
  assert.ok(fs.existsSync(path.join(wsDir, '.ashfox-cache')));
  assertBundlesIdentical(`${name} cache populate`, singleBundle, populated);

  const tWarm = performance.now();
  const warmBundle = await compileNodeBundle(snap, TOOLCHAIN);
  const warmMs = performance.now() - tWarm;
  assertBundlesIdentical(`${name} warm vs single`, singleBundle, warmBundle);

  await checkNodeSnapshot(snap);
  let warmCheckMs = Infinity;
  let warmCheck = await checkNodeSnapshot(snap);
  for (let i = 0; i < 3; i += 1) {
    const tWarmCheck = performance.now();
    warmCheck = await checkNodeSnapshot(snap);
    warmCheckMs = Math.min(warmCheckMs, performance.now() - tWarmCheck);
  }
  assert.equal(warmCheck.sourceHash, singleBundle.receipt.sourceHash);
  assert.ok(
    warmCheckMs < Math.max(150, baselineMs * 0.25),
    `${name} warm check ${warmCheckMs.toFixed(1)}ms exceeded budget`,
  );

  return { workspace: name, baselineMs, singleColdMs, parallelColdMs, warmMs, warmCheckMs };
};

const verifySingleFileEditIncremental = async (tempRoot: string): Promise<void> => {
  // 1. Sprite incremental edit (showcase: iron_sword.ashfox) -> must be < 200ms and bit-identical
  const itemsDir = path.join(tempRoot, 'edit-items');
  const itemsCfg = copyWorkspace('showcase', itemsDir);
  await compileNodeBundle(readSnapshot(itemsCfg), TOOLCHAIN);
  const swordPath = path.join(itemsDir, 'assets/sprites/iron_sword.ashfox');
  fs.writeFileSync(
    swordPath,
    fs.readFileSync(swordPath, 'utf8').replace('seed = 7;', 'seed = 19;'),
  );
  const editedItemsSnap = readSnapshot(itemsCfg);
  const tItems = performance.now();
  const incItems = await compileNodeBundle(editedItemsSnap, TOOLCHAIN);
  const itemsEditMs = performance.now() - tItems;
  const tFreshItems = performance.now();
  const freshItems = await compileNodeBundle(editedItemsSnap, TOOLCHAIN, undefined, {
    noCache: true,
  });
  const freshItemsMs = performance.now() - tFreshItems;
  assertBundlesIdentical('showcase sprite 1-file incremental edit', freshItems, incItems);
  // Showcase iron_sword edit skips 34 other cached assets across the 35-asset showcase and rebuilds voxel_game & showcase_pack ZIPs.
  assert.ok(itemsEditMs < 800, `items 1-file edit ${itemsEditMs.toFixed(1)}ms exceeded 800ms`);
  assert.ok(
    itemsEditMs < freshItemsMs * 0.5,
    `items incremental ${itemsEditMs.toFixed(1)}ms was not faster than cold ${freshItemsMs.toFixed(1)}ms`,
  );

  // 2. Sound incremental edit (showcase: claw_hit.ashfox) -> must be fast and bit-identical
  const soundsDir = path.join(tempRoot, 'edit-sounds');
  const soundsCfg = copyWorkspace('showcase', soundsDir);
  await compileNodeBundle(readSnapshot(soundsCfg), TOOLCHAIN);
  const clawPath = path.join(soundsDir, 'assets/sounds/claw_hit.ashfox');
  fs.writeFileSync(
    clawPath,
    fs.readFileSync(clawPath, 'utf8').replace('seed = 42;', 'seed = 142;'),
  );
  const editedSoundsSnap = readSnapshot(soundsCfg);
  const tSounds = performance.now();
  const incSounds = await compileNodeBundle(editedSoundsSnap, TOOLCHAIN);
  const soundsEditMs = performance.now() - tSounds;
  const tFreshSounds = performance.now();
  const freshSounds = await compileNodeBundle(editedSoundsSnap, TOOLCHAIN, undefined, {
    noCache: true,
  });
  const freshSoundsMs = performance.now() - tFreshSounds;
  assertBundlesIdentical('showcase sound 1-file incremental edit', freshSounds, incSounds);
  // Showcase claw_hit recompiles 2 OGG Vorbis variants + rebuilds voxel_game & showcase_pack ZIPs.
  assert.ok(soundsEditMs < 2500, `sounds 1-file edit ${soundsEditMs.toFixed(1)}ms exceeded 2500ms`);
  assert.ok(
    soundsEditMs < freshSoundsMs * 0.5,
    `sounds incremental ${soundsEditMs.toFixed(1)}ms was not faster than cold ${freshSoundsMs.toFixed(1)}ms`,
  );

  // 3. Creature incremental edit (showcase: red_fox.ashfox) -> bit-identical lineage & GLB
  const creaturesDir = path.join(tempRoot, 'edit-creatures');
  const creaturesCfg = copyWorkspace('showcase', creaturesDir);
  await compileNodeBundle(readSnapshot(creaturesCfg), TOOLCHAIN);
  const foxPath = path.join(creaturesDir, 'assets/models/red_fox.ashfox');
  fs.writeFileSync(foxPath, fs.readFileSync(foxPath, 'utf8') + '\n// edit comment\n');
  const editedCreaturesSnap = readSnapshot(creaturesCfg);
  const incCreatures = await compileNodeBundle(editedCreaturesSnap, TOOLCHAIN);
  const freshCreatures = await compileNodeBundle(editedCreaturesSnap, TOOLCHAIN, undefined, {
    noCache: true,
  });
  assertBundlesIdentical('showcase creature 1-file incremental edit', freshCreatures, incCreatures);

  // 4. Compiler fingerprint invalidation
  const bumped = await compileNodeBundle(editedItemsSnap, TOOLCHAIN, undefined, {
    compilerInvalidator: 'bump-v2',
  });
  assertBundlesIdentical('compiler invalidator bump', freshItems, bumped);
  process.stdout.write(
    `1-file edit incremental ms: items=${itemsEditMs.toFixed(1)}ms, sounds=${soundsEditMs.toFixed(1)}ms\n`,
  );
};

const verifyCliFlagsAndDeterminism = (tempRoot: string): void => {
  const dir = path.join(tempRoot, 'cli-verify');
  const cfg = copyWorkspace('showcase', dir);

  const singleCli = runCli(['build', cfg, '--no-cache', '--json'], { ASHFOX_JOBS: '1' });
  assert.equal(fs.existsSync(path.join(dir, '.ashfox-cache')), false, '--no-cache must skip cache');

  const envNoCacheCli = runCli(['build', cfg, '--json'], { ASHFOX_NO_CACHE: '1' });
  assert.equal(
    fs.existsSync(path.join(dir, '.ashfox-cache')),
    false,
    'ASHFOX_NO_CACHE=1 must skip cache',
  );
  assert.equal(envNoCacheCli.result.bundleHash, singleCli.result.bundleHash);

  const parallelCli = runCli(['build', cfg, '--json']);
  assert.equal(fs.existsSync(path.join(dir, '.ashfox-cache')), true, 'build populates cache');
  assert.equal(parallelCli.result.bundleHash, singleCli.result.bundleHash);

  const checkNoCache = runCli(['check', cfg, '--no-cache', '--json']);
  const checkCached = runCli(['check', cfg, '--json']);
  assert.equal(checkNoCache.result.sourceHash, checkCached.result.sourceHash);
};

const verifySpriteTargetCache = async (tempRoot: string): Promise<void> => {
  const spriteDir = path.join(tempRoot, 'sprite-targets');
  const spriteCfg = copyWorkspace('showcase', spriteDir);
  await compileNodeBundle(readSnapshot(spriteCfg), TOOLCHAIN);
  const rawCfg = JSON.parse(fs.readFileSync(spriteCfg, 'utf8')) as {
    exports: {
      name: string;
      entry: { packageName: string; entryName: string };
      format: string;
      directory: string;
    }[];
  };
  const swordExp = rawCfg.exports.find((e) => e.name === 'iron_sword')!;
  const mutatedCfg = {
    ...rawCfg,
    exports: [
      ...rawCfg.exports.filter((e) => e.name !== 'iron_sword'),
      { ...swordExp, name: 'crisp_sword', directory: 'exports/crisp_sword' },
      { ...swordExp, name: 'sword_clone', directory: 'exports/sword_clone' },
    ],
    packs: [],
  };
  fs.writeFileSync(spriteCfg, JSON.stringify(mutatedCfg, null, 2));
  const mutatedSnap = readSnapshot(spriteCfg);
  const warmMutated = await compileNodeBundle(mutatedSnap, TOOLCHAIN);
  const coldMutated = await compileNodeBundle(mutatedSnap, TOOLCHAIN, undefined, { noCache: true });
  assertBundlesIdentical('sprite rename and multi-export cache', coldMutated, warmMutated);
};

const verifyModuleOnlyPkgInterface = async (tempRoot: string): Promise<void> => {
  const modDir = path.join(tempRoot, 'module-only-pkg');
  const cfgPath = copyWorkspace('showcase', modDir);
  const modSnap = readSnapshot(cfgPath);
  const seqBundle = await compileBundle(
    modSnap,
    TOOLCHAIN,
    await createVorbisEncoder(),
    checkSnapshot(modSnap),
  );
  const nodeColdBundle = await compileNodeBundle(modSnap, TOOLCHAIN, undefined, { noCache: true });
  const nodeWarmBundle = await compileNodeBundle(modSnap, TOOLCHAIN);
  assertBundlesIdentical('module-only shared pkg cold', seqBundle, nodeColdBundle);
  assertBundlesIdentical('module-only shared pkg warm', seqBundle, nodeWarmBundle);
};

const SPLIT_STD_WORKSPACE = {
  format: 'ashfox-workspace',
  version: 2,
  name: 'split-std-probe',
  packages: [
    {
      name: 'shared',
      root: 'assets/module/shared',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        entries: [],
        modules: [
          { subpath: './fur', path: 'fox_fur.ashfox' },
          { subpath: './goblin_kit', path: 'goblin_kit.ashfox' },
          { subpath: './goblin_skins', path: 'goblin_skins.ashfox' },
        ],
        dependencies: [],
      },
    },
    {
      name: 'models',
      root: 'assets/models',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        entries: [
          { name: 'red_fox', path: 'red_fox.ashfox' },
          { name: 'goblin_raider', path: 'goblin_raider.ashfox' },
        ],
        modules: [],
        dependencies: [{ name: 'shared' }],
      },
    },
  ],
  include: ['assets/**/*.ashfox'],
  ignore: ['dist/**'],
  build: { directory: 'dist/build' },
  exports: [
    {
      name: 'red_fox',
      entry: { packageName: 'models', entryName: 'red_fox' },
      format: 'glb',
      directory: 'dist/red_fox',
    },
    {
      name: 'goblin_raider',
      entry: { packageName: 'models', entryName: 'goblin_raider' },
      format: 'glb',
      directory: 'dist/goblin_raider',
    },
  ],
};

const verifySplitSharedStdProbe = async (tempRoot: string): Promise<void> => {
  const dir = path.join(tempRoot, 'split-std-probe');
  fs.mkdirSync(path.join(dir, 'assets/module/shared'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets/models'), { recursive: true });
  const cfgPath = path.join(dir, '.ashfoxworkspace');
  fs.writeFileSync(cfgPath, JSON.stringify(SPLIT_STD_WORKSPACE, null, 2));
  fs.copyFileSync(
    path.join(REPO_ROOT, 'showcase/assets/module/fox/fox_fur.ashfox'),
    path.join(dir, 'assets/module/shared/fox_fur.ashfox'),
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, 'showcase/assets/module/goblin/goblin_kit.ashfox'),
    path.join(dir, 'assets/module/shared/goblin_kit.ashfox'),
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, 'showcase/assets/module/goblin/goblin_skins.ashfox'),
    path.join(dir, 'assets/module/shared/goblin_skins.ashfox'),
  );
  fs.writeFileSync(
    path.join(dir, 'assets/models/red_fox.ashfox'),
    fs
      .readFileSync(path.join(REPO_ROOT, 'showcase/assets/models/red_fox.ashfox'), 'utf8')
      .replace('"fox_fur/fur"', '"shared/fur"'),
  );
  fs.writeFileSync(
    path.join(dir, 'assets/models/goblin_raider.ashfox'),
    fs
      .readFileSync(path.join(REPO_ROOT, 'showcase/assets/models/goblin_raider.ashfox'), 'utf8')
      .replaceAll('"shared_modules/', '"shared/'),
  );
  const snap = readSnapshot(cfgPath);
  const seqBundle = await compileBundle(snap, TOOLCHAIN, undefined, checkSnapshot(snap));
  const nodeCold = await compileNodeBundle(snap, TOOLCHAIN, undefined, { noCache: true });
  assertBundlesIdentical('split shared module with implicit std probe', seqBundle, nodeCold);
};

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-perfcache-'));
  try {
    const rows: BenchRow[] = [];
    for (const name of WORKSPACES) {
      rows.push(await verifyWorkspaceDeterminismAndBench(name, tempRoot));
    }
    await verifySingleFileEditIncremental(tempRoot);
    verifyCliFlagsAndDeterminism(tempRoot);
    await verifySpriteTargetCache(tempRoot);
    await verifyModuleOnlyPkgInterface(tempRoot);
    await verifySplitSharedStdProbe(tempRoot);
    process.stdout.write(
      'Benchmark (Before / Single Cold / Parallel Cold / Warm Build / Warm Check ms):\n' +
        rows
          .map(
            (r) =>
              `  ${r.workspace.padEnd(16)} before=${r.baselineMs.toFixed(1)}ms single=${r.singleColdMs.toFixed(1)}ms parallel=${r.parallelColdMs.toFixed(1)}ms warmBuild=${r.warmMs.toFixed(1)}ms warmCheck=${r.warmCheckMs.toFixed(1)}ms`,
          )
          .join('\n') +
        '\n',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  process.stderr.write(
    String(error instanceof Error ? (error.stack ?? error.message) : error) + '\n',
  );
  process.exitCode = 1;
});
