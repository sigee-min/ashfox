'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseSoundSource, compileSoundSource } = require('./engine');
const directory = path.join(__dirname, '../../examples/sounds/src');
for (const name of fs.readdirSync(directory).filter((file) => file.endsWith('.ashfox'))) {
  const source = fs.readFileSync(path.join(directory, name), 'utf8');
  const recipe = parseSoundSource(source, name), products = compileSoundSource(source, name);
  assert.deepEqual(products, compileSoundSource(source, name), 'Native example is not deterministic');
  for (const product of products) {
    const wav = Buffer.from(product.wav);
    assert.equal(wav.length, 44 + product.frames * 2);
    assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt32LE(24), 48000);
    assert.ok(product.peak <= 10 ** (recipe.output.peakDb / 20));
    assert.ok(product.rms > 0);
    assert.equal(product.playback.kind, recipe.playback.kind);
    if (recipe.playback.kind === 'loop') {
      assert.deepEqual(product.playback, { kind: 'loop', startFrame: 0, endFrame: product.frames });
      assert.ok(product.frames < product.rawFrames);
    }
  }
  if (name === 'bell_pattern.ashfox') assert.equal(products[0].frames, 96960);
  if (name === 'wind_loop.ashfox') assert.equal(products[0].frames, 188160);
  assert.throws(() => parseSoundSource(source.replace('voices =', 'layers ='), name));
  assert.throws(() => parseSoundSource(source.replace('gainDb =', 'rmsDb ='), name));
}
console.log('Native sound corpus: deterministic curves, sequences, variation, resonance, loop frame metadata and hard-cut grammar verified.');
