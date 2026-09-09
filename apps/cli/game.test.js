'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { unzipSync } = require('fflate');
const validator = require('gltf-validator');
const root = path.resolve(__dirname, '../..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-game-'));
const project = path.join(temp, 'project'), config = path.join(project, '.ashfoxworkspace');
fs.cpSync(path.join(root, 'examples/game-assets'), project, { recursive: true, filter: p => !p.split(path.sep).includes('dist') });
const original = JSON.parse(fs.readFileSync(config));
assert.deepEqual(original.packs[0].assets.map(a => a.id).sort(),
  ['creature.griffin', 'item.iron_sword', 'sfx.claw_hit']);
// Static-model coverage belongs to the test fixture, not the starter scene.
fs.mkdirSync(path.join(project, 'props'));
fs.copyFileSync(path.join(root, 'examples/minecraft/marker.ashfox'), path.join(project, 'props/marker.ashfox'));
original.packages.push({ name: 'props', root: 'props', manifest: {
  format: 'ashfox-package', version: 1,
  entries: [{ name: 'marker', path: 'marker.ashfox' }], modules: [], dependencies: []
} });
original.exports.push({ name: 'marker', entry: { packageName: 'props', entryName: 'marker' },
  format: 'glb', directory: 'dist/props' });
original.packs[0].assets.push({ id: 'prop.marker', source: 'marker', path: 'models/marker' });
fs.writeFileSync(config, JSON.stringify(original));
const run = (command, input = config) => {
  const child = spawnSync(process.execPath, [path.join(__dirname, 'dist/ashfox.cjs'), command, input, '--json'],
    { encoding: 'utf8', timeout: 120000, env: { ...process.env, ASHFOX_FFMPEG_PATH: '/missing/wav-needs-no-encoder' } });
  if (child.error) throw child.error;
  assert.equal(child.signal, null, child.stderr); return JSON.parse(child.stdout);
};
const success = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };
const write = c => fs.writeFileSync(config, JSON.stringify(c));
const load = result => {
  const output = result.exports.find(e => e.id === 'voxel_game').directory;
  const files = unzipSync(fs.readFileSync(path.join(output, 'voxel_game.zip')));
  return { output, files, manifest: JSON.parse(Buffer.from(files['assets.json'])) };
};
const main = async () => {
  const first = success(run('build')), { output, files, manifest } = load(first);
  const readerFile = path.join(temp, 'reader.cjs');
  require('esbuild').buildSync({ stdin: { contents: "export { readGameAssetManifest } from '@ashfox/asset-build';", resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', outfile: readerFile });
  const { readGameAssetManifest } = require(readerFile);
  assert.deepEqual(readGameAssetManifest(manifest), manifest);
  assert.throws(() => readGameAssetManifest({ ...manifest, extra: true }));
  const broken = structuredClone(manifest); broken.assets[0].files[0].path = '../escape';
  assert.throws(() => readGameAssetManifest(broken));
  const unlinked = structuredClone(manifest); unlinked.assets.find(a => a.kind === 'model').model = 'missing.glb';
  assert.throws(() => readGameAssetManifest(unlinked));
  const duplicate = structuredClone(manifest); duplicate.assets.push(duplicate.assets[0]);
  assert.throws(() => readGameAssetManifest(duplicate));
  assert.equal(manifest.format, 'ashfox-game-assets'); assert.equal(manifest.version, 1);
  assert.equal(manifest.assets.length, 4); assert.equal(files['pack.mcmeta'], undefined);
  const names = [];
  for (const asset of manifest.assets) {
    for (const f of asset.files) {
      const data = files[f.path]; assert.ok(data); names.push(f.path);
      assert.equal(data.length, f.byteLength);
      assert.equal(crypto.createHash('sha256').update(data).digest('hex'), f.sha256);
      assert.deepEqual(Buffer.from(data), fs.readFileSync(path.join(output, 'game-assets', f.path)));
    }
    if (asset.kind === 'model') {
      const data = files[asset.model];
      const result = await validator.validateBytes(data, { externalResourceFunction: async () => { throw Error('GLB must be self-contained'); } });
      assert.equal(result.issues.numErrors, 0, JSON.stringify(result.issues));
      const gltf = JSON.parse(Buffer.from(data.subarray(20, 20 + Buffer.from(data).readUInt32LE(12))));
      assert.deepEqual(gltf.extensionsRequired ?? [], [], 'portable GLB needs no compression/quantization extensions');
      assert.deepEqual(asset.requiredExtensions, []);
      assert.ok(gltf.images.every(image => image.bufferView !== undefined && image.uri === undefined));
      assert.deepEqual(asset.clips.map(c => c.name), (gltf.animations ?? []).map(c => c.name));
    }
    if (asset.kind === 'sprite') { assert.equal(asset.width, 16); assert.equal(asset.pixelsPerUnit, 16); assert.equal(asset.filter, 'nearest'); }
    if (asset.kind === 'sound') {
      assert.equal(asset.codec, 'wav'); assert.equal(asset.variants.length, 2);
      for (const variant of asset.variants) {
        const wav = Buffer.from(files[variant.file]);
        assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
        assert.equal(wav.readUInt32LE(24), variant.sampleRate);
        assert.equal(wav.readUInt16LE(22), variant.channels);
        assert.equal((wav.length - 44) / 2 / variant.sampleRate, variant.durationSeconds);
      }
    }
  }
  assert.deepEqual(names.sort(), Object.keys(files).filter(n => n !== 'assets.json').sort());
  assert.equal(manifest.assets.find(a => a.id === 'prop.marker').clips.length, 0, 'static props require no idle clip');
  assert.equal(success(run('build')).bundleHash, first.bundleHash);
  const cold = path.join(temp, 'cold'); fs.cpSync(project, cold, { recursive: true, filter: p => !p.split(path.sep).includes('dist') });
  assert.equal(success(run('build', path.join(cold, '.ashfoxworkspace'))).bundleHash, first.bundleHash);
  success(run('verify', path.join(project, 'dist/build')));
  const current = path.join(project, 'dist/build/current.json'), pointer = fs.readFileSync(current);
  const collision = structuredClone(original); collision.packs[0].assets.push({ ...collision.packs[0].assets[0], id: 'alias' }); write(collision);
  assert.equal(run('build').ok, false); assert.deepEqual(fs.readFileSync(current), pointer);
  const selected = structuredClone(original);
  selected.packs[0].unitsPerMeter = 100; selected.packs[0].pixelsPerUnit = 32; selected.packs[0].spriteFilter = 'linear';
  selected.packs.push({ name: 'minecraft', format: 'minecraft_java', directory: 'dist/minecraft', minecraftVersion: 'configured',
    metadata: { format: 'range', description: 'Same sprite', minFormat: [88,0], maxFormat: [88,0] }, itemDefinitions: 'modern',
    archive: false, icon: null, models: [], items: [{ source: 'iron_sword', id: 'demo:sword', parent: 'handheld' }], sounds: [] });
  write(selected); const changed = success(run('build')), game = load(changed);
  assert.equal(game.manifest.assets.find(a => a.kind === 'model').unitsPerMeter, 100);
  assert.equal(game.manifest.assets.find(a => a.kind === 'sprite').pixelsPerUnit, 32);
  const modelPath = manifest.assets.find(a => a.kind === 'model').model;
  assert.deepEqual(Buffer.from(game.files[modelPath]), Buffer.from(files[modelPath]), 'import hint must not secretly rescale geometry');
  assert.ok(fs.existsSync(path.join(changed.exports.find(e => e.id === 'minecraft').directory, 'resource-pack/assets/demo/items/sword.json')));
  selected.exports.find(e => e.name === 'griffin').encoding = 'optimized'; write(selected);
  const optimized = load(success(run('build'))).manifest.assets.find(a => a.id === 'creature.griffin');
  assert.ok(optimized.requiredExtensions.includes('EXT_meshopt_compression'));
  console.log('game assets: portable GLB validator, static props, manifest/file lineage, WAV/PNG, cold builds, import hints and shared Minecraft output ok');
};
main().finally(() => fs.rmSync(temp, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
