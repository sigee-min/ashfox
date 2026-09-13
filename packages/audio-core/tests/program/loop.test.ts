import assert from 'node:assert/strict';
import { bakeLoop } from '../../src/loop';
import { compileSoundSource, readRecipe } from '../../src';
import { fixture, native } from './fixture';
const input = Float64Array.from({ length: 20 }, (_, i) => i);
const output = bakeLoop(input, { kind: 'loop', start: 2 / 48000, end: 18 / 48000, crossfade: 4 / 48000 });
assert.deepEqual([...output.slice(0, 8)], [6, 7, 8, 9, 10, 11, 12, 13]);
assert.equal(output[8], 14); assert.equal(output[11], 5);
assert.ok(Math.abs(output[9] - (15 * 20 / 27 + 3 * 7 / 27)) < 1e-12);
const base = fixture();
const loop = { ...base, duration: 5, sequences: [{ ...base.sequences[0], steps: [{ ...base.sequences[0].steps[0], duration: 5 }] }],
  voices: [{ ...base.voices[0], gain: .5 }], playback: { kind: 'loop' as const, start: .4, end: 4.4, crossfade: .08 } };
const products = compileSoundSource(native(loop), 'loop.ashfox');
for (const p of products) { assert.equal(p.frames, 188160); assert.equal(p.rawFrames, 240000); assert.deepEqual(p.playback, { kind: 'loop', startFrame: 0, endFrame: 188160 }); }
assert.throws(() => readRecipe({ ...loop, playback: { ...loop.playback, crossfade: 0 } }), /crossfade/);
assert.throws(() => readRecipe({ ...loop, sequences: [{ ...loop.sequences[0], start: 1, steps: [{ ...base.sequences[0].steps[0], duration: 1 }] }] }), /zero endpoint/);
assert.deepEqual(bakeLoop(new Float64Array(4800).fill(.5), { kind: 'loop', start: 0, end: .1, crossfade: .002 }), new Float64Array(4704).fill(.5));
process.stdout.write('loop: exact vector/origin, correlated gain, output frame count/playback and internal envelopes passed\n');
