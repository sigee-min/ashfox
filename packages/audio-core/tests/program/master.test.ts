import assert from 'node:assert/strict';
import { compileSoundRecipe } from '../../src';
import { applyMasterBus } from '../../src/master';
import { random } from '../../src/random';
import { master, measure } from '../../src/render';
import { fixture } from './fixture';

const RATE = 48000;

const goertzelPower = (pcm: Float64Array, hz: number, stride = 1, chOffset = 0): number => {
  const omega = (2 * Math.PI * hz) / RATE;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  let count = 0;
  for (let i = chOffset; i < pcm.length; i += stride) {
    const s0 = pcm[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
    count++;
  }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / Math.max(1, count * count);
};

// 1. DC blocker strips constant DC offset after settle (< 1e-4).
const dcInput = Float64Array.from(
  { length: RATE },
  (_, i) => 0.35 + 0.25 * Math.sin((2 * Math.PI * 440 * i) / RATE),
);
const dcCleaned = applyMasterBus(dcInput, { gainDb: 0, peakDb: -0.5 }, 1, RATE);
assert.ok(Math.abs(measure(dcCleaned.subarray(4800)).dc) < 1e-4, 'DC offset should be stripped');

// 2. Punch increases onset-to-body ratio.
const transient = new Float64Array(RATE / 2);
for (let i = 0; i < transient.length; i++) {
  const amp = i < 2400 ? 0.45 : 0.15;
  transient[i] = amp * Math.sin((2 * Math.PI * 300 * i) / RATE);
}
const flatMaster = applyMasterBus(transient, { gainDb: 0, peakDb: -0.5, punch: 0 }, 1, RATE);
const punchyMaster = applyMasterBus(transient, { gainDb: 0, peakDb: -0.5, punch: 0.9 }, 1, RATE);
const onsetBodyRatio = (pcm: Float64Array): number =>
  measure(pcm.subarray(200, 1800)).rms / measure(pcm.subarray(8000, 22000)).rms;
assert.ok(onsetBodyRatio(punchyMaster) > onsetBodyRatio(flatMaster) * 1.15);

// 3. Warmth & Air tilt low and high spectrum accurately.
const rng = random(808);
const white = Float64Array.from({ length: RATE }, () => rng() * 2 - 1);
const warmHi = applyMasterBus(white, { gainDb: 0, peakDb: -0.5, warmth: 1 }, 1, RATE);
const warmLo = applyMasterBus(white, { gainDb: 0, peakDb: -0.5, warmth: -1 }, 1, RATE);
assert.ok(goertzelPower(warmHi, 90) > goertzelPower(warmLo, 90) * 3);

const airHi = applyMasterBus(white, { gainDb: 0, peakDb: -0.5, air: 1 }, 1, RATE);
const airLo = applyMasterBus(white, { gainDb: 0, peakDb: -0.5, air: -1 }, 1, RATE);
assert.ok(goertzelPower(airHi, 10000) > goertzelPower(airLo, 10000) * 3);

// 4. Glue compresses loud dynamics smoothly.
const glued = applyMasterBus(transient, { gainDb: 0, peakDb: -0.5, glue: 0.9 }, 1, RATE);
assert.ok(onsetBodyRatio(glued) < onsetBodyRatio(flatMaster));

// 5. Width narrows (0) to mono and widens (1.3) highs while keeping <=150Hz bass mono.
const stereoTest = new Float64Array(RATE * 2);
for (let i = 0; i < RATE; i++) {
  const bassMid = 0.35 * Math.sin((2 * Math.PI * 50 * i) / RATE);
  const bassSide = 0.25 * Math.cos((2 * Math.PI * 50 * i) / RATE);
  const highSide = 0.2 * Math.sin((2 * Math.PI * 2500 * i) / RATE);
  stereoTest[i * 2] = bassMid + bassSide + highSide;
  stereoTest[i * 2 + 1] = bassMid - bassSide - highSide;
}
const monoOut = applyMasterBus(stereoTest, { gainDb: 0, peakDb: -0.5, width: 0 }, 2, RATE);
for (let i = 0; i < RATE; i++) assert.equal(monoOut[i * 2], monoOut[i * 2 + 1]);

const unityOut = applyMasterBus(stereoTest, { gainDb: 0, peakDb: -0.5, width: 1 }, 2, RATE);
const wideOut = applyMasterBus(stereoTest, { gainDb: 0, peakDb: -0.5, width: 1.3 }, 2, RATE);
const sideBuf = (pcm: Float64Array): Float64Array =>
  Float64Array.from({ length: RATE }, (_, i) => 0.5 * (pcm[i * 2]! - pcm[i * 2 + 1]!));
const rawSide = sideBuf(stereoTest);
const wideSide = sideBuf(wideOut);
const unitySide = sideBuf(unityOut);
assert.ok(
  goertzelPower(wideSide.subarray(4800), 50) < goertzelPower(rawSide.subarray(4800), 50) * 0.3,
  'bass <= 150 Hz side should be attenuated toward mono even at width=1.3',
);
assert.ok(
  goertzelPower(wideSide.subarray(4800), 2500) >
    goertzelPower(unitySide.subarray(4800), 2500) * 1.5,
  'high stereo side should widen at width=1.3',
);

// 6. targetLufs steers integrated loudness cleanly.
const tone = Float64Array.from(
  { length: RATE },
  (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / RATE),
);
const quietLufs = master(tone, { gainDb: 0, peakDb: -0.5, targetLufs: -24 }, 1, RATE);
const loudLufs = master(tone, { gainDb: 0, peakDb: -0.5, targetLufs: -14 }, 1, RATE);
const lufsRatioDb = 20 * Math.log10(measure(loudLufs).rms / measure(quietLufs).rms);
assert.ok(Math.abs(lufsRatioDb - 10) < 0.25, `expected ~10 dB difference, got ${lufsRatioDb}`);

// 7. limit: true strictly holds decoded PCM16 peak <= ceiling even under gainDb = 18.
const base = fixture();
const hot = { ...base, output: { gainDb: 18, peakDb: -1, limit: true } };
const ceiling = 10 ** (-1 / 20);
const products = compileSoundRecipe(hot);
assert.ok(products[0]!.peak <= ceiling, `peak ${products[0]!.peak} exceeded ${ceiling}`);
assert.throws(
  () => compileSoundRecipe({ ...base, output: { gainDb: 18, peakDb: -1, limit: false } }),
  /lower gainDb/,
);

process.stdout.write(
  'master: DC blocker, punch, warmth/air EQ, glue, bass-mono width, targetLufs, and PCM16 limiter passed\n',
);
