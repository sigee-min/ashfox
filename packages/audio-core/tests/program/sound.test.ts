import assert from 'node:assert/strict';
import {
  compileSoundSource,
  parseSoundSource,
  readRecipe,
  render,
  master,
  encodeWav,
  measure,
} from '../../src';
import { fixture, native, envelope } from './fixture';

const recipe = fixture(),
  text = native(recipe),
  products = compileSoundSource(text, 'sound.ashfox');
assert.deepEqual(products, compileSoundSource(text, 'sound.ashfox'));
assert.deepEqual(products[0].wav, products[1].wav, 'unmodulated FM has no random behavior');

for (const product of products) {
  const b = Buffer.from(product.wav);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.readUInt32LE(40), product.frames * 2);
  assert.equal(product.rawFrames, 48000);
  assert.equal(product.channels, 1);
  assert.equal(product.profile, 'ui');
  assert.deepEqual(product.playback, { kind: 'oneshot' });
  const decoded = Float64Array.from(
    { length: product.frames },
    (_, i) => b.readInt16LE(44 + 2 * i) / 32767,
  );
  assert.deepEqual(measure(decoded), {
    peak: product.peak,
    rms: product.rms,
    dc: product.dc,
    seamDelta: product.seamDelta,
    maxAdjacentDelta: product.maxAdjacentDelta,
  });
}

assert.ok(Object.isFrozen(readRecipe(recipe).voices[0].source));
for (const key of ['format', 'version', 'layers'])
  assert.throws(() => readRecipe({ ...recipe, [key]: 1 }), /unknown field/);
assert.throws(() => readRecipe({ ...recipe, output: { rmsDb: -18, peakDb: -3 } }), /rmsDb/);
// Hard-cut: uncolored noise and missing profile must fail.
assert.throws(
  () => readRecipe({ ...recipe, voices: [{ ...recipe.voices[0], source: { kind: 'noise' } }] }),
  /color/,
);
assert.throws(() => {
  const { profile: _omit, ...noProfile } = recipe;
  readRecipe(noProfile);
}, /profile/);

for (const bad of [
  text.replace('duration = 1;', 'duration = NaN;'),
  text.replace('"oneshot"', 'oneshot'),
  text.replace('[', '('),
  text.replace('output = {', 'output {'),
])
  assert.throws(() => parseSoundSource(bad));

assert.throws(
  () => parseSoundSource(text.replace('highpass = 10;', 'highpass = 20000;'), 'owned.ashfox'),
  /owned.ashfox:\d+:\d+: sound.invalid: recipe.voices\[0\].highpass/,
);
assert.throws(() => parseSoundSource('ashfox-model 1 sound x { a = 1; a = 2; }'), /duplicate/);
assert.throws(() => encodeWav(new Float64Array([NaN])), /Non-finite/);
assert.throws(() => master(new Float64Array([0, 0]), recipe.output), /silent/);
assert.throws(() => master(new Float64Array([1, -1]), { gainDb: 0, peakDb: -3 }), /lower gainDb/);

const half = {
  ...recipe,
  sequences: [{ ...recipe.sequences[0], steps: [{ ...recipe.sequences[0].steps[0], gain: 0.5 }] }],
};
const fullPcm = master(render(recipe), recipe.output),
  halfPcm = master(render(half), recipe.output);
for (let i = 0; i < fullPcm.length; i++) assert.equal(halfPcm[i], fullPcm[i] * 0.5);

assert.throws(
  () =>
    compileSoundSource(
      native({
        ...recipe,
        voices: [{ ...recipe.voices[0], gain: envelope(0.000001) }],
        output: { gainDb: -24, peakDb: -3 },
      }),
      'tiny',
    ),
  /quantizes to silence/,
);

process.stdout.write(
  'sound v2: closed grammar, hard-cut legacy rejection, deterministic products, and gain/silence gates passed\n',
);
