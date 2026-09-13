import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileSoundSource, type SoundVoice } from '../../src';
import { fixture, native } from './fixture';
const cases: readonly (readonly [SoundVoice['source'], string])[] = [
  [{ kind: 'noise' }, '877d4f6c3cdb6654a2e6c97b60576a493ab637fcbb32461bbe25b887e83d0e24'],
  [{ kind: 'vocal', pitch: 220, formants: [500, 1500, 3000], bandwidths: [100, 200, 300], breath: .1, jitter: .1, roughness: .2 }, '6a3cab3782302df3aad063bb798e5ac96f97f1c8d0da29d6ddcf26c31764a1d9'],
  [{ kind: 'chirp', pitch: 2000, trillHz: 20, trillCents: 100, trillDepth: .1, breath: .01, jitterCents: 20, brightness: .5 }, 'c76473517f08f1073752fd18be562903b3f3d85a21fa6cf5c7b90daf30c93283'],
  [{ kind: 'resonator', excitation: { kind: 'noise', duration: .006 }, modes: [{ id: 'body', hz: 640, decay: .45, gain: 1 }, { id: 'edge', hz: 1730, decay: .22, gain: .35 }] }, '8170839557483314336a393e0429d3b813047b815176db1f99427753265ba898']
];
for (const [source, expected] of cases) {
  const base = fixture();
  const recipe = { ...base, voices: [{ ...base.voices[0], source }], playback: { kind: 'loop' as const, start: .1, end: .9, crossfade: .02 } };
  const product = compileSoundSource(native(recipe), 'golden.ashfox')[0];
  assert.equal(product.frames, 37440);
  const actual = createHash('sha256').update(product.wav).digest('hex');
  assert.equal(actual, expected, `${source.kind} Node 24 source+loop PCM golden`);
}
process.stdout.write('golden: noise/vocal/chirp/modal loop PCM bytes pinned for supported release platforms\n');
