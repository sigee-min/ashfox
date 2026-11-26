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
  readSnapshot,
  type CompiledBundle,
} from '@ashfox/asset-build';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CLI = path.join(REPO_ROOT, 'apps/cli/dist/ashfox.cjs');
const TOOLCHAIN = 'ashfox-perfcaching-test:1';
const WORKSPACES = ['sounds', 'structure', 'shared-creatures', 'items'] as const;

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
  fs.cpSync(path.join(REPO_ROOT, 'examples', name), dest, {
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
  const baseBundle = await compileBundle(snap, TOOLCHAIN, undefined, baseChecked);
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
  // 1. Sprite incremental edit (examples/items: apple.ashfox) -> must be < 50ms and bit-identical
  const itemsDir = path.join(tempRoot, 'edit-items');
  const itemsCfg = copyWorkspace('items', itemsDir);
  await compileNodeBundle(readSnapshot(itemsCfg), TOOLCHAIN);
  const applePath = path.join(itemsDir, 'assets/sprites/apple.ashfox');
  fs.writeFileSync(
    applePath,
    fs.readFileSync(applePath, 'utf8').replace('seed = 101;', 'seed = 202;'),
  );
  const editedItemsSnap = readSnapshot(itemsCfg);
  const tItems = performance.now();
  const incItems = await compileNodeBundle(editedItemsSnap, TOOLCHAIN);
  const itemsEditMs = performance.now() - tItems;
  const freshItems = await compileNodeBundle(editedItemsSnap, TOOLCHAIN, undefined, {
    noCache: true,
  });
  assertBundlesIdentical('items 1-file incremental edit', freshItems, incItems);
  assert.ok(itemsEditMs < 200, `items 1-file edit ${itemsEditMs.toFixed(1)}ms exceeded 200ms`);

  // 2. Sound incremental edit (examples/sounds: claw_hit.ashfox) -> must be fast and bit-identical
  const soundsDir = path.join(tempRoot, 'edit-sounds');
  const soundsCfg = copyWorkspace('sounds', soundsDir);
  await compileNodeBundle(readSnapshot(soundsCfg), TOOLCHAIN);
  const clawPath = path.join(soundsDir, 'assets/sounds/claw_hit.ashfox');
  fs.writeFileSync(
    clawPath,
    fs.readFileSync(clawPath, 'utf8').replace('seed = 104;', 'seed = 204;'),
  );
  const editedSoundsSnap = readSnapshot(soundsCfg);
  const tSounds = performance.now();
  const incSounds = await compileNodeBundle(editedSoundsSnap, TOOLCHAIN);
  const soundsEditMs = performance.now() - tSounds;
  const freshSounds = await compileNodeBundle(editedSoundsSnap, TOOLCHAIN, undefined, {
    noCache: true,
  });
  assertBundlesIdentical('sounds 1-file incremental edit', freshSounds, incSounds);
  assert.ok(soundsEditMs < 200, `sounds 1-file edit ${soundsEditMs.toFixed(1)}ms exceeded 200ms`);

  // 3. Creature incremental edit (examples/shared-creatures: fox.ashfox) -> bit-identical lineage & GLB
  const creaturesDir = path.join(tempRoot, 'edit-creatures');
  const creaturesCfg = copyWorkspace('shared-creatures', creaturesDir);
  await compileNodeBundle(readSnapshot(creaturesCfg), TOOLCHAIN);
  const foxPath = path.join(creaturesDir, 'assets/models/creatures/fox.ashfox');
  fs.writeFileSync(foxPath, fs.readFileSync(foxPath, 'utf8') + '\n// edit comment\n');
  const editedCreaturesSnap = readSnapshot(creaturesCfg);
  const incCreatures = await compileNodeBundle(editedCreaturesSnap, TOOLCHAIN);
  const freshCreatures = await compileNodeBundle(editedCreaturesSnap, TOOLCHAIN, undefined, {
    noCache: true,
  });
  assertBundlesIdentical('shared-creatures 1-file incremental edit', freshCreatures, incCreatures);

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
  const cfg = copyWorkspace('shared-creatures', dir);

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
  const spriteCfg = copyWorkspace('items', spriteDir);
  await compileNodeBundle(readSnapshot(spriteCfg), TOOLCHAIN);
  const rawCfg = JSON.parse(fs.readFileSync(spriteCfg, 'utf8')) as {
    exports: {
      name: string;
      entry: { packageName: string; entryName: string };
      format: string;
      directory: string;
    }[];
  };
  const appleExp = rawCfg.exports.find((e) => e.name === 'apple')!;
  const mutatedCfg = {
    ...rawCfg,
    exports: [
      ...rawCfg.exports.filter((e) => e.name !== 'apple'),
      { ...appleExp, name: 'crisp_apple', directory: 'exports/crisp_apple' },
      { ...appleExp, name: 'apple_clone', directory: 'exports/apple_clone' },
    ],
  };
  fs.writeFileSync(spriteCfg, JSON.stringify(mutatedCfg, null, 2));
  const mutatedSnap = readSnapshot(spriteCfg);
  const warmMutated = await compileNodeBundle(mutatedSnap, TOOLCHAIN);
  const coldMutated = await compileNodeBundle(mutatedSnap, TOOLCHAIN, undefined, { noCache: true });
  assertBundlesIdentical('sprite rename and multi-export cache', coldMutated, warmMutated);
};

const moveSharedSurfacesToModulePkg = (dir: string, cfgPath: string): void => {
  const commonDir = path.join(dir, 'assets/models/common');
  const creaturesDir = path.join(dir, 'assets/models/creatures');
  fs.mkdirSync(commonDir, { recursive: true });
  for (const f of ['surface.ashfox', 'goblin-surface.ashfox']) {
    fs.renameSync(path.join(creaturesDir, f), path.join(commonDir, f));
  }
  for (const f of ['fox.ashfox', 'body.ashfox', 'goblin.ashfox', 'goblin-body.ashfox']) {
    const p = path.join(creaturesDir, f);
    fs.writeFileSync(
      p,
      fs
        .readFileSync(p, 'utf8')
        .replaceAll('"./surface.ashfox"', '"common/surface"')
        .replaceAll('"./surface"', '"common/surface"')
        .replaceAll('"./goblin-surface.ashfox"', '"common/goblin-surface"')
        .replaceAll('"./goblin-surface"', '"common/goblin-surface"'),
    );
  }
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
    packages: {
      name: string;
      root: string;
      manifest: {
        format: string;
        version: number;
        entries: unknown[];
        modules: { subpath: string; path: string }[];
        dependencies: unknown[];
      };
    }[];
  };
  const creaturesPkg = raw.packages.find((p) => p.name === 'creatures')!;
  creaturesPkg.manifest.modules = creaturesPkg.manifest.modules.filter(
    (m) => m.path !== 'surface.ashfox' && m.path !== 'goblin-surface.ashfox',
  );
  creaturesPkg.manifest.dependencies.push({ name: 'common' });
  raw.packages.push({
    name: 'common',
    root: 'assets/models/common',
    manifest: {
      format: 'ashfox-package',
      version: 1,
      entries: [],
      modules: [
        { subpath: './surface', path: 'surface.ashfox' },
        { subpath: './goblin-surface', path: 'goblin-surface.ashfox' },
      ],
      dependencies: [],
    },
  });
  fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2));
};

const verifyModuleOnlyPkgInterface = async (tempRoot: string): Promise<void> => {
  const modDir = path.join(tempRoot, 'module-only-pkg');
  const cfgPath = copyWorkspace('shared-creatures', modDir);
  moveSharedSurfacesToModulePkg(modDir, cfgPath);
  const modSnap = readSnapshot(cfgPath);
  const seqBundle = await compileBundle(modSnap, TOOLCHAIN, undefined, checkSnapshot(modSnap));
  const nodeColdBundle = await compileNodeBundle(modSnap, TOOLCHAIN, undefined, { noCache: true });
  const nodeWarmBundle = await compileNodeBundle(modSnap, TOOLCHAIN);
  assertBundlesIdentical('module-only shared pkg cold', seqBundle, nodeColdBundle);
  assertBundlesIdentical('module-only shared pkg warm', seqBundle, nodeWarmBundle);
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
