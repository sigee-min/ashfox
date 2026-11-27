'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
const validator = require('gltf-validator');
const root = path.resolve(__dirname, '../../../..'),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-game-'));
const project = path.join(temp, 'project'),
  config = path.join(project, '.ashfoxworkspace');
fs.mkdirSync(path.join(project, 'assets/models'), { recursive: true });
fs.mkdirSync(path.join(project, 'assets/module/griffin'), { recursive: true });
fs.mkdirSync(path.join(project, 'assets/sprites'), { recursive: true });
fs.mkdirSync(path.join(project, 'assets/sounds'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'showcase/assets/models/griffin_boss.ashfox'),
  path.join(project, 'assets/models/griffin_boss.ashfox'),
);
fs.copyFileSync(
  path.join(root, 'showcase/assets/module/griffin/griffin_plumage.ashfox'),
  path.join(project, 'assets/module/griffin/griffin_plumage.ashfox'),
);
fs.copyFileSync(
  path.join(root, 'showcase/assets/models/wall_lantern.ashfox'),
  path.join(project, 'assets/models/wall_lantern.ashfox'),
);
fs.copyFileSync(
  path.join(root, 'showcase/assets/sprites/iron_sword.ashfox'),
  path.join(project, 'assets/sprites/iron_sword.ashfox'),
);
fs.copyFileSync(
  path.join(root, 'showcase/assets/sounds/claw_hit.ashfox'),
  path.join(project, 'assets/sounds/claw_hit.ashfox'),
);
const original: Record<string, any> = {
  format: 'ashfox-workspace',
  version: 2,
  name: 'game-assets-test',
  packages: [
    {
      name: 'models',
      root: 'assets/models',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        entries: [
          { name: 'griffin_boss', path: 'griffin_boss.ashfox' },
          { name: 'wall_lantern', path: 'wall_lantern.ashfox' },
        ],
        modules: [],
        dependencies: [{ name: 'griffin_plumage' }],
      },
    },
    {
      name: 'griffin_plumage',
      root: 'assets/module/griffin',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        entries: [],
        modules: [{ subpath: './plumage', path: 'griffin_plumage.ashfox' }],
        dependencies: [],
      },
    },
    {
      name: 'sprites',
      root: 'assets/sprites',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        entries: [{ name: 'iron_sword', path: 'iron_sword.ashfox' }],
        modules: [],
        dependencies: [],
      },
    },
    {
      name: 'sounds',
      root: 'assets/sounds',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        entries: [{ name: 'claw_hit', path: 'claw_hit.ashfox' }],
        modules: [],
        dependencies: [],
      },
    },
  ],
  include: ['assets/**/*.ashfox'],
  ignore: ['assets/drafts/**'],
  build: { directory: 'dist/build' },
  exports: [
    {
      name: 'griffin',
      entry: { packageName: 'models', entryName: 'griffin_boss' },
      format: 'glb',
      directory: 'dist/griffin',
    },
    {
      name: 'marker',
      entry: { packageName: 'models', entryName: 'wall_lantern' },
      format: 'glb',
      directory: 'dist/props',
    },
    {
      name: 'iron_sword',
      entry: { packageName: 'sprites', entryName: 'iron_sword' },
      format: 'png',
      directory: 'dist/sprites',
    },
    {
      name: 'claw_hit',
      entry: { packageName: 'sounds', entryName: 'claw_hit' },
      format: 'wav',
      directory: 'dist/sounds',
    },
  ],
  packs: [
    {
      name: 'voxel_game',
      format: 'game_assets',
      directory: 'dist/game',
      archive: true,
      audio: 'wav',
      unitsPerMeter: 1,
      pixelsPerUnit: 16,
      spriteFilter: 'nearest',
      assets: [
        { id: 'creature.griffin', source: 'griffin', path: 'models/griffin' },
        { id: 'prop.marker', source: 'marker', path: 'models/marker' },
        { id: 'item.iron_sword', source: 'iron_sword', path: 'sprites/iron_sword' },
        { id: 'sfx.claw_hit', source: 'claw_hit', path: 'audio/claw_hit' },
      ],
    },
  ],
};
fs.writeFileSync(config, JSON.stringify(original));
const run = (command: string, input = config) => {
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, '../../dist/ashfox.cjs'), command, input, '--json'],
    {
      encoding: 'utf8',
      timeout: 120000,
    },
  );
  if (child.error) throw child.error;
  assert.equal(child.signal, null, child.stderr);
  return JSON.parse(String(child.stdout));
};
const success = (r: ReturnType<typeof run>) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result;
};
const write = (c: unknown) => fs.writeFileSync(config, JSON.stringify(c));
const load = (result: ReturnType<typeof success>) => {
  const output = result.exports.find((e: { id: string }) => e.id === 'voxel_game').directory;
  const files = unzipSync(fs.readFileSync(path.join(output, 'voxel_game.zip')));
  return { output, files, manifest: JSON.parse(String(Buffer.from(files['assets.json']))) };
};
const main = async () => {
  const first = success(run('build')),
    { output, files, manifest } = load(first);
  const readerFile = path.join(temp, 'reader.cjs');
  require('esbuild').buildSync({
    stdin: {
      contents: "export { readGameAssetManifest } from '@ashfox/asset-build';",
      resolveDir: root,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: readerFile,
  });
  const { readGameAssetManifest } = require(readerFile);
  assert.deepEqual(readGameAssetManifest(manifest), manifest);
  assert.throws(() => readGameAssetManifest({ ...manifest, extra: true }));
  const broken = structuredClone(manifest);
  broken.assets[0].files[0].path = '../escape';
  assert.throws(() => readGameAssetManifest(broken));
  const unlinked = structuredClone(manifest);
  unlinked.assets.find((a: { kind: string }) => a.kind === 'model').model = 'missing.glb';
  assert.throws(() => readGameAssetManifest(unlinked));
  const duplicate = structuredClone(manifest);
  duplicate.assets.push(duplicate.assets[0]);
  assert.throws(() => readGameAssetManifest(duplicate));
  assert.equal(manifest.format, 'ashfox-game-assets');
  assert.equal(manifest.version, 1);
  assert.equal(manifest.assets.length, 4);
  assert.equal(files['pack.mcmeta'], undefined);
  const names = [];
  for (const f of manifest.sharedTextures ?? []) {
    const data = files[f.path];
    assert.ok(data, f.path);
    names.push(f.path);
    assert.equal(data.length, f.byteLength);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), f.sha256);
    assert.deepEqual(Buffer.from(data), fs.readFileSync(path.join(output, 'game-assets', f.path)));
  }
  assert.ok((manifest.sharedTextures ?? []).length >= 2, 'multi-GLB pack extracts sharedTextures');
  for (const asset of manifest.assets) {
    for (const f of asset.files) {
      const data = files[f.path];
      assert.ok(data);
      names.push(f.path);
      assert.equal(data.length, f.byteLength);
      assert.equal(crypto.createHash('sha256').update(data).digest('hex'), f.sha256);
      assert.deepEqual(
        Buffer.from(data),
        fs.readFileSync(path.join(output, 'game-assets', f.path)),
      );
    }
    if (asset.kind === 'model') {
      const data = files[asset.model];
      const baseDir = path.posix.dirname(asset.model);
      const result = await validator.validateBytes(data, {
        externalResourceFunction: async (uri: string) => {
          const resolved = path.posix.normalize(path.posix.join(baseDir, uri));
          const bytes = files[resolved];
          if (!bytes) throw Error(`Missing external resource: ${resolved}`);
          return bytes;
        },
      });
      assert.equal(result.issues.numErrors, 0, JSON.stringify(result.issues));
      const gltf = JSON.parse(
        String(Buffer.from(data.subarray(20, 20 + Buffer.from(data).readUInt32LE(12)))),
      );
      assert.deepEqual(
        gltf.extensionsRequired ?? [],
        [],
        'portable GLB needs no compression/quantization extensions',
      );
      assert.deepEqual(asset.requiredExtensions, []);
      assert.ok(
        gltf.images.every(
          (image: { bufferView: number | undefined; uri: string | undefined }) =>
            image.bufferView === undefined &&
            typeof image.uri === 'string' &&
            image.uri.includes('textures/'),
        ),
      );
      assert.deepEqual(
        asset.clips.map((c: { name: string }) => c.name),
        (gltf.animations ?? []).map((c: { name: string }) => c.name),
      );
    }
    if (asset.kind === 'sprite') {
      assert.equal(asset.width, 32);
      assert.equal(asset.pixelsPerUnit, 16);
      assert.equal(asset.filter, 'nearest');
    }
    if (asset.kind === 'sound') {
      assert.equal(asset.codec, 'wav');
      assert.equal(asset.variants.length, 2);
      for (const variant of asset.variants) {
        const wav = Buffer.from(files[variant.file]);
        assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
        assert.equal(wav.readUInt32LE(24), variant.sample_rate);
        assert.equal(wav.readUInt16LE(22), variant.channels);
        assert.equal(
          (wav.length - 44) / 2 / variant.channels / variant.sample_rate,
          variant.durationSeconds,
        );
      }
    }
  }
  assert.deepEqual(
    names.sort(),
    Object.keys(files)
      .filter((n) => n !== 'assets.json')
      .sort(),
  );
  assert.equal(
    manifest.assets.find((a: { id: string }) => a.id === 'prop.marker').clips.length,
    0,
    'static props require no idle clip',
  );
  assert.equal(success(run('build')).bundleHash, first.bundleHash);
  const cold = path.join(temp, 'cold');
  fs.cpSync(project, cold, { recursive: true, filter: (p) => !p.split(path.sep).includes('dist') });
  assert.equal(
    success(run('build', path.join(cold, '.ashfoxworkspace'))).bundleHash,
    first.bundleHash,
  );
  success(run('check', path.join(project, 'dist/build')));
  const current = path.join(project, 'dist/build/current.json'),
    pointer = fs.readFileSync(current);
  const collision = structuredClone(original);
  collision.packs[0].assets.push({ ...collision.packs[0].assets[0], id: 'alias' });
  write(collision);
  assert.equal(run('build').ok, false);
  assert.deepEqual(fs.readFileSync(current), pointer);
  const selected = structuredClone(original);
  selected.packs[0].unitsPerMeter = 100;
  selected.packs[0].pixelsPerUnit = 32;
  selected.packs[0].spriteFilter = 'linear';
  selected.packs.push({
    name: 'minecraft',
    format: 'minecraft_java',
    directory: 'dist/minecraft',
    minecraftVersion: 'configured',
    metadata: {
      format: 'range',
      description: 'Same sprite',
      minFormat: [88, 0],
      maxFormat: [88, 0],
    },
    itemDefinitions: 'modern',
    archive: false,
    icon: null,
    models: [],
    items: [{ source: 'iron_sword', id: 'demo:sword', parent: 'handheld' }],
    sounds: [],
  });
  write(selected);
  const changed = success(run('build')),
    game = load(changed);
  assert.equal(
    game.manifest.assets.find((a: { kind: string }) => a.kind === 'model').unitsPerMeter,
    100,
  );
  assert.equal(
    game.manifest.assets.find((a: { kind: string }) => a.kind === 'sprite').pixelsPerUnit,
    32,
  );
  const modelPath = manifest.assets.find((a: { kind: string }) => a.kind === 'model').model;
  assert.deepEqual(
    Buffer.from(game.files[modelPath]),
    Buffer.from(files[modelPath]),
    'import hint must not secretly rescale geometry',
  );
  assert.ok(
    fs.existsSync(
      path.join(
        changed.exports.find((e: { id: string }) => e.id === 'minecraft').directory,
        'resource-pack/assets/demo/items/sword.json',
      ),
    ),
  );
  selected.exports.find((e: { name: string }) => e.name === 'griffin').encoding = 'optimized';
  write(selected);
  const optimized = load(success(run('build'))).manifest.assets.find(
    (a: { id: string }) => a.id === 'creature.griffin',
  );
  assert.ok(optimized.requiredExtensions.includes('EXT_meshopt_compression'));
  console.log(
    'game assets: portable GLB validator, static props, manifest/file lineage, WAV/PNG, cold builds, import hints and shared Minecraft output ok',
  );
};
main()
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
