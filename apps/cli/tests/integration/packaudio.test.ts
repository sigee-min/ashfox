'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createVorbisEncoder, decodeVorbis } from '@ashfox/asset-build';
import { unzipSync } from 'fflate';
const root = path.resolve(__dirname, '../../../..'),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-packaudio-'));
const project = path.join(temp, 'project'),
  config = path.join(project, '.ashfoxworkspace');
const executable = path.join(__dirname, '../../dist/ashfox.cjs');
fs.cpSync(path.join(root, 'examples/resource-pack'), project, {
  recursive: true,
  filter: (p) => !p.split(path.sep).includes('dist'),
});
const original = JSON.parse(String(fs.readFileSync(config, 'utf8')));
const run = (command: string, input = config, env = process.env) => {
  const child = spawnSync(process.execPath, [executable, command, input, '--json'], {
    encoding: 'utf8',
    timeout: 120000,
    env,
  });
  if (child.error) throw child.error;
  assert.equal(child.signal, null, child.stderr);
  return JSON.parse(String(child.stdout));
};
const success = (r: ReturnType<typeof run>) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result;
};
const write = (value: unknown) => fs.writeFileSync(config, JSON.stringify(value));
const main = async () => {
  const first = success(run('build'));
  const pack = first.exports.find((e: { id: string }) => e.id === 'game_pack'),
    files = unzipSync(fs.readFileSync(path.join(pack.directory, 'game_pack.zip')));
  const definitions = JSON.parse(String(Buffer.from(files['assets/demo/sounds.json']).toString()));
  const event = definitions['combat.claw_hit'];
  assert.equal(event.replace, true);
  assert.equal(event.sounds.length, 2);
  for (const sound of event.sounds) {
    const [namespace, name] = sound.name.split(':');
    const ogg = files[`assets/${namespace}/sounds/${name}.ogg`];
    assert.equal(Buffer.from(ogg.subarray(0, 4)).toString(), 'OggS');
    const decoded = await decodeVorbis(ogg);
    assert.equal(decoded.sampleRate, 48000);
    assert.ok(decoded.samples.length > 0);
    for (const sample of decoded.samples) assert.ok(Math.abs(sample) < 1);
  }
  assert.equal(
    success(run('build')).bundleHash,
    first.bundleHash,
    'OGG serial and ZIP timestamps must be deterministic',
  );
  const cold = path.join(temp, 'cold');
  fs.cpSync(project, cold, { recursive: true, filter: (p) => !p.split(path.sep).includes('dist') });
  assert.equal(
    success(run('build', path.join(cold, '.ashfoxworkspace'))).bundleHash,
    first.bundleHash,
  );
  success(run('check', path.join(project, 'dist/build')));
  const current = path.join(project, 'dist/build/current.json'),
    pointer = fs.readFileSync(current);
  assert.equal(
    success(run('build', config, { ...process.env, PATH: '' })).bundleHash,
    first.bundleHash,
    'Built-in WASM Vorbis must succeed deterministically without external PATH tools',
  );
  assert.deepEqual(fs.readFileSync(current), pointer);
  const invalid = structuredClone(original);
  invalid.packs[0].sounds[0].variants = [{ id: 'missing', weight: 1 }];
  write(invalid);
  assert.equal(run('check').ok, false);
  assert.equal(run('build').ok, false);
  assert.deepEqual(fs.readFileSync(current), pointer);
  write(original);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() => createVorbisEncoder(aborted.signal), /Encoding cancelled/);
  assert.deepEqual(fs.readFileSync(current), pointer);
  assert.equal(fs.existsSync(path.join(project, 'dist/pack/.writer')), false);
  const selected = structuredClone(original);
  const variant = event.sounds[0].name.split('/').at(-1);
  selected.packs[0].sounds[0].variants = [{ id: variant, weight: 3 }];
  selected.packs[0].sounds[0].volume = 0.5;
  selected.packs[0].sounds[0].pitch = 1.2;
  selected.packs[0].sounds[0].stream = true;
  selected.packs[0].sounds[0].subtitle = 'demo.subtitle.hit';
  write(selected);
  const second = success(run('build')).exports.find((e: { id: string }) => e.id === 'game_pack');
  const settings = JSON.parse(
    String(fs.readFileSync(path.join(second.directory, 'resource-pack/assets/demo/sounds.json'))),
  )['combat.claw_hit'];
  assert.equal(settings.sounds.length, 1);
  assert.equal(settings.sounds[0].weight, 3);
  assert.equal(settings.sounds[0].volume, 0.5);
  assert.equal(settings.sounds[0].pitch, 1.2);
  assert.equal(settings.sounds[0].stream, true);
  assert.equal(settings.subtitle, 'demo.subtitle.hit');
  selected.packs.push({
    name: 'engine',
    format: 'game_assets',
    directory: 'dist/engine',
    archive: false,
    audio: 'ogg',
    unitsPerMeter: 1,
    pixelsPerUnit: 16,
    spriteFilter: 'nearest',
    assets: [{ id: 'sound.hit', source: 'claw_hit', path: 'audio/hit' }],
  });
  write(selected);
  const engine = success(run('build')).exports.find((e: { id: string }) => e.id === 'engine');
  const manifest = JSON.parse(
    String(fs.readFileSync(path.join(engine.directory, 'game-assets/assets.json'))),
  );
  assert.equal(manifest.assets[0].codec, 'ogg');
  assert.equal(manifest.assets[0].variants.length, 2);
  for (const v of manifest.assets[0].variants)
    assert.equal(
      fs.readFileSync(path.join(engine.directory, 'game-assets', v.file)).toString('ascii', 0, 4),
      'OggS',
    );
  success(run('check', path.join(project, 'dist/build')));
  console.log(
    'audio packs: real WASM Vorbis decode, exact references, cold reproducibility, variant settings, empty PATH build and abort handling ok',
  );
};
main()
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
