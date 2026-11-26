import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileSoundSource, type SoundVoice } from '../../src';
import { fixture, native } from './fixture';

const cases: readonly SoundVoice['source'][] = [
  { kind: 'noise', color: 'pink' },
  { kind: 'granular', texture: 'ember', density: 45, burstiness: 0.4, turbulence: 0.35 },
  { kind: 'osc', waveform: 'saw', pitch: 220, unison: 3, detuneCents: 14 },
  {
    kind: 'vocal',
    pitch: 220,
    vowels: 'oo -> aa -> uh',
    breath: 0.1,
    jitter: 0.1,
    roughness: 0.2,
    growl: 0.3,
    chest: 0.4,
    nasal: 0.2,
    rattle: 0.3,
  },
  {
    kind: 'chirp',
    pitch: 2000,
    trillHz: 20,
    trillCents: 100,
    trillDepth: 0.1,
    breath: 0.01,
    jitterCents: 20,
    brightness: 0.5,
  },
  {
    kind: 'material',
    material: 'bronze',
    pitch: 320,
    size: 1.2,
    hardness: 0.7,
    damping: 0.25,
    brightness: 0.7,
    strike: 'bounce',
    bounces: 3,
    twinBeat: 0.5,
    splash: 0.35,
    stereoSpread: 0.6,
  },
  {
    kind: 'whoosh',
    velocity: {
      domain: 'linear',
      interpolation: 'linear',
      points: [
        { at: 0, value: 0.3 },
        { at: 0.5, value: 2.2 },
        { at: 1, value: 0.3 },
      ],
    },
    thickness: 0.25,
    doppler: 0.7,
    noiseTone: 0.6,
  },
  {
    kind: 'waveguide',
    model: 'string',
    pitch: 240,
    damping: 0.25,
    stiffness: 0.2,
    brightness: 0.7,
  },
];

for (const source of cases) {
  const base = fixture();
  const recipe = {
    ...base,
    channels: 2 as const,
    voices: [{ ...base.voices[0], source }],
    playback: { kind: 'loop' as const, start: 0.1, end: 0.9, crossfade: 0.02 },
    output: { ...base.output, limit: true },
  };
  const first = compileSoundSource(native(recipe), 'golden.ashfox')[0]!;
  const second = compileSoundSource(native(recipe), 'golden.ashfox')[0]!;
  assert.equal(first.channels, 2);
  assert.equal(first.frames, 37440);
  assert.equal(
    createHash('sha256').update(first.wav).digest('hex'),
    createHash('sha256').update(second.wav).digest('hex'),
  );
}

process.stdout.write(
  'golden: noise/granular/osc/vocal/chirp/material/whoosh/waveguide stereo loop PCM deterministic across audio\n',
);
