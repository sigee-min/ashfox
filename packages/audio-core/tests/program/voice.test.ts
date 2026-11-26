import assert from 'node:assert/strict';
import type { VocalSource } from '../../src/contract';
import { random } from '../../src/random';
import { createVoice } from '../../src/voice';

const RATE = 48000;

const renderVoice = (source: VocalSource, frames: number, seed = 901): Float64Array => {
  const r1 = random(seed);
  const r2 = random(seed + 1);
  const synth = createVoice(
    source,
    RATE,
    1,
    () => r1() * 2 - 1,
    () => r2() * 2 - 1,
  );
  const out = new Float64Array(frames);
  const inv = 1 / Math.max(1, frames - 1);
  for (let i = 0; i < frames; i++) out[i] = synth(i * inv);
  return out;
};

const goertzelPower = (pcm: Float64Array, hz: number, start = 0): number => {
  const omega = (2 * Math.PI * hz) / RATE;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let i = start; i < pcm.length; i++) {
    const s0 = pcm[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return power / Math.max(1, pcm.length - start);
};

// 1. 3-formant and 4-formant dynamic Control morphing differs over time.
for (const count of [3, 4] as const) {
  const staticFormants = count === 3 ? [450, 1400, 2600] : [450, 1400, 2600, 3400];
  const dynamicFormants = [
    {
      domain: 'log' as const,
      interpolation: 'linear' as const,
      points: [
        { at: 0, value: 450 },
        { at: 1, value: 850 },
      ],
    },
    {
      domain: 'log' as const,
      interpolation: 'linear' as const,
      points: [
        { at: 0, value: 1400 },
        { at: 1, value: 950 },
      ],
    },
    ...staticFormants.slice(2),
  ];
  const bandwidths = count === 3 ? [90, 140, 220] : [90, 140, 220, 280];
  const steady = renderVoice(
    { kind: 'vocal', pitch: 180, formants: staticFormants, bandwidths },
    24000,
  );
  const morphed = renderVoice(
    { kind: 'vocal', pitch: 180, formants: dynamicFormants, bandwidths },
    24000,
  );
  let lateDiff = 0;
  for (let i = 12000; i < 24000; i++) lateDiff += Math.abs(steady[i]! - morphed[i]!);
  assert.ok(lateDiff / 12000 > 1e-3, `${count}-formant dynamic morphing did not diverge`);
}

// 2. Growl adds subharmonic (f0 / 2) energy.
const clean = renderVoice(
  { kind: 'vocal', pitch: 200, formants: [450, 1300, 2500], bandwidths: [90, 150, 220], growl: 0 },
  24000,
);
const growled = renderVoice(
  {
    kind: 'vocal',
    pitch: 200,
    formants: [450, 1300, 2500],
    bandwidths: [90, 150, 220],
    growl: 0.9,
  },
  24000,
);
assert.ok(
  goertzelPower(growled, 100, 2400) > goertzelPower(clean, 100, 2400) * 5,
  'growl should strongly boost f0/2 subharmonic energy',
);

// 3. Chest boosts low-body energy around 140 Hz.
const noChest = renderVoice(
  { kind: 'vocal', pitch: 140, formants: [650, 1600, 2700], bandwidths: [100, 160, 220], chest: 0 },
  24000,
);
const fullChest = renderVoice(
  { kind: 'vocal', pitch: 140, formants: [650, 1600, 2700], bandwidths: [100, 160, 220], chest: 1 },
  24000,
);
assert.ok(
  goertzelPower(fullChest, 140, 2400) > goertzelPower(noChest, 140, 2400) * 1.5,
  'chest should boost 140 Hz low-body resonance',
);

// 4. Nasal modifies mid band (1050 Hz buzz vs 2500 Hz antiresonance notch).
const oral = renderVoice(
  {
    kind: 'vocal',
    pitch: 150,
    formants: [500, 1050, 2500, 3500],
    bandwidths: [90, 130, 180, 260],
    nasal: 0,
  },
  24000,
);
const nasalized = renderVoice(
  {
    kind: 'vocal',
    pitch: 150,
    formants: [500, 1050, 2500, 3500],
    bandwidths: [90, 130, 180, 260],
    nasal: 0.9,
  },
  24000,
);
const oralRatio = goertzelPower(oral, 1050, 2400) / goertzelPower(oral, 2500, 2400);
const nasalRatio = goertzelPower(nasalized, 1050, 2400) / goertzelPower(nasalized, 2500, 2400);
assert.ok(
  nasalRatio > oralRatio * 1.5,
  `expected nasal mid-band shift (${nasalRatio} vs ${oralRatio})`,
);

process.stdout.write(
  'voice: 3/4-formant dynamic morphing, growl subharmonics, chest body, and nasal band passed\n',
);
