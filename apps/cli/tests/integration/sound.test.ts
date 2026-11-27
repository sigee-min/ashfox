import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { readSnapshot, readGameAssetManifest, runJob } from '@ashfox/asset-build';
import { verifyPcm } from '../../../../packages/asset-build/src/bundle/audio';
import { prepareWorker } from '../../src/observe/worker';

const root = path.resolve(__dirname, '../../../..');
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-sound-dsl-'));
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');
const run = (...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 120000,
  });
const success = (...args: string[]) => {
  const child = run(...args);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  return JSON.parse(child.stdout);
};
const main = async () => {
  const input = path.join(temp, 'bell_pattern.ashfox');
  fs.copyFileSync(path.join(root, 'examples/sounds/assets/sounds/bell_pattern.ashfox'), input);
  const capabilities = success('doctor', '--json').result.sound;
  assert.ok(capabilities.features.includes('loops'));
  assert.equal(capabilities.output, 'fixed-gain');
  const inspection = success('check', input).result;
  const details = inspection.variants ?? inspection;
  assert.ok(JSON.stringify(details).includes('96960'));
  const directBuilt = success('build', input, '--json').result;
  const output = path.join(directBuilt.exports[0].directory, 'bell_pattern/base.wav');
  verifyPcm(fs.readFileSync(output), 96960, 2);
  const config = {
    ...readSnapshot(input).config,
    packs: [
      {
        name: 'game',
        format: 'game_assets',
        directory: 'dist/game',
        archive: false,
        audio: 'wav',
        unitsPerMeter: 16,
        pixelsPerUnit: 16,
        spriteFilter: 'nearest',
        assets: [{ id: 'sfx.bell', source: 'bell_pattern', path: 'sounds/bell' }],
      },
    ],
  };
  const configPath = path.join(temp, '.ashfoxworkspace');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const built = success('build', configPath, '--json').result;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(built.bundlePath, 'assets/game/game-assets/assets.json'), 'utf8'),
  );
  const sound = readGameAssetManifest(manifest).assets[0];
  assert.equal(sound.kind, 'sound');
  if (sound.kind !== 'sound') throw new Error('Expected sound');
  for (const variant of sound.variants) {
    assert.equal(variant.frames, 96960);
    assert.equal(variant.durationSeconds, 2.02);
    assert.deepEqual(variant.playback, { kind: 'loop', startFrame: 0, endFrame: 96960 });
    verifyPcm(
      fs.readFileSync(path.join(built.bundlePath, 'assets/game/game-assets', variant.file)),
      variant.frames,
      2,
    );
  }
  success('check', path.join(temp, config.build.directory), '--json');
  const bad = structuredClone(manifest);
  bad.assets[0].variants[0].playback.endFrame--;
  assert.throws(() => readGameAssetManifest(bad), /playback/);
  const old = structuredClone(manifest);
  delete old.assets[0].variants[0].playback;
  assert.throws(() => readGameAssetManifest(old), /fields/);
  const mismatched = structuredClone(manifest);
  mismatched.assets[0].variants[0].frames++;
  assert.throws(() => readGameAssetManifest(mismatched), /variant/);
  config.packs[0].audio = 'ogg';
  fs.writeFileSync(configPath, JSON.stringify(config));
  const builtOgg = success('build', configPath, '--json').result;
  const oggManifest = JSON.parse(
    fs.readFileSync(path.join(builtOgg.bundlePath, 'assets/game/game-assets/assets.json'), 'utf8'),
  );
  const oggSound = readGameAssetManifest(oggManifest).assets[0];
  assert.equal(oggSound.kind, 'sound');
  if (oggSound.kind !== 'sound') throw new Error('Expected sound');
  assert.equal(oggSound.codec, 'ogg');
  for (const variant of oggSound.variants) {
    assert.equal(variant.sampleRate, 48000);
    assert.equal(variant.loopStartSample, 0);
    assert.equal(variant.loopEndSample, 96960);
  }
  success('check', path.join(temp, config.build.directory), '--json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({ ...config, packs: [{ ...config.packs[0], audio: 'wav' }] }),
  );
  assert.equal(success('build', configPath, '--json').result.bundleHash, built.bundleHash);
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      ...config,
      packs: [
        {
          name: 'minecraft',
          format: 'minecraft_java',
          directory: 'dist/minecraft',
          minecraftVersion: '26.2',
          metadata: {
            format: 'range',
            minFormat: [88, 0],
            maxFormat: [88, 0],
            description: 'Loop rejection',
          },
          itemDefinitions: 'modern',
          archive: false,
          icon: null,
          models: [],
          items: [],
          sounds: [
            {
              source: 'bell_pattern',
              id: 'demo:bell',
              replace: true,
              subtitle: null,
              volume: 1,
              pitch: 1,
              stream: false,
              variants: 'all',
            },
          ],
        },
      ],
    }),
  );
  const minecraft = run('build', configPath, '--json');
  assert.notEqual(minecraft.status, 0);
  assert.match(minecraft.stdout, /sound.loop.target/);
  assert.doesNotMatch(minecraft.stdout, /ENOENT/);
  assert.equal(
    success('check', path.join(temp, config.build.directory), '--json').result.bundleHash,
    built.bundleHash,
  );

  // A controlled worker changes the file after the parent seals its snapshot.
  const staleWorker = path.join(temp, 'stale.cjs');
  fs.writeFileSync(
    staleWorker,
    `const { parentPort, workerData } = require('node:worker_threads');
    require('node:fs').appendFileSync(workerData.observe.input, '\\n// changed while compiling\\n');
    parentPort.postMessage({ ok: true, value: { kind: 'sound', revision: 'candidate', files: [] } });`,
  );
  await assert.rejects(
    prepareWorker(staleWorker, { file: input }, new AbortController().signal),
    /Source changed during compilation/,
  );
  verifyPcm(fs.readFileSync(output), 96960, 2);

  // Cancellation must interrupt CPU work and join it before acknowledging abort.
  const blockedWorker = path.join(temp, 'blocked.cjs');
  fs.writeFileSync(
    blockedWorker,
    `const { workerData } = require('node:worker_threads');
    const state = new Int32Array(workerData);
    Atomics.store(state, 0, 1);
    while (true) Atomics.wait(state, 1, 0, 1000);`,
  );
  const state = new Int32Array(new SharedArrayBuffer(8)),
    controller = new AbortController();
  const pending = runJob(blockedWorker, state.buffer, controller.signal);
  const cancellation = assert.rejects(pending, /Compilation cancelled/);
  const deadline = performance.now() + 5000;
  while (!Atomics.load(state, 0) && performance.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 2));
  const ready = Atomics.load(state, 0),
    abortTime = performance.now();
  controller.abort();
  await cancellation;
  assert.equal(ready, 1, 'worker must enter CPU work before cancellation');
  assert.ok(
    performance.now() - abortTime <= 250,
    'CPU cancellation must terminate and join within 250 ms',
  );

  fs.rmSync(configPath);
  const budgetInput = path.join(temp, 'budget.ashfox');
  const budgetSource = `ashfox 1
sound budget {
  profile = ambient;
  duration = 29s;
  sample_rate = 48000hz;
  channels = 1;
  seed = 1;
  voice wind : noise { color = pink; highpass = 20hz; lowpass = 2000hz; gain = 0.1; }
  seq s { step e { voice = wind; at = 0s; duration = 29s; } }
  variants { ${Array.from({ length: 8 }, (_, i) => `v_${i} = ${i + 1};`).join(' ')} }
  loop { at = 0s..29s; xfade = 80ms; }
  master { gain = -24db; peak = -3db; }
}`;
  fs.writeFileSync(budgetInput, budgetSource);
  assert.equal(success('check', budgetInput, '--json').result.products[0].kind, 'sound');
  const combined = structuredClone(readSnapshot(budgetInput).config);
  const secondPath = 'budget_second.ashfox';
  const combinedConfig = {
    ...combined,
    include: ['budget.ashfox', secondPath],
    packages: combined.packages.map((p) => ({
      ...p,
      manifest: {
        ...p.manifest,
        entries: [...p.manifest.entries, { name: 'budget_second', path: secondPath }],
      },
    })),
  };
  // If rendering starts before aggregate validation, the first entry fails as
  // silent instead of reporting the workspace budget for the complete inputs.
  fs.writeFileSync(budgetInput, budgetSource.replace('gain = 0.1;', 'gain = 0;'));
  fs.writeFileSync(
    path.join(temp, secondPath),
    budgetSource.replace('sound budget {', 'sound budget_second {').replaceAll('29s', '30s'),
  );
  const combinedPath = configPath;
  fs.writeFileSync(combinedPath, JSON.stringify(combinedConfig));
  const overBudget = run('check', combinedPath, '--json');
  assert.notEqual(overBudget.status, 0);
  assert.match(overBudget.stdout, /sound workspace budget/);
  assert.doesNotMatch(overBudget.stdout, /silent output/);
  fs.rmSync(combinedPath);
  const legacy = fs
    .readFileSync(input, 'utf8')
    .replace('voice bell_body : modal_plate {', 'voices = []; voice bell_body : modal_plate {');
  fs.writeFileSync(input, legacy);
  const rejected = run('check', input, '--json');
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stdout, /legacy-syntax|removed/);
  console.log(
    'Sound DSL: loop WAV, closed metadata, codec/target rejection, stale snapshot, joined cancellation and aggregate budgets pass',
  );
};
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
