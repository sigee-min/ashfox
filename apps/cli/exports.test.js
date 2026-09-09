'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-exports-'));
const configPath = path.join(temp, '.ashfoxworkspace');
const count = 129;
const names = Array.from({ length: count }, (_, i) => 'item_' + String(i).padStart(3, '0'));
const config = {
  format: 'ashfox-workspace', version: 2, name: 'many-items',
  packages: [{ name: 'items', root: 'src', manifest: {
    format: 'ashfox-package', version: 1,
    entries: names.map(name => ({ name, path: name + '.ashfox' })),
    modules: [{ subpath: './shared', path: 'shared.ashfox' }], dependencies: []
  } }],
  include: ['src/**/*.ashfox'], ignore: [], build: { directory: 'dist/build' },
  exports: names.map(name => ({ name, entry: { packageName: 'items', entryName: name }, format: 'png', directory: 'dist/' + name })),
  packs: [
    { name: 'game', format: 'game_assets', directory: 'dist/game', archive: false, audio: 'wav',
      unitsPerMeter: 16, pixelsPerUnit: 16, spriteFilter: 'nearest',
      assets: names.map(name => ({ id: name, source: name, path: 'items/' + name })) },
    { name: 'minecraft', format: 'minecraft_java', directory: 'dist/minecraft', minecraftVersion: 'configured',
      metadata: { format: 'legacy', description: 'Many items', packFormat: 46 }, itemDefinitions: 'modern',
      archive: false, icon: null, models: [], sounds: [],
      items: names.map(name => ({ source: name, id: 'demo:' + name, parent: 'generated' })) }
  ]
};
const write = value => fs.writeFileSync(configPath, JSON.stringify(value));
const run = (command, input = configPath) => {
  const child = spawnSync(process.execPath, [path.join(__dirname, 'dist/ashfox.cjs'), command, input, '--json'],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (child.error) throw child.error;
  assert.equal(child.signal, null, child.stderr);
  return JSON.parse(child.stdout);
};
const success = reply => { assert.equal(reply.ok, true, JSON.stringify(reply)); return reply.result; };
try {
  fs.mkdirSync(path.join(temp, 'src'));
  fs.copyFileSync(path.join(root, 'examples/items/src/shared.ashfox'), path.join(temp, 'src/shared.ashfox'));
  const source = fs.readFileSync(path.join(root, 'examples/items/src/apple.ashfox'), 'utf8');
  for (const name of names) fs.writeFileSync(path.join(temp, 'src', name + '.ashfox'), source.replace('sprite apple {', 'sprite ' + name + ' {'));
  write(config);
  const first = success(run('build'));
  assert.equal(first.exports.length, count + 2);
  const output = id => first.exports.find(e => e.id === id).directory;
  const manifest = JSON.parse(fs.readFileSync(path.join(output('game'), 'game-assets/assets.json')));
  assert.deepEqual(manifest.assets.map(a => a.id).sort(), names);
  for (const name of names) {
    const asset = manifest.assets.find(a => a.id === name);
    const image = fs.readFileSync(path.join(output('game'), 'game-assets', asset.image));
    assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a');
    const item = JSON.parse(fs.readFileSync(path.join(output('minecraft'), 'resource-pack/assets/demo/items', name + '.json')));
    assert.equal(item.model.model, 'demo:item/' + name);
  }
  success(run('verify', path.join(temp, 'dist/build')));
  assert.equal(success(run('build')).bundleHash, first.bundleHash);
  const readerPath = path.join(temp, 'readers.cjs');
  require('esbuild').buildSync({ stdin: { contents: "export { readDirectoryWorkspace } from '@ashfox/engine-core'; export { readGameAssetManifest } from '@ashfox/asset-build';", resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', outfile: readerPath });
  const { readDirectoryWorkspace, readGameAssetManifest } = require(readerPath);
  assert.deepEqual(readGameAssetManifest(manifest), manifest);
  const duplicate = structuredClone(manifest); duplicate.assets[count - 1].id = names[0];
  assert.throws(() => readGameAssetManifest(duplicate), /duplicate ID/);
  assert.throws(() => readDirectoryWorkspace(JSON.stringify({ ...config, exports: {} })), /array of exports/);
  const invalid = structuredClone(config); invalid.exports[count - 1].name = names[0];
  assert.throws(() => readDirectoryWorkspace(JSON.stringify(invalid)), /unique export id/);
  const missing = structuredClone(config); missing.packs[0].assets[count - 1].source = 'missing';
  assert.throws(() => readDirectoryWorkspace(JSON.stringify(missing)), /named GLB, PNG or WAV export/);
  const badItem = structuredClone(config); badItem.packs[1].items[count - 1].id = 'demo:' + names[0];
  assert.throws(() => readDirectoryWorkspace(JSON.stringify(badItem)), /unique item resource/);
  const pointer = path.join(temp, 'dist/build/current.json'), previous = fs.readFileSync(pointer);
  write(invalid);
  assert.equal(run('build').ok, false);
  assert.deepEqual(fs.readFileSync(pointer), previous);
  console.log('workspace exports: 129 native entries, PNGs, Minecraft/game bindings, runtime verification, repeatability and late invalid records pass');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
