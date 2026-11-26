import assert from 'node:assert/strict';
import {
  applyDuckEnvelope,
  computeDuckEnvelope,
  createPitchDrift,
  sampleCircularDrift,
} from '../../src/mod';

const RATE = 48000;

// 1. Circular 2D Perlin drift is C^2-continuous across loopFrames boundaries.
const spec = { target: 'cutoff' as const, depth: 0.4, rate: 0.8, seed: 42 };
const loopFrames = 96000;
const totalFrames = 120000;
const startVal = sampleCircularDrift(RATE, 0, totalFrames, spec, loopFrames);
const endVal = sampleCircularDrift(
  RATE,
  loopFrames / (totalFrames - 1),
  totalFrames,
  spec,
  loopFrames,
);
assert.ok(
  Math.abs(startVal - endVal) < 1e-12,
  `circular Perlin loop wrap mismatch: ${startVal} vs ${endVal}`,
);

// Slope continuity across loop wrap.
const eps = 1 / (totalFrames - 1);
const slopeAfter = (sampleCircularDrift(RATE, eps, totalFrames, spec, loopFrames) - startVal) / eps;
const slopeBefore =
  (endVal -
    sampleCircularDrift(
      RATE,
      (loopFrames - 1) / (totalFrames - 1),
      totalFrames,
      spec,
      loopFrames,
    )) /
  eps;
assert.ok(
  Math.abs(slopeAfter - slopeBefore) < 0.05,
  `circular Perlin slope discontinuity: ${slopeAfter} vs ${slopeBefore}`,
);

// 2. Pitch drift fractional-delay processor modulates stereo cleanly without NaN.
const pitchSpec = { target: 'pitch' as const, depth: 0.3, rate: 2.0, seed: 7 };
const pd = createPitchDrift(RATE, pitchSpec);
const lr = new Float64Array(2);
let energy = 0;
for (let i = 0; i < 4800; i++) {
  const s = Math.sin((2 * Math.PI * 330 * i) / RATE);
  const d = sampleCircularDrift(RATE, i / 4799, 4800, pitchSpec);
  pd.process(s, s * 0.8, d, lr);
  assert.ok(Number.isFinite(lr[0]) && Number.isFinite(lr[1]));
  energy += lr[0]! * lr[0]!;
}
assert.ok(energy > 100);

// 3. Inter-voice sidechain ducking attenuates target during trigger and releases smoothly.
const trigger = new Float64Array(RATE * 2);
for (let i = 4800; i < 9600; i++) {
  trigger[i * 2] = 0.8;
  trigger[i * 2 + 1] = 0.8;
}
const env = computeDuckEnvelope(trigger, 2, RATE, 80);
assert.ok(env[7200]! > 0.7, 'sidechain envelope should peak during trigger');
assert.ok(env[30000]! < 0.05, 'sidechain envelope should release cleanly');

const target = new Float64Array(RATE * 2).fill(0.5);
applyDuckEnvelope(target, 2, env, 0.75);
assert.ok(
  Math.abs(target[7200 * 2]!) < 0.25 && Math.abs(target[30000 * 2]!) > 0.45,
  'ducking should attenuate target only under active trigger',
);

process.stdout.write(
  'mod: circular Perlin C^2 loop wrap, fractional pitch drift, and sidechain ducking passed\n',
);
