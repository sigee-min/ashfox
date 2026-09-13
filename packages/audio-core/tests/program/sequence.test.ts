import assert from 'node:assert/strict';
import { readRecipe, render, type SoundRecipe } from '../../src';
import { schedule } from '../../src/schedule';
import { randomSeed, random, AUDIO_POLICY } from '../../src/random';
import { fixture } from './fixture';
const base = fixture();
for (const [domain, seed, draw] of [['timing', 526853703, 2388183440], ['pitch', 1740750544, 1399410045], ['excitation', 1326868862, 3305432098]] as const) {
  const actual = randomSeed([AUDIO_POLICY, 'bell_pattern', 7349, 'base', 42, 'phrase', 0, 'strike', 'bell', domain]);
  assert.equal(actual, seed); assert.equal(random(actual)() * 2 ** 32, draw);
}
const step = { ...base.sequences[0].steps[0], duration: .1, vary: { timing: [-.01, .01] as const, pitchCents: [-50, 50] as const, gain: [.8, 1.2] as const, duration: [.9, 1.1] as const } };
const repeated: SoundRecipe = { ...base, sequences: [{ id: 'phrase', start: .1, repeat: { count: 3, period: .2 }, steps: [step] }] };
const a = [...schedule(repeated, base.variants[0])];
const appended = { ...repeated, sequences: [{ ...repeated.sequences[0], repeat: { count: 4, period: .2 } }] };
const b = [...schedule(appended, base.variants[0])];
assert.deepEqual(a.map(e => [e.start, e.frames, e.gain, e.pitch]), b.slice(0, 3).map(e => [e.start, e.frames, e.gain, e.pitch]));
const gained = { ...repeated, sequences: [{ ...repeated.sequences[0], steps: [{ ...step, vary: { ...step.vary, gain: [.5, .6] as const } }] }] };
const c = [...schedule(gained, base.variants[0])];
assert.deepEqual(a.map(e => [e.start, e.frames, e.pitch]), c.map(e => [e.start, e.frames, e.pitch]));
const two = { ...repeated, sequences: [...repeated.sequences, { ...repeated.sequences[0], id: 'other' }] };
assert.deepEqual(render(two), render({ ...two, sequences: [...two.sequences].reverse(), variants: [...two.variants].reverse() }, two.variants[0]));
const invalid = (changes: object) => ({ ...base, ...changes });
assert.throws(() => readRecipe(invalid({ duration: .10001, sequences: [{ ...base.sequences[0], start: .0200105, steps: [{ ...step, duration: .0799995, vary: base.sequences[0].steps[0].vary }] }] })), /quantized support/);
assert.throws(() => readRecipe(invalid({ sequences: [{ ...repeated.sequences[0], start: 0 }] })), /support/);
assert.throws(() => readRecipe(invalid({ sequences: [{ ...repeated.sequences[0], repeat: { count: 64, period: .02 }, steps: Array.from({ length: 5 }, (_, i) => ({ ...step, id: `s${i}` })) }] })), /instance limit 256/);
assert.throws(() => readRecipe({ ...base, duration: 3, voices: [{ ...base.voices[0], id: 'tone' }], sequences: [{ id: 'phrase', start: .5, repeat: { count: 33, period: .03 }, steps: [{ ...step, duration: .02, vary: { ...step.vary, timing: [-.5, .5], duration: [1, 1] } }] }] }), /active instance limit/);
assert.throws(() => readRecipe({ ...base, sequences: [{ ...base.sequences[0], steps: [{ ...base.sequences[0].steps[0], pitchCents: 1200, vary: { ...base.sequences[0].steps[0].vary, pitchCents: [1200, 1200] } }] }], voices: [{ ...base.voices[0], source: { kind: 'noise' } }] }), /noise requires/);
process.stdout.write('sequence: domain goldens, repeat stability, isolated ranges, canonical mix, continuous/quantized support and resource limits passed\n');
