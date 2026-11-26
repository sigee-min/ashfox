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

const RATE = 48000;

const renderMaterial = (source: MaterialSource, frames: number, seed: number): Float64Array => {
  const synth = createMaterial(source, frames, 1, random(seed));
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) out[i] = synth(i);
  return out;
};

// 1. All 10 MaterialPresets produce finite non-silent output.
for (const material of MATERIAL_PRESETS) {
  const pcm = renderMaterial({ kind: 'material', material, pitch: 320 }, 12000, 101);
  const stats = measure(pcm);
  assert.ok(stats.peak > 1e-4, `${material} peak too low: ${stats.peak}`);
  assert.ok(stats.rms > 1e-5, `${material} rms too low: ${stats.rms}`);
}

// 2. Strike modes: mallet, scrape, and bounce (bounces: 3 shows multiple energy bursts).
const mallet = renderMaterial(
  { kind: 'material', material: 'steel', pitch: 440, strike: 'mallet', hardness: 0.7 },
  12000,
  202,
);
const scrape = renderMaterial(
  { kind: 'material', material: 'steel', pitch: 440, strike: 'scrape', hardness: 0.7 },
  12000,
  202,
);
assert.ok(measure(scrape).rms > 1e-4);
assert.notDeepEqual(mallet, scrape);

const bounce = renderMaterial(
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
);
const chunkSize = 240; // 5 ms windows
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
const flat = renderMaterial({ kind: 'material', material: 'glass', pitch: 300 }, 12000, 404);
const curved = renderMaterial(
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
);
assert.notDeepEqual(flat.slice(2400), curved.slice(2400));

// 4. Determinism across identical seeds (direct and via compileSoundRecipe).
const a = renderMaterial({ kind: 'material', material: 'bell', pitch: 520 }, 8000, 505);
const b = renderMaterial({ kind: 'material', material: 'bell', pitch: 520 }, 8000, 505);
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
  `material: all ${MATERIAL_PRESETS.length} presets, mallet/scrape/bounce bursts, curved pitch, and determinism passed\n`,
);
