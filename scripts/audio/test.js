'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readRecipe, render, measure, master, encodeWav, parseSoundSource, compileSoundSource } = require('./engine');
const decodeWav = (bytes) => { const b = Buffer.from(bytes); return Float64Array.from({ length: (b.length - 44) / 2 }, (_, i) => b.readInt16LE(44 + i * 2) / 32768); };
const read = (name) => parseSoundSource(fs.readFileSync(path.join(__dirname, `../../examples/sounds/src/${name}.ashfox`), 'utf8'), name + '.ashfox');
const recipe = read('griffin_call'), a = render(recipe);
assert.deepEqual(a, render(JSON.parse(JSON.stringify(recipe))), 'Repeated code build changes PCM');
assert.notDeepEqual(a, render({ ...recipe, seed: 43 }), 'Noise/jitter seed has no effect');
assert.equal(a.length, 96000);
assert.ok(a.subarray(0, 12000).every((v) => v === 0));
const edited = { ...recipe, layers: recipe.layers.map((l) => ({ ...l, start: l.start - .1, duration: l.duration - .15, release: .16 })) };
const moved = render(edited);
assert.deepEqual(moved.subarray(7200, 37200), a.subarray(12000, 42000), 'Timing-only edit changes early voice waveform');
const definitions = ['griffin_call', 'wing_whoosh', 'claw_hit'].map(read);
const matched = definitions.map((r) => master(render(r), r.output));
matched.forEach((pcm) => {
  const stat = measure(pcm);
  assert.ok(stat.peak <= 10 ** (-3 / 20) + 1e-12);
  assert.ok(stat.rms <= 10 ** (-22 / 20) + 1e-10);
  const encoded = Buffer.from(encodeWav(pcm)), decoded = decodeWav(encoded);
  assert.equal(decoded.length, pcm.length);
  assert.ok(decoded.every((v, i) => Math.abs(v - pcm[i]) < .00005));
  assert.equal(encoded.readUInt16LE(22), 1); assert.equal(encoded.readUInt32LE(24), 48000);
});
for (const mutate of [
  (r) => { r.version = 2; }, (r) => { r.extra = true; }, (r) => { delete r.seed; },
  (r) => { r.duration = Infinity; }, (r) => { r.duration = 100; }, (r) => { r.seed = 1.5; },
  (r) => { r.sampleRate = 44100; }, (r) => { r.layers = Array(9).fill(r.layers[0]); },
  (r) => { r.layers[0].source = { kind: 'sample', asset: 'raven' }; },
  (r) => { r.layers[0].source = { kind: 'spectral', asset: 'raven' }; },
  (r) => { r.layers[0].source = { kind: 'url', url: 'https://example.com/audio.wav' }; },
  (r) => { r.layers[0].source.formants = [NaN, 1000, 2000]; },
  (r) => { r.layers[0].source.bandwidths = [0, 100, 200]; },
  (r) => { r.layers[0].start = 1.9; }, (r) => { r.layers[0].gain = NaN; },
  (r) => { r.layers[0].attack = 1.29; }, (r) => { r.layers[0].lowpass = 20; }
]) { const input = structuredClone(recipe); mutate(input); assert.throws(() => render(input), /recipe/); }
assert.throws(() => master(new Float64Array(20), recipe.output), /silent/);
assert.deepEqual(a, render({ ...recipe, layers: [...recipe.layers].reverse() }), 'Layer reorder changes PCM');
const first = master(a, recipe.output);
render(read('bird_call'));
assert.deepEqual(first, master(render(recipe), recipe.output), 'Unrelated sound changes output');
assert.throws(() => encodeWav([NaN]), /PCM/); assert.throws(() => encodeWav([1.1]), /PCM/);
assert.ok(Object.isFrozen(readRecipe(recipe).layers[0].source.formants));
for (const name of fs.readdirSync(path.join(__dirname, '../../examples/sounds/src'))) {
  const source = fs.readFileSync(path.join(__dirname, '../../examples/sounds/src', name), 'utf8');
  const products = compileSoundSource(source, name);
  assert.deepEqual(products, compileSoundSource(source, name));
  if (name === 'griffin_call.ashfox') assert.notDeepEqual(products[0].wav, products[1].wav, 'Variant seeds collide');
  assert.throws(() => parseSoundSource(JSON.stringify(read('bird_call')), name));
  assert.throws(() => parseSoundSource(source.replace('duration =', 'unknown ='), name));
}
console.log('Native sound sources: deterministic compilation, distinct noise variants, bounds, timing and WAV verified.');
