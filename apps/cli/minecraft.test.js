'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-minecraft-'));
const run = (command, input) => {
  const child = spawnSync(process.execPath, [path.join(__dirname, 'dist/ashfox.cjs'), command, input, '--json'],
    { encoding: 'utf8', timeout: 120000 });
  if (child.error) throw child.error;
  assert.equal(child.signal, null, child.stderr);
  return JSON.parse(child.stdout);
};
const success = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.result; };
const copy = (example, destination) => fs.cpSync(path.join(root, 'examples', example), destination,
  { recursive: true, filter: file => !file.split(path.sep).includes('dist') });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
try {
  const block = path.join(temp, 'block'); copy('minecraft', block);
  const config = path.join(block, '.ashfoxworkspace');
  const first = success(run('build', config));
  const output = first.exports[0].directory;
  assert.ok(read(path.join(output, 'pack.mcmeta')).pack);
  const blockstate = read(path.join(output, 'assets/demo/blockstates/props/marker.json'));
  assert.equal(blockstate.variants[''].model, 'demo:block/props/marker');
  const model = read(path.join(output, 'assets/demo/models/block/props/marker.json'));
  assert.ok(model.elements.length);
  for (const resource of Object.values(model.textures)) {
    const resolved = resource.startsWith('#') ? model.textures[resource.slice(1)] : resource;
    const [namespace, location] = resolved.split(':');
    const png = fs.readFileSync(path.join(output, 'assets', namespace, 'textures', location + '.png'));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.ok(png.readUInt32BE(16) > 0);
  }
  assert.equal(success(run('verify', path.join(block, 'dist/build'))).bundleHash, first.bundleHash);
  const cold = path.join(temp, 'cold'); copy('minecraft', cold);
  assert.equal(success(run('build', path.join(cold, '.ashfoxworkspace'))).bundleHash, first.bundleHash);
  const original = read(config), current = path.join(block, 'dist/build/current.json'), pointer = fs.readFileSync(current);
  for (const change of [e => { delete e.namespace; }, e => { e.namespace = '../bad'; },
    e => { e.modelPath = '../bad'; }, e => { e.extra = true; }]) {
    const invalid = structuredClone(original); change(invalid.exports[0]); write(config, invalid);
    assert.equal(run('build', config).ok, false);
    assert.deepEqual(fs.readFileSync(current), pointer);
  }
  write(config, original);
  // Animated native models must retain clips in actor targets, and fail for Java blocks.
  const actors = path.join(temp, 'actors'); copy('pipeline', actors);
  const actorConfig = path.join(actors, '.ashfoxworkspace'), workspace = read(actorConfig);
  workspace.exports = ['geckolib5', 'bedrock'].map(format => ({ name: format, format, namespace: 'demo',
    modelPath: 'creatures/griffin', directory: 'dist/' + format, entry: { packageName: 'workbench', entryName: 'griffin' } }));
  write(actorConfig, workspace);
  const built = success(run('build', actorConfig));
  for (const target of built.exports) {
    const catalog = read(built.catalogPath).assets.find(a => a.id === target.id);
    assert.ok(catalog.metadata.clips.length);
    const geometry = catalog.files.find(f => f.path.endsWith('.geo.json'));
    const animation = catalog.files.find(f => f.path.endsWith('.animation.json'));
    assert.ok(read(path.join(built.bundlePath, geometry.path))['minecraft:geometry'].length);
    assert.ok(Object.keys(read(path.join(built.bundlePath, animation.path)).animations).length);
    assert.ok(catalog.files.some(f => f.path.endsWith('.png')));
  }
  success(run('verify', path.join(actors, 'dist/build')));
  const actorPointer = fs.readFileSync(path.join(actors, 'dist/build/current.json'));
  workspace.exports[0].format = 'java_block'; write(actorConfig, workspace);
  assert.equal(run('build', actorConfig).ok, false);
  assert.deepEqual(fs.readFileSync(path.join(actors, 'dist/build/current.json')), actorPointer);
  workspace.exports[0].entry = { packageName: 'items', entryName: 'iron_sword' }; write(actorConfig, workspace);
  assert.equal(run('check', actorConfig).ok, false);
  console.log('Minecraft CLI: static Java pack, PNG references, animated GeckoLib/Bedrock, cold reproducibility and atomic rejection ok');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
