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
    formants: [
      {
        domain: 'log',
        interpolation: 'smooth',
        points: [
          { at: 0, value: 420 },
          { at: 1, value: 650 },
        ],
      },
      1200,
      2600,
      3400,
    ],
    bandwidths: [90, 140, 220, 280],
    breath: 0.1,
    jitter: 0.1,
    roughness: 0.2,
    growl: 0.3,
    chest: 0.4,
    nasal: 0.2,
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
    kind: 'resonator',
    excitation: { kind: 'mallet', duration: 0.008, hardness: 0.7 },
    modes: [
      { id: 'body', hz: 640, decay: 0.45, gain: 1 },
      { id: 'edge', hz: 1730, decay: 0.22, gain: 0.35 },
    ],
    pitchDropCents: 80,
    pitchDropSeconds: 0.03,
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
  },
];

for (const source of cases) {
  const base = fixture();
  const recipe = {
    ...base,
    voices: [{ ...base.voices[0], source }],
    playback: { kind: 'loop' as const, start: 0.1, end: 0.9, crossfade: 0.02 },
    output: { ...base.output, limit: true },
  };
  const first = compileSoundSource(native(recipe), 'golden.ashfox')[0]!;
  const second = compileSoundSource(native(recipe), 'golden.ashfox')[0]!;
  assert.equal(first.frames, 37440);
  assert.equal(
    createHash('sha256').update(first.wav).digest('hex'),
    createHash('sha256').update(second.wav).digest('hex'),
  );
}

process.stdout.write(
  'golden: noise/granular/osc/vocal/chirp/resonator/material loop PCM bytes deterministic across Audio 2.0 sources\n',
);
