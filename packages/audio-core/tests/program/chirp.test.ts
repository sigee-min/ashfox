import assert from 'node:assert/strict';
import { readRecipe, render, compileSoundSource, type SoundRecipe } from '../../src';
import { fixture, native } from './fixture';
const base = fixture();
const bird: SoundRecipe = { ...base, voices: [{ ...base.voices[0], source: { kind: 'chirp', pitch: { domain: 'log', interpolation: 'smooth', points: [
  { at: 0, value: 2000 }, { at: .5, value: 5000 }, { at: 1, value: 2500 }
] }, trillHz: 0, trillCents: 0, trillDepth: 0, breath: 0, jitterCents: 0, brightness: 0 } }] };
const pcm = render(bird);
const pitchAt = (time: number) => {
  const begin = Math.round((time - .02) * 48000), end = Math.round((time + .02) * 48000); let crossings = 0;
  for (let i = begin; i < end; i++) if (pcm[i] <= 0 && pcm[i + 1] > 0) crossings++;
  return crossings / .04;
};
assert.ok(pitchAt(.48) > 4800 && pitchAt(.48) < 5100);
assert.ok(pitchAt(.1) < 2400 && pitchAt(.9) < 2900);
assert.equal(pcm[0], 0); assert.equal(pcm[pcm.length - 1], 0);
const source = bird.voices[0].source;
assert.throws(() => readRecipe({ ...bird, voices: [{ ...bird.voices[0], source: { ...source, contour: [] } }] }), /contour/);
if (source.kind !== 'chirp') throw new Error('fixture');
const wet = { ...bird, voices: [{ ...bird.voices[0], source: { ...source, jitterCents: 40, breath: .02 } }] };
const variants = compileSoundSource(native(wet), 'bird.ashfox');
assert.notDeepEqual(variants[0].wav, variants[1].wav);
process.stdout.write('chirp: common pitch bends, zero edges, hardcut contour, tonal variants passed\n');
