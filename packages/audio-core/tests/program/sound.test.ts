import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileSoundSource, parseSoundSource, readRecipe, render, master, encodeWav, measure } from '../../src';
import { fixture, native, envelope } from './fixture';
const recipe = fixture(), text = native(recipe), products = compileSoundSource(text, 'sound.ashfox');
assert.equal(createHash('sha256').update(products[0].wav).digest('hex'), '768a666fd222391b007c21b5e7dc49115f6322ff87cbafce84c1b75e0b88552d', 'Node 24 PCM golden');
assert.deepEqual(products, compileSoundSource(text, 'sound.ashfox'));
assert.deepEqual(products[0].wav, products[1].wav, 'unmodulated FM has no random behavior');
for (const product of products) {
  const b = Buffer.from(product.wav);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.readUInt32LE(40), product.frames * 2);
  assert.equal(product.rawFrames, 48000); assert.deepEqual(product.playback, { kind: 'oneshot' });
  const decoded = Float64Array.from({ length: product.frames }, (_, i) => b.readInt16LE(44 + 2 * i) / 32767);
  assert.deepEqual(measure(decoded), { peak: product.peak, rms: product.rms, dc: product.dc, seamDelta: product.seamDelta, maxAdjacentDelta: product.maxAdjacentDelta });
}
assert.ok(Object.isFrozen(readRecipe(recipe).voices[0].source));
for (const key of ['format', 'version', 'layers']) assert.throws(() => readRecipe({ ...recipe, [key]: 1 }), /unknown field/);
assert.throws(() => readRecipe({ ...recipe, output: { rmsDb: -18, peakDb: -3 } }), /rmsDb/);
for (const bad of [text.replace('duration = 1;', 'duration = NaN;'), text.replace('"oneshot"', 'oneshot'), text.replace('[', '('), text.replace('output = {', 'output {')]) assert.throws(() => parseSoundSource(bad));
assert.throws(() => parseSoundSource(text.replace('highpass = 10;', 'highpass = 20000;'), 'owned.ashfox'), /owned.ashfox:\d+:\d+: sound.invalid: recipe.voices\[0\].highpass/);
assert.throws(() => parseSoundSource('ashfox-model 1 sound x { a = 1; a = 2; }'), /duplicate/);
assert.throws(() => encodeWav(new Float64Array([NaN])), /Non-finite/);
assert.throws(() => master(new Float64Array([0, 0]), recipe.output), /silent/);
assert.throws(() => master(new Float64Array([1, -1]), { gainDb: 0, peakDb: -3 }), /lower gainDb/);
const half = { ...recipe, sequences: [{ ...recipe.sequences[0], steps: [{ ...recipe.sequences[0].steps[0], gain: .5 }] }] };
const fullPcm = master(render(recipe), recipe.output), halfPcm = master(render(half), recipe.output);
for (let i = 0; i < fullPcm.length; i++) assert.equal(halfPcm[i], fullPcm[i] * .5);
assert.throws(() => compileSoundSource(native({ ...recipe, voices: [{ ...recipe.voices[0], gain: envelope(.000001) }], output: { gainDb: -24, peakDb: -3 } }), 'tiny'), /quantizes to silence/);
process.stdout.write('sound: closed grammar, deterministic products, decoded measurements, fixed gain and silence gates passed\n');
