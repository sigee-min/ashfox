'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
const root = path.resolve(__dirname, '../../../..'),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-packs-'));
const project = path.join(temp, 'project'),
  config = path.join(project, '.ashfoxworkspace');
fs.cpSync(path.join(root, 'examples/resource-pack'), project, {
  recursive: true,
  filter: (p) => !p.split(path.sep).includes('dist'),
});
const original = JSON.parse(String(fs.readFileSync(config, 'utf8')));
original.packs[0].sounds = [];
const write = (value: unknown) => fs.writeFileSync(config, JSON.stringify(value));
const run = (command: string, input = config) => {
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, '../../dist/ashfox.cjs'), command, input, '--json'],
    {
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, ASHFOX_FFMPEG_PATH: '/missing/not-needed' },
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
try {
  write(original);
  const first = success(run('build')),
    pack = first.exports.find((e: { id: string }) => e.id === 'game_pack');
  const files = unzipSync(fs.readFileSync(path.join(pack.directory, 'game_pack.zip')));
  assert.deepEqual(
    JSON.parse(String(Buffer.from(files['pack.mcmeta']).toString())).pack.min_format,
    [88, 0],
  );
  assert.ok(files['pack.png']);
  const item = JSON.parse(
    String(Buffer.from(files['assets/minecraft/items/iron_sword.json']).toString()),
  );
  assert.equal(item.model.model, 'minecraft:item/iron_sword');
  const model = JSON.parse(
    String(Buffer.from(files['assets/minecraft/models/item/iron_sword.json']).toString()),
  );
  assert.equal(model.textures.layer0, 'minecraft:item/iron_sword');
  assert.ok(files['assets/minecraft/textures/item/iron_sword.png']);
  assert.ok(files['assets/minecraft/blockstates/stone.json']);
  assert.ok(!Object.keys(files).some((f) => f.startsWith('resource-pack/')));
  for (const [name, bytes] of Object.entries(files))
    assert.deepEqual(
      Buffer.from(bytes),
      fs.readFileSync(path.join(pack.directory, 'resource-pack', name)),
    );
  assert.equal(success(run('build')).bundleHash, first.bundleHash);
  const cold = path.join(temp, 'cold');
  fs.cpSync(project, cold, { recursive: true, filter: (p) => !p.split(path.sep).includes('dist') });
  assert.equal(
    success(run('build', path.join(cold, '.ashfoxworkspace'))).bundleHash,
    first.bundleHash,
  );
  success(run('verify', path.join(project, 'dist/build')));
  const current = path.join(project, 'dist/build/current.json'),
    pointer = fs.readFileSync(current);
  const collision = structuredClone(original);
  collision.exports.push({
    ...collision.exports.find((e: { name: string }) => e.name === 'marker'),
    name: 'duplicate',
    directory: 'dist/duplicate',
  });
  collision.packs[0].models.push('duplicate');
  write(collision);
  assert.equal(run('build').ok, false);
  assert.deepEqual(fs.readFileSync(current), pointer);
  write(original);
  fs.mkdirSync(path.join(project, 'dist/pack/.writer'));
  assert.equal(run('build').ok, false);
  assert.deepEqual(fs.readFileSync(current), pointer);
  fs.rmdirSync(path.join(project, 'dist/pack/.writer'));
  const legacy = structuredClone(original);
  legacy.packs[0].metadata = {
    format: 'legacy',
    packFormat: 34,
    description: 'Configured legacy shape',
  };
  legacy.packs[0].itemDefinitions = 'legacy';
  legacy.packs[0].archive = false;
  legacy.packs[0].models = [];
  legacy.packs[0].minecraftVersion = 'user-defined';
  legacy.packs.push({ ...original.packs[0], name: 'second_pack', directory: 'dist/second-pack' });
  write(legacy);
  const combined = success(run('build'));
  const other = combined.exports.find((e: { id: string }) => e.id === 'second_pack').directory;
  assert.ok(fs.existsSync(path.join(other, 'second_pack.zip')));
  assert.ok(
    fs.existsSync(path.join(other, 'resource-pack/assets/minecraft/items/iron_sword.json')),
  );
  const old = combined.exports.find((e: { id: string }) => e.id === 'game_pack').directory;
  assert.equal(fs.existsSync(path.join(old, 'game_pack.zip')), false);
  assert.equal(fs.existsSync(path.join(old, 'resource-pack/assets/minecraft/items')), false);
  assert.equal(
    JSON.parse(String(fs.readFileSync(path.join(old, 'resource-pack/pack.mcmeta')))).pack
      .pack_format,
    34,
  );
  fs.appendFileSync(path.join(old, 'resource-pack/pack.mcmeta'), 'corrupt');
  // Canonical verification remains valid when a delivery mirror was changed later.
  success(run('verify', path.join(project, 'dist/build')));
  assert.equal(run('build').ok, false, 'republication must reject corrupt mirrors');
  console.log(
    'declarative packs: exact ZIP, PNG/model links, format configuration, cold build, collision/lock and mirror integrity ok',
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
