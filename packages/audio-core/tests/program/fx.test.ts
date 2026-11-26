import assert from 'node:assert/strict';
import type { SoundVoice } from '../../src/contract';
import { createVoiceFxRack } from '../../src/fx';
import { random } from '../../src/random';
import { measure } from '../../src/render';

const RATE = 48000;

const baseVoice = (extra: Partial<SoundVoice>): SoundVoice => ({
  id: 'fx_test',
  source: { kind: 'noise', color: 'pink' },
  gain: 1,
  ...extra,
});

const goertzel = (pcm: Float64Array, hz: number, stride = 2, offset = 0): number => {
  const omega = (2 * Math.PI * hz) / RATE;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  let count = 0;
  for (let i = offset; i < pcm.length; i += stride) {
    const s0 = pcm[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
    count++;
  }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / Math.max(1, count * count);
};

// 1. 3-band Parametric EQ shapes low, mid, and high energy accurately.
const rng = random(1401);
const noise = Float64Array.from({ length: RATE * 2 }, () => (rng() * 2 - 1) * 0.25);
const eqRack = createVoiceFxRack(
  baseVoice({
    eq: {
      low: { hz: 120, db: 9 },
      mid: { hz: 1200, db: -12, q: 1.5 },
      high: { hz: 7000, db: 9 },
    },
  }),
  RATE,
);
const eqOut = Float64Array.from(noise);
const lr = new Float64Array(2);
for (let i = 0; i < RATE; i++) {
  lr[0] = eqOut[i * 2]!;
  lr[1] = eqOut[i * 2 + 1]!;
  eqRack.applyEqAndDrive(lr);
  eqOut[i * 2] = lr[0]!;
  eqOut[i * 2 + 1] = lr[1]!;
}
assert.ok(goertzel(eqOut, 80) > goertzel(noise, 80) * 2.5, 'low shelf should boost 80 Hz');
assert.ok(goertzel(eqOut, 1200) < goertzel(noise, 1200) * 0.3, 'mid notch should cut 1200 Hz');
assert.ok(goertzel(eqOut, 9000) > goertzel(noise, 9000) * 2.5, 'high shelf should boost 9 kHz');

// 2. All 4 analog drive modes ('tape', 'tube', 'grit', 'fold') saturate cleanly without NaNs.
const sine = Float64Array.from(
  { length: 4800 },
  (_, i) => 0.45 * Math.sin((2 * Math.PI * 220 * i) / RATE),
);
for (const mode of ['tape', 'tube', 'grit', 'fold'] as const) {
  const rack = createVoiceFxRack(baseVoice({ drive: { amount: 3.5, mode } }), RATE);
  const out = new Float64Array(4800);
  for (let i = 0; i < 4800; i++) {
    lr[0] = sine[i]!;
    lr[1] = sine[i]!;
    rack.applyEqAndDrive(lr);
    out[i] = lr[0]!;
  }
  assert.ok(measure(out).rms > 0.1);
  assert.ok(goertzel(out, 660, 1) > goertzel(sine, 660, 1) * 5, `${mode} should add odd harmonics`);
}

// 3. Stereo FX chain ('chorus', 'phaser', 'delay' pingPong, 'shimmer') creates stereo & tail energy.
const impulse = new Float64Array(RATE * 2);
impulse[0] = 0.8;
impulse[1] = 0.8;
for (const fxItem of [
  { kind: 'chorus' as const, mix: 0.6, rate: 2, depth: 0.6 },
  { kind: 'phaser' as const, mix: 0.6, rate: 1.5, stages: 6 },
  { kind: 'delay' as const, mix: 0.5, timeMs: 60, feedback: 0.4, pingPong: true },
  { kind: 'shimmer' as const, mix: 0.5, feedback: 0.4, shiftSemitones: 12 },
]) {
  const rack = createVoiceFxRack(baseVoice({ fx: [fxItem] }), RATE);
  const buf = Float64Array.from(impulse);
  for (let i = 10; i < 8000; i++) {
    buf[i * 2] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / RATE);
    buf[i * 2 + 1] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / RATE);
  }
  rack.applyStereoFx(buf, 2);
  let tailEnergy = 0;
  let sideEnergy = 0;
  for (let i = 2000; i < RATE; i++) {
    const l = buf[i * 2]!;
    const r = buf[i * 2 + 1]!;
    if (i >= 10000) tailEnergy += l * l + r * r;
    sideEnergy += (l - r) * (l - r);
  }
  if (fxItem.kind === 'delay' || fxItem.kind === 'shimmer') {
    assert.ok(tailEnergy > 1e-4, `${fxItem.kind} should generate delayed/shimmer tail`);
  }
  if (fxItem.kind === 'chorus' || fxItem.kind === 'delay' || fxItem.kind === 'shimmer') {
    assert.ok(sideEnergy > 1e-5, `${fxItem.kind} should widen stereo field`);
  }
}

process.stdout.write(
  'fx: 3-band parametric EQ, tape/tube/grit/fold drive, and chorus/phaser/delay/shimmer passed\n',
);
