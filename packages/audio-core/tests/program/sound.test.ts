import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { encodeWav, parseSoundSource, compileSoundSource, soundVariantSeed } from '../../src';

const directory = path.resolve(__dirname, '../../../../examples/sounds/src');
const files = fs.readdirSync(directory).filter(f => f.endsWith('.ashfox'));
assert.equal(files.length, 6);
for (const file of files) {
  const source = fs.readFileSync(path.join(directory, file), 'utf8');
  const recipe = parseSoundSource(source, file);
  const products = compileSoundSource(source, file);
  assert.equal(products.length, recipe.variants.length);
  assert.deepEqual(compileSoundSource(source, file), products);
  for (const product of products) {
    const bytes = Buffer.from(product.wav);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 48000);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.readUInt32LE(40), product.frames * 2);
    const decoded = Float64Array.from({ length: product.frames }, (_, i) => bytes.readInt16LE(44 + i * 2) / 32768);
    assert.ok(decoded.some(v => v !== 0));
    assert.ok(decoded.every(v => Math.abs(v) <= 10 ** (recipe.output.peakDb / 20) + 1 / 32768));
  }
  const seeds = recipe.variants.map(v => soundVariantSeed(recipe.seed, v));
  assert.equal(new Set(seeds).size, seeds.length, 'Variant streams collide');
  if (recipe.layers.some(l => l.source.kind !== 'fm')) assert.notDeepEqual(products[0].wav, products[1].wav);
  else assert.deepEqual(products[0].wav, products[1].wav, 'Pure FM must not invent seed-dependent modulation');
  assert.throws(() => parseSoundSource(JSON.stringify(recipe), file), /expected ashfox-model/);
  assert.throws(() => parseSoundSource(source + '\n garbage', file), /trailing/);
  assert.throws(() => parseSoundSource(source.replace('duration =', 'unknown ='), file), /unknown field/);
}
assert.notEqual(soundVariantSeed(42, { id: 'base', seed: 42 }), soundVariantSeed(42, { id: 'alternate', seed: 43 }));
assert.throws(() => parseSoundSource('ashfox-model 1 sound x { a = 1; a = 2; }', 'test.ashfox'), /duplicate/);
assert.throws(() => encodeWav(new Float64Array([NaN])), /Non-finite/);
process.stdout.write('audio-core: six native sources, deterministic WAV, independent decoding, separated streams and closed grammar passed\n');
