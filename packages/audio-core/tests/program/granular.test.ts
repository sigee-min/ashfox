import assert from 'node:assert/strict';
import { GRANULAR_TEXTURES, compileSoundRecipe, readRecipe, type GranularSource } from '../../src';
import { createGranular } from '../../src/granular';
import { random } from '../../src/random';
import { measure } from '../../src/render';
import { fixture } from './fixture';

const RATE = 48000;

const renderGranular = (source: GranularSource, frames: number, seed: number): Float64Array => {
  const synth = createGranular(source, RATE, frames, 1, random(seed), random(seed + 1));
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) out[i] = synth(i);
  return out;
};

const zeroCrossingRate = (pcm: Float64Array): number => {
  let crossings = 0;
  for (let i = 1; i < pcm.length; i++) {
    if ((pcm[i - 1]! >= 0 && pcm[i]! < 0) || (pcm[i - 1]! < 0 && pcm[i]! >= 0)) crossings++;
  }
  return crossings / pcm.length;
};

const windowRmsStats = (
  pcm: Float64Array,
  windowFrames: number,
): { readonly std: number; readonly p95: number } => {
  const values: number[] = [];
  for (let start = 0; start + windowFrames <= pcm.length; start += windowFrames) {
    let sq = 0;
    for (let j = 0; j < windowFrames; j++) sq += pcm[start + j]! ** 2;
    values.push(Math.sqrt(sq / windowFrames));
  }
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  return { std: Math.sqrt(variance), p95: sorted[Math.floor(sorted.length * 0.95)]! };
};

// 1. All 7 GranularTextures produce finite non-silent output.
for (const texture of GRANULAR_TEXTURES) {
  const pcm = renderGranular({ kind: 'granular', texture, density: 80 }, RATE, 701);
  const stats = measure(pcm);
  assert.ok(stats.peak > 1e-4, `${texture} peak too low: ${stats.peak}`);
  assert.ok(stats.rms > 1e-5, `${texture} rms too low: ${stats.rms}`);
}

// 2. Ember & bubble produce distinct acoustic profiles.
const ember = renderGranular({ kind: 'granular', texture: 'ember', density: 90 }, RATE, 702);
const bubble = renderGranular({ kind: 'granular', texture: 'bubble', density: 90 }, RATE, 702);
assert.ok(
  Math.abs(zeroCrossingRate(ember) - zeroCrossingRate(bubble)) > 0.02,
  'ember and bubble should differ distinctly in zero-crossing rate',
);

// 3. Burstiness clusters grains into sparser, higher-variance bursts.
const uniform = renderGranular(
  { kind: 'granular', texture: 'spark', density: 20, grainMs: 8, burstiness: 0, turbulence: 0 },
  RATE * 2,
  703,
);
const bursty = renderGranular(
  { kind: 'granular', texture: 'spark', density: 20, grainMs: 8, burstiness: 0.95, turbulence: 0 },
  RATE * 2,
  703,
);
assert.notDeepEqual(uniform, bursty);
const uniformStats = windowRmsStats(uniform, 2400);
const burstyStats = windowRmsStats(bursty, 2400);
assert.ok(
  burstyStats.std > uniformStats.std && burstyStats.p95 > uniformStats.p95,
  'burstiness should increase burst-window RMS spread and 95th-percentile peaks',
);

// 4. Turbulence modulates density and pitch over time.
const calm = renderGranular(
  { kind: 'granular', texture: 'wind', density: 90, turbulence: 0 },
  RATE,
  704,
);
const turbulent = renderGranular(
  { kind: 'granular', texture: 'wind', density: 90, turbulence: 1 },
  RATE,
  704,
);
assert.notDeepEqual(calm, turbulent);

// 5. Pitch optionality: omitted pitch requires zero pitch variation; curve pitch works when supplied.
const base = fixture();
const noPitchRecipe = {
  ...base,
  voices: [
    {
      ...base.voices[0],
      source: { kind: 'granular' as const, texture: 'ember' as const, density: 60 },
    },
  ],
};
assert.ok(compileSoundRecipe(noPitchRecipe)[0]!.rms > 0);
assert.throws(
  () =>
    readRecipe({
      ...noPitchRecipe,
      sequences: [
        {
          ...base.sequences[0],
          steps: [{ ...base.sequences[0].steps[0], pitchCents: 100 }],
        },
      ],
    }),
  /zero pitch variation/,
);

const pitchedRecipe = {
  ...base,
  voices: [
    {
      ...base.voices[0],
      source: {
        kind: 'granular' as const,
        texture: 'bubble' as const,
        density: 70,
        pitch: {
          domain: 'log' as const,
          interpolation: 'smooth' as const,
          points: [
            { at: 0, value: 240 },
            { at: 1, value: 960 },
          ],
        },
      },
    },
  ],
  sequences: [
    {
      ...base.sequences[0],
      steps: [{ ...base.sequences[0].steps[0], pitchCents: 100 }],
    },
  ],
};
assert.ok(compileSoundRecipe(pitchedRecipe)[0]!.rms > 0);

const flatPitch = renderGranular(
  { kind: 'granular', texture: 'bubble', density: 80, pitch: 300 },
  RATE,
  705,
);
const curvePitch = renderGranular(
  {
    kind: 'granular',
    texture: 'bubble',
    density: 80,
    pitch: {
      domain: 'log',
      interpolation: 'linear',
      points: [
        { at: 0, value: 300 },
        { at: 1, value: 1800 },
      ],
    },
  },
  RATE,
  705,
);
assert.notDeepEqual(flatPitch.slice(24000), curvePitch.slice(24000));

process.stdout.write(
  `granular: all ${GRANULAR_TEXTURES.length} textures, burstiness clustering, turbulence, and pitch optionality passed\n`,
);
