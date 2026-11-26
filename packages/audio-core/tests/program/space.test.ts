import assert from 'node:assert/strict';
import { SPACE_PRESETS } from '../../src';
import { measure } from '../../src/render';
import { applySpace } from '../../src/space';

const RATE = 48000;

const stereoImpulse = (frames: number): Float64Array => {
  const buf = new Float64Array(frames * 2);
  buf[0] = 1;
  buf[1] = 1;
  return buf;
};

const monoImpulse = (frames: number): Float64Array => {
  const buf = new Float64Array(frames);
  buf[0] = 1;
  return buf;
};

const segmentRms = (pcm: Float64Array, startIdx: number, endIdx: number): number => {
  let sq = 0;
  for (let i = startIdx; i < endIdx; i++) sq += pcm[i]! ** 2;
  return Math.sqrt(sq / Math.max(1, endIdx - startIdx));
};

// 1. mix = 0 and undefined are exact bypasses.
const rawStereo = new Float64Array([0.5, -0.25, 0.1, 0.8, -0.3, 0.2]);
assert.equal(applySpace(rawStereo, 2, RATE, undefined), rawStereo);
assert.equal(applySpace(rawStereo, 2, RATE, { mix: 0 }), rawStereo);
assert.equal(applySpace(rawStereo, 2, RATE, { preset: 'cavern', mix: 0 }), rawStereo);

const rawMono = new Float64Array([0.4, -0.2, 0.1]);
assert.equal(applySpace(rawMono, 1, RATE, { mix: 0 }), rawMono);

// 2. All 7 presets produce finite stereo tails with L/R decorrelation.
const impulse = stereoImpulse(RATE);
for (const preset of SPACE_PRESETS) {
  const wet = applySpace(impulse, 2, RATE, { preset });
  const stats = measure(wet, 2);
  assert.ok(stats.rms > 1e-4, `${preset} tail rms too low: ${stats.rms}`);
  let sumLL = 0;
  let sumRR = 0;
  let sumLR = 0;
  let diffSq = 0;
  for (let i = 1; i < RATE; i++) {
    const l = wet[i * 2]!;
    const r = wet[i * 2 + 1]!;
    sumLL += l * l;
    sumRR += r * r;
    sumLR += l * r;
    diffSq += (l - r) ** 2;
  }
  const corr = sumLR / Math.sqrt(sumLL * sumRR);
  assert.ok(diffSq > 1e-4, `${preset} L/R should differ`);
  assert.ok(Math.abs(corr) < 0.98, `${preset} L/R correlation too high: ${corr}`);
}

// 3. FDN-8 decay scaling controls late tail energy.
const shortTail = applySpace(impulse, 2, RATE, { preset: 'stone_hall', decay: 0.12 });
const longTail = applySpace(impulse, 2, RATE, { preset: 'stone_hall', decay: 1.8 });
assert.ok(
  segmentRms(longTail, 12000 * 2, RATE * 2) > segmentRms(shortTail, 12000 * 2, RATE * 2) * 3,
  'longer decay should produce higher late tail energy',
);

// 4. ER size scaling shifts early reflection arrival.
const firstNonZeroFrame = (pcm: Float64Array): number => {
  for (let i = 1; i < pcm.length / 2; i++) {
    if (Math.abs(pcm[i * 2]!) > 1e-6 || Math.abs(pcm[i * 2 + 1]!) > 1e-6) return i;
  }
  return -1;
};
const smallEr = applySpace(impulse, 2, RATE, { mix: 0.5, size: 0.3, preDelayMs: 0 });
const largeEr = applySpace(impulse, 2, RATE, { mix: 0.5, size: 2.0, preDelayMs: 0 });
assert.ok(firstNonZeroFrame(largeEr) > firstNonZeroFrame(smallEr));

// 5. Mono channel mode produces finite non-silent mono tail.
const monoWet = applySpace(monoImpulse(RATE), 1, RATE, { preset: 'timber_room' });
assert.ok(measure(monoWet, 1).rms > 1e-4);

process.stdout.write(
  `space: mix=0 bypass, all ${SPACE_PRESETS.length} presets, stereo decorrelation, ER size, and FDN-8 decay passed\n`,
);
