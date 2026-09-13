'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execute, verifyBuild } = require('./harness');
const { openStore, hash, validate } = require('./storage');
const { encodeWav, AUDIO_POLICY } = require('./engine');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-harness-test-'));
const run = (r) => execute(root, r);
try {
  const curve = (a, b) => ({ domain: 'linear', interpolation: 'smooth', points: [{ at: 0, value: a }, { at: 1, value: b }] });
  const literal = (value) => Array.isArray(value) ? '[' + value.map(literal).join(', ') + ']' :
    value && typeof value === 'object' ? '{' + Object.entries(value).map(([key, item]) => key + '=' + literal(item) + ';').join('') + '}' : JSON.stringify(value);
  const heavy = (name) => 'ashfox-model 1\nsound ' + name + literal({
    duration: 30, sampleRate: 48000, seed: 42,
    voices: [{ id: 'tone', source: { kind: 'fm', pitch: curve(100, 200), ratio: 1, index: curve(0, 1), vibratoHz: 0, vibratoCents: 0 },
      gain: curve(0, 0), highpass: curve(20, 30), lowpass: curve(1000, 2000) }],
    sequences: [{ id: 'phrase', start: 0, repeat: { count: 1, period: 0 }, steps: [{
      id: 'note', voice: 'tone', at: 0, duration: 29.99, gain: 1, pitchCents: 0,
      vary: { timing: [0, 0], pitchCents: [0, 0], gain: [1, 1], duration: [1, 1] }
    }] }], variants: [{ id: 'base', seed: 42 }], playback: { kind: 'oneshot' }, output: { gainDb: -10, peakDb: -3 }
  });
  assert.equal(validate({ 'sounds/heavy_a.ashfox': heavy('heavy_a') }).length, 1);
  assert.throws(() => validate({ 'sounds/heavy_a.ashfox': heavy('heavy_a'), 'sounds/heavy_b.ashfox': heavy('heavy_b') }),
    (error) => error.code === 'source.budget' && /weightedFrames=382912320\/192000000/.test(error.message));
  assert.equal(validate(require('./harness').bootstrap()).length, 15);
  const source = fs.readFileSync(path.join(__dirname, '../../examples/sounds/src/bird_call.ashfox'), 'utf8');
  const files = { 'sounds/bird_call.ashfox': source };
  assert.equal(run({ op: 'inspect' }).head, null);
  const initial = run({ op: 'init', files });
  assert.throws(() => run({ op: 'init', files }), /already initialized/);
  assert.deepEqual(run({ op: 'inspect' }).files, files);
  assert.throws(() => run({ op: 'inspect', ignored: true }), /Expected exactly/);
  const edit = source.replace(/value = 2850/, 'value = 1800');
  assert.notEqual(edit, source, 'Pitch edit must change the source');
  const candidate = run({ op: 'propose', expectedHead: initial.id, writes: { 'sounds/bird_call.ashfox': edit }, deletes: [] });
  assert.deepEqual(run({ op: 'inspect' }).head, initial, 'Propose mutates head');
  assert.throws(() => run({ op: 'propose', expectedHead: '0'.repeat(64), writes: {}, deletes: [] }), /current source/);
  assert.throws(() => run({ op: 'propose', expectedHead: initial.id, writes: { '../escape.json': source }, deletes: [] }), /path/);
  assert.throws(() => run({ op: 'propose', expectedHead: initial.id, writes: {}, deletes: ['missing'] }), /Delete/);
  const bad = source.replace(/gainDb = -?[0-9]+/, 'gainDb = 100');
  assert.throws(() => run({ op: 'propose', expectedHead: initial.id, writes: { 'sounds/bird_call.ashfox': bad }, deletes: [] }), /expected/);
  assert.deepEqual(run({ op: 'inspect' }).head, initial, 'Invalid input mutates head');
  // A real PCM fixture isolates state transitions from the optional encoder installation.
  const bytes = Buffer.from(encodeWav(new Float64Array([0, .1, -.1, 0])));
  const receipt = { format: 'ashfox-audio-build', version: 1, sourceHash: candidate.source, dspHash: hash(AUDIO_POLICY), node: process.version, encoderVersion: 'test', entries: [{ sound: 'bird_call', variant: 'base', samples: 4, sampleRate: 48000, rawFrames: 4, seamDelta: 0, maxAdjacentDelta: .2, sourceHash: hash(edit), peak: .1, rms: .07, dc: 0, decodedPeak: .1, playback: { kind: 'oneshot' }, wav: 'bird_call/base.wav', ogg: 'bird_call/base.ogg', wavHash: hash(bytes), oggHash: hash(bytes) }] };
  const build = hash(receipt), dir = path.join(root, 'builds', build);
  fs.mkdirSync(path.join(dir, 'bird_call'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(receipt));
  fs.writeFileSync(path.join(dir, 'bird_call/base.wav'), bytes); fs.writeFileSync(path.join(dir, 'bird_call/base.ogg'), bytes);
  assert.throws(() => run({ op: 'review' }), /Unknown operation/);
  assert.throws(() => run({ op: 'adopt' }), /Unknown operation/);
  run({ op: 'present', candidate: candidate.candidate, build });
  assert.deepEqual(run({ op: 'inspect' }).head, initial);
  assert.throws(() => run({ op: 'apply', expectedHead: '0'.repeat(64), candidate: candidate.candidate, build }), /stale/);
  const head = run({ op: 'apply', expectedHead: initial.id, candidate: candidate.candidate, build });
  assert.notEqual(head.id, initial.id);
  assert.equal(head.source, candidate.source);
  assert.throws(() => run({ op: 'apply', expectedHead: initial.id, candidate: candidate.candidate, build }), /stale/);
  const exported = run({ op: 'export', head: head.id, build, target: 'audio-bundle' });
  assert.deepEqual(fs.readFileSync(path.join(exported.directory, 'bird_call/base.wav')), bytes);
  assert.throws(() => run({ op: 'export', head: initial.id, build, target: 'audio-bundle' }), /applied/);
  assert.equal(fs.readFileSync(path.join(exported.directory, 'source/sounds/bird_call.ashfox'), 'utf8'), edit);
  fs.writeFileSync(path.join(dir, 'bird_call/base.wav'), 'corrupt');
  assert.throws(() => verifyBuild(openStore(root), build), /mismatch/);
  assert.throws(() => run({ op: 'export', head: head.id, build, target: 'audio-bundle' }), /mismatch/);
  assert.deepEqual(openStore(root).head(), head, 'Failed export mutates head');
  console.log('Harness state: closed inputs, source inventory, candidate isolation, stale heads, presentation, application, exact export and corruption rejection passed.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
