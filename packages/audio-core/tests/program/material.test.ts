import assert from 'node:assert/strict';
import {
  MATERIAL_PRESETS,
  compileSoundRecipe,
  type MaterialPreset,
  type MaterialSource,
} from '../../src';
import { createMaterial } from '../../src/material';
import { random } from '../../src/random';
import { measure } from '../../src/render';
import { fixture } from './fixture';

const renderMaterialStereo = (
  source: MaterialSource,
  frames: number,
  seed: number,
): { readonly mono: Float64Array; readonly stereo: Float64Array } => {
  const synth = createMaterial(source, frames, 1, random(seed));
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

// 1. All 10 MaterialPresets produce finite non-silent output.
for (const material of MATERIAL_PRESETS) {
  const { mono } = renderMaterialStereo({ kind: 'material', material, pitch: 320 }, 12000, 101);
  const stats = measure(mono);
  assert.ok(stats.peak > 1e-4, `${material} peak too low: ${stats.peak}`);
  assert.ok(stats.rms > 1e-5, `${material} rms too low: ${stats.rms}`);
}

// 2. Strike modes: mallet, scrape, and bounce (bounces: 3 shows multiple energy bursts).
const mallet = renderMaterialStereo(
  { kind: 'material', material: 'steel', pitch: 440, strike: 'mallet', hardness: 0.7 },
  12000,
  202,
).mono;
const scrape = renderMaterialStereo(
  { kind: 'material', material: 'steel', pitch: 440, strike: 'scrape', hardness: 0.7 },
  12000,
  202,
).mono;
assert.ok(measure(scrape).rms > 1e-4);
assert.notDeepEqual(mallet, scrape);

const bounce = renderMaterialStereo(
  {
    kind: 'material',
    material: 'wood',
    pitch: 420,
    damping: 0.85,
    strike: 'bounce',
    bounces: 3,
  },
  24000,
  303,
).mono;
const chunkSize = 240;
const chunkRms: number[] = [];
for (let start = 0; start + chunkSize <= bounce.length; start += chunkSize) {
  let sq = 0;
  for (let j = 0; j < chunkSize; j++) sq += bounce[start + j]! ** 2;
  chunkRms.push(Math.sqrt(sq / chunkSize));
}
const maxChunk = Math.max(...chunkRms);
let burstCount = 0;
let armed = true;
for (const level of chunkRms) {
  if (armed && level >= maxChunk * 0.08) {
    burstCount++;
    armed = false;
  } else if (!armed && level < maxChunk * 0.03) {
    armed = true;
  }
}
assert.ok(burstCount >= 3, `expected >= 3 distinct bounce bursts, got ${burstCount}`);

// 3. Curved pitch modulation differs from constant pitch.
const flat = renderMaterialStereo(
  { kind: 'material', material: 'glass', pitch: 300 },
  12000,
  404,
).mono;
const curved = renderMaterialStereo(
  {
    kind: 'material',
    material: 'glass',
    pitch: {
      domain: 'log',
      interpolation: 'smooth',
      points: [
        { at: 0, value: 300 },
        { at: 1, value: 900 },
      ],
    },
  },
  12000,
  404,
).mono;
assert.notDeepEqual(flat.slice(2400), curved.slice(2400));

// 4. Material dispersion features: twinBeat, splash, and stereoSpread dispersion produce L/R variation & shimmer.
const dryBell = renderMaterialStereo(
  { kind: 'material', material: 'bell', pitch: 520, twinBeat: 0, splash: 0, stereoSpread: 0 },
  16000,
  505,
);
const richBell = renderMaterialStereo(
  { kind: 'material', material: 'bell', pitch: 520, twinBeat: 0.8, splash: 0.7, stereoSpread: 0.8 },
  16000,
  505,
);
assert.notDeepEqual(dryBell.mono, richBell.mono);
let lrDiff = 0;
for (let i = 0; i < 16000; i++)
  lrDiff += Math.abs(richBell.stereo[i * 2]! - richBell.stereo[i * 2 + 1]!);
assert.ok(lrDiff / 16000 > 1e-3, 'stereoSpread should disperse modes across L/R');

// 5. Determinism across identical seeds (direct and via compileSoundRecipe).
const a = renderMaterialStereo({ kind: 'material', material: 'bell', pitch: 520 }, 8000, 505);
const b = renderMaterialStereo({ kind: 'material', material: 'bell', pitch: 520 }, 8000, 505);
assert.deepEqual(a, b);

const base = fixture();
const recipe = {
  ...base,
  duration: 0.4,
  voices: [
    {
      ...base.voices[0],
      source: {
        kind: 'material' as const,
        material: 'ceramic' as MaterialPreset,
        pitch: 680,
        strike: 'bounce' as const,
        bounces: 3,
      },
    },
  ],
  sequences: [{ ...base.sequences[0], steps: [{ ...base.sequences[0].steps[0], duration: 0.38 }] }],
};
assert.deepEqual(compileSoundRecipe(recipe)[0]!.wav, compileSoundRecipe(recipe)[0]!.wav);

process.stdout.write(
  'material: all 10 presets, strike modes, twinBeat, splash, stereoSpread, and determinism passed\n',
);
