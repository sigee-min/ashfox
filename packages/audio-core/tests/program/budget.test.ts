import assert from 'node:assert/strict';
import { readRecipe, parseSoundSource, soundBudget, type SoundRecipe } from '../../src';
import { fixture, native } from './fixture';
const base = fixture();
assert.deepEqual(soundBudget(base), { eventFrames: 96000, weightedFrames: 96000 * 129, outputFrames: 96000 });
for (const [key, value] of [['duration', 31], ['sampleRate', 44100], ['seed', 0], ['seed', 1.5], ['seed', NaN]] as const) assert.throws(() => readRecipe({ ...base, [key]: value }));
assert.throws(() => parseSoundSource(native(base) + ' '.repeat(262144)), /256 KiB/);
assert.throws(() => parseSoundSource('ashfox-model 1sound x {}'), /whitespace/);
assert.throws(() => readRecipe({ ...base, variants: [base.variants[0], base.variants[0]] }), /duplicate/);
assert.throws(() => readRecipe({ ...base, sequences: [{ ...base.sequences[0], steps: [{ ...base.sequences[0].steps[0], voice: 'missing' }] }] }), /unknown voice/);
const long: SoundRecipe = { ...base, duration: 30, variants: Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, seed: i + 1 })),
  sequences: [{ ...base.sequences[0], steps: Array.from({ length: 3 }, (_, i) => ({ ...base.sequences[0].steps[0], id: `s${i}`, duration: 30 })) }] };
assert.throws(() => readRecipe(long), /event frame budget/);
const expensive = { ...long, sequences: [{ ...long.sequences[0], steps: [long.sequences[0].steps[0]] }],
  voices: [{ ...base.voices[0], source: { kind: 'resonator', excitation: { kind: 'impulse' }, modes: Array.from({ length: 16 }, (_, i) => ({ id: `m${i}`, hz: 100 + i * 50, gain: 1, decay: 1 })) } }] };
assert.throws(() => readRecipe(expensive), /weighted DSP frame budget/);
const maximumCurve = { domain: 'linear', interpolation: 'linear', points: Array.from({ length: 16 }, (_, i) => ({ at: i / 15, value: i === 0 || i === 15 ? 0 : .5 })) };
const voices = Array.from({ length: 16 }, (_, i) => ({ ...base.voices[0], id: `v${i}`, gain: maximumCurve, highpass: { ...maximumCurve, points: maximumCurve.points.map(p => ({ ...p, value: 20 })) }, lowpass: { ...maximumCurve, points: maximumCurve.points.map(p => ({ ...p, value: 8000 })) }, source: { kind: 'fm', ratio: 1, vibratoHz: 0, vibratoCents: 0, index: maximumCurve, pitch: { ...maximumCurve, points: maximumCurve.points.map(p => ({ ...p, value: 440 })) } } }));
assert.throws(() => readRecipe({ ...base, voices, sequences: [{ ...base.sequences[0], steps: voices.map(v => ({ ...base.sequences[0].steps[0], id: v.id, voice: v.id })) }] }), /curve knot limit 1024/);
process.stdout.write('budget: closed bounds, identities, parser bytes, expanded work/event/curve budgets passed\n');
