'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');
const { unzipSync } = require('fflate');
const root = path.resolve(__dirname, '../..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-packaudio-'));
const project = path.join(temp, 'project'), config = path.join(project, '.ashfoxworkspace');
const executable = path.join(__dirname, 'dist/ashfox.cjs');
const encoder = process.env.ASHFOX_FFMPEG_PATH || 'ffmpeg';
fs.cpSync(path.join(root, 'examples/resource-pack'), project, { recursive: true, filter: p => !p.split(path.sep).includes('dist') });
const original = JSON.parse(fs.readFileSync(config, 'utf8'));
const run = (command, input = config, env = process.env) => {
  const child = spawnSync(process.execPath, [executable, command, input, '--json'], { encoding: 'utf8', timeout: 120000, env });
  if (child.error) throw child.error;
  assert.equal(child.signal, null, child.stderr); return JSON.parse(child.stdout);
};
const success = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };
const write = value => fs.writeFileSync(config, JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const main = async () => {
  const first = success(run('build'));
  const pack = first.exports.find(e => e.id === 'game_pack'), files = unzipSync(fs.readFileSync(path.join(pack.directory, 'game_pack.zip')));
  const definitions = JSON.parse(Buffer.from(files['assets/demo/sounds.json']).toString());
  const event = definitions['combat.claw_hit']; assert.equal(event.replace, true); assert.equal(event.sounds.length, 2);
  for (const sound of event.sounds) {
    const [namespace, name] = sound.name.split(':');
    const ogg = files[`assets/${namespace}/sounds/${name}.ogg`];
    assert.equal(Buffer.from(ogg.subarray(0, 4)).toString(), 'OggS');
    const decoded = spawnSync(encoder, ['-v','error','-i','pipe:0','-f','f32le','-ac','1','-ar','48000','pipe:1'], { input: ogg, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(decoded.status, 0, String(decoded.stderr)); assert.ok(decoded.stdout.length > 0);
    for (let i = 0; i < decoded.stdout.length; i += 4) assert.ok(Math.abs(decoded.stdout.readFloatLE(i)) < 1);
  }
  assert.equal(success(run('build')).bundleHash, first.bundleHash, 'OGG serial and ZIP timestamps must be deterministic');
  const cold = path.join(temp, 'cold'); fs.cpSync(project, cold, { recursive: true, filter: p => !p.split(path.sep).includes('dist') });
  assert.equal(success(run('build', path.join(cold, '.ashfoxworkspace'))).bundleHash, first.bundleHash);
  success(run('verify', path.join(project, 'dist/build')));
  const current = path.join(project, 'dist/build/current.json'), pointer = fs.readFileSync(current);
  assert.equal(run('build', config, { ...process.env, ASHFOX_FFMPEG_PATH: path.join(temp, 'missing') }).ok, false);
  assert.deepEqual(fs.readFileSync(current), pointer);
  const invalid = structuredClone(original); invalid.packs[0].sounds[0].variants = [{ id: 'missing', weight: 1 }]; write(invalid);
  assert.equal(run('check').ok, false); assert.equal(run('build').ok, false); assert.deepEqual(fs.readFileSync(current), pointer);
  write(original);
  // Hold a real encoder child open and cancel after it starts, proving cleanup.
  const stub = path.join(temp, 'encoder'), pidFile = path.join(temp, 'encoder.pid');
  fs.writeFileSync(stub, '#!' + process.execPath + '\n' +
    `if (process.argv.includes('-version')) { process.stdout.write('test-encoder'); } else { require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.stdin.resume(); setInterval(() => {}, 1000); }\n`);
  fs.chmodSync(stub, 0o755);
  const child = spawn(process.execPath, [executable, 'build', config, '--json'], { env: { ...process.env, ASHFOX_FFMPEG_PATH: stub } });
  let stdout = ''; child.stdout.on('data', d => { stdout += d; });
  const closed = new Promise(resolve => child.on('close', code => resolve(code)));
  for (let i = 0; i < 1000 && !fs.existsSync(pidFile); i++) await sleep(5);
  assert.ok(fs.existsSync(pidFile)); const pid = Number(fs.readFileSync(pidFile));
  child.kill('SIGINT'); assert.equal(await closed, 130); assert.equal(JSON.parse(stdout).ok, false);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.deepEqual(fs.readFileSync(current), pointer);
  assert.equal(fs.existsSync(path.join(project, 'dist/pack/.writer')), false);
  const selected = structuredClone(original);
  const variant = event.sounds[0].name.split('/').at(-1);
  selected.packs[0].sounds[0].variants = [{ id: variant, weight: 3 }];
  selected.packs[0].sounds[0].volume = 0.5; selected.packs[0].sounds[0].pitch = 1.2;
  selected.packs[0].sounds[0].stream = true; selected.packs[0].sounds[0].subtitle = 'demo.subtitle.hit'; write(selected);
  const second = success(run('build')).exports.find(e => e.id === 'game_pack');
  const settings = JSON.parse(fs.readFileSync(path.join(second.directory, 'resource-pack/assets/demo/sounds.json')))['combat.claw_hit'];
  assert.equal(settings.sounds.length, 1); assert.equal(settings.sounds[0].weight, 3);
  assert.equal(settings.sounds[0].volume, 0.5); assert.equal(settings.sounds[0].pitch, 1.2);
  assert.equal(settings.sounds[0].stream, true); assert.equal(settings.subtitle, 'demo.subtitle.hit');
  selected.packs.push({ name: 'engine', format: 'game_assets', directory: 'dist/engine', archive: false, audio: 'ogg',
    unitsPerMeter: 1, pixelsPerUnit: 16, spriteFilter: 'nearest',
    assets: [{ id: 'sound.hit', source: 'claw_hit', path: 'audio/hit' }] });
  write(selected);
  const engine = success(run('build')).exports.find(e => e.id === 'engine');
  const manifest = JSON.parse(fs.readFileSync(path.join(engine.directory, 'game-assets/assets.json')));
  assert.equal(manifest.assets[0].codec, 'ogg');
  assert.equal(manifest.assets[0].variants.length, 2);
  for (const v of manifest.assets[0].variants) assert.equal(fs.readFileSync(path.join(engine.directory, 'game-assets', v.file)).toString('ascii', 0, 4), 'OggS');
  success(run('verify', path.join(project, 'dist/build')));
  console.log('audio packs: real Vorbis decode, exact references, cold reproducibility, variant settings, missing encoder and child cancellation ok');
};
main().finally(() => fs.rmSync(temp, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
