import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileSoundSource, parseSoundSource, readRecipe, render, measure } from '../../src';

const file = path.resolve(__dirname, '../../../../examples/sounds/src/bird_call.ashfox');
const text = fs.readFileSync(file, 'utf8');
const bird = parseSoundSource(text, file);
const layer = bird.layers[0];
if (layer.source.kind !== 'chirp') throw new Error('Bird example must use chirp synthesis');
const source = layer.source;
const recipeWith = (changed: unknown) => ({ ...bird, layers: [{ ...layer, source: changed }] });
for (const [changed, expected] of [
  [{ ...source, version: 1 }, /source.version/],
  [{ ...source, extra: 1 }, /source.extra/],
  [{ ...source, contour: [{ at: 0, hz: 2000 }] }, /contour/],
  [{ ...source, contour: [{ at: .1, hz: 2000 }, { at: 1, hz: 3000 }] }, /contour\[0\].at/],
  [{ ...source, contour: [{ at: 0, hz: 2000 }, { at: .8, hz: 3000 }] }, /contour\[1\].at/],
  [{ ...source, contour: [{ at: 0, hz: 2000 }, { at: 0, hz: 3000 }, { at: 1, hz: 4000 }] }, /strictly increase/],
  [{ ...source, contour: [{ at: 0, hz: 9000 }, { at: 1, hz: 3000 }] }, /contour\[0\].hz/],
  [{ ...source, contour: [{ at: 0, hz: 2000, extra: 1 }, { at: 1, hz: 3000 }] }, /extra/],
  [{ ...source, trillHz: 101 }, /trillHz/],
  [{ ...source, breath: .3 }, /breath/],
  [{ ...source, jitterCents: NaN }, /jitterCents/]
] as const) assert.throws(() => readRecipe(recipeWith(changed)), expected);
assert.ok(Object.isFrozen(readRecipe(bird).layers[0].source));

// With modulation disabled, independent zero crossings recover the rising
// and falling pitch contour rather than a fixed tone or a linear sweep.
const controlled = readRecipe({ ...bird, duration: 1, layers: [{ ...layer, start: 0, duration: 1,
  source: { ...source, contour: [{ at: 0, hz: 2000 }, { at: .5, hz: 5000 }, { at: 1, hz: 2500 }],
    breath: 0, jitterCents: 0, brightness: 0, trillHz: 0, trillCents: 0, trillDepth: 0 } }] });
const pcm = render(controlled);
const pitchAt = (time: number) => {
  const begin = Math.round((time - .02) * 48000), end = Math.round((time + .02) * 48000);
  let crossings = 0;
  for (let i = begin; i < end; i++) if (pcm[i] <= 0 && pcm[i + 1] > 0) crossings++;
  return crossings / .04;
};
assert.ok(pitchAt(.48) > 4800 && pitchAt(.48) < 5100);
assert.ok(pitchAt(.1) < 2400 && pitchAt(.9) < 2900);
assert.equal(pcm[0], 0);
assert.equal(pcm[pcm.length - 1], 0);
const boundary = readRecipe(recipeWith({ ...source, contour: [{ at: 0, hz: 8000 }, { at: 1, hz: 8000 }],
  brightness: 1, jitterCents: 80, trillCents: 300, trillHz: 100 }));
assert.ok(Number.isFinite(measure(render(boundary)).peak));

const products = compileSoundSource(text, file);
assert.equal(products.length, 2);
assert.equal(products[0].frames, 4 * 48000);
assert.notDeepEqual(products[0].wav, products[1].wav);
// Variants vary the whistle itself, not just an added noise track.
const dry = text.replaceAll('breath = 0.009;', 'breath = 0;');
const dryProducts = compileSoundSource(dry, file);
assert.notDeepEqual(dryProducts[0].wav, dryProducts[1].wav);
for (const product of products) {
  assert.ok(product.peak <= 10 ** (-6 / 20) + 1e-8);
  assert.ok(Math.abs(product.dc) < .0001);
  const bytes = Buffer.from(product.wav);
  const sample = (time: number) => bytes.readInt16LE(44 + Math.round(time * 48000) * 2);
  assert.equal(sample(.05), 0);
  assert.equal(sample(1.85), 0, 'The two phrases need a real breathing gap');
  assert.equal(sample(3.9), 0);
}
process.stdout.write('chirp: closed contour, audible pitch bends, silent edges, phrase gaps, deterministic tonal variants and peak ceiling passed\n');
