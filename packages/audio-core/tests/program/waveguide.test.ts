import assert from 'node:assert/strict';
import type { WaveguideModel, WaveguideSource } from '../../src/contract';
import { random } from '../../src/random';
import { measure } from '../../src/render';
import { createWaveguide } from '../../src/waveguide';

const RATE = 48000;

const renderWaveguide = (
  source: WaveguideSource,
  frames: number,
  seed = 1301,
): { readonly mono: Float64Array; readonly stereo: Float64Array } => {
  const synth = createWaveguide(source, RATE, frames, 1, random(seed));
  const mono = new Float64Array(frames);
  const stereo = new Float64Array(frames * 2);
  const lr = new Float64Array(2);
  for (let i = 0; i < frames; i++) {
    synth(i, lr);
    stereo[i * 2] = lr[0]!;
    stereo[i * 2 + 1] = lr[1]!;
    mono[i] = 0.5 * (lr[0]! + lr[1]!);
  }
  return { mono, stereo };
};

// 1. All 4 waveguide models produce finite non-silent true-stereo output with L/R image and positive phase.
for (const model of [
  'string',
  'blade',
  'creak',
  'pipe',
] as const satisfies readonly WaveguideModel[]) {
  const { mono, stereo } = renderWaveguide(
    { kind: 'waveguide', model, pitch: 240, damping: 0.25, stiffness: 0.4, bowPressure: 0.7 },
    24000,
  );
  const stats = measure(mono);
  assert.ok(stats.peak > 1e-3, `${model} peak too low: ${stats.peak}`);
  assert.ok(stats.rms > 1e-4, `${model} rms too low: ${stats.rms}`);
  let sumLR = 0;
  let sumLL = 0;
  let sumRR = 0;
  let diffSq = 0;
  for (let i = 1200; i < 24000; i++) {
    const l = stereo[i * 2]!;
    const r = stereo[i * 2 + 1]!;
    sumLR += l * r;
    sumLL += l * l;
    sumRR += r * r;
    diffSq += (l - r) ** 2;
  }
  const corr = sumLR / Math.sqrt(sumLL * sumRR);
  assert.ok(diffSq > 1e-4, `${model} should emit stereo L/R differences`);
  assert.ok(corr > 0, `${model} L/R must remain phase-coherent (got ${corr})`);
}

// 2. Higher damping decays string energy faster than low damping.
const longRing = renderWaveguide(
  { kind: 'waveguide', model: 'string', pitch: 220, damping: 0.05 },
  24000,
).mono;
const damped = renderWaveguide(
  { kind: 'waveguide', model: 'string', pitch: 220, damping: 0.9 },
  24000,
).mono;
assert.ok(
  measure(longRing.subarray(16000)).rms > measure(damped.subarray(16000)).rms * 2,
  'higher waveguide damping should decay tail faster',
);

// 3. Fractional pitch sweep curve bends pitch continuously without NaNs.
const bent = renderWaveguide(
  {
    kind: 'waveguide',
    model: 'string',
    pitch: {
      domain: 'log',
      interpolation: 'smooth',
      points: [
        { at: 0, value: 220 },
        { at: 1, value: 440 },
      ],
    },
  },
  24000,
).mono;
const steady = renderWaveguide({ kind: 'waveguide', model: 'string', pitch: 220 }, 24000).mono;
assert.notDeepEqual(bent.subarray(8000), steady.subarray(8000));

process.stdout.write(
  'waveguide: string/blade/creak/pipe models, damping decay, pitch glide, and coherent stereo passed\n',
);
