import assert from 'node:assert/strict';
import type { WhooshSource } from '../../src/contract';
import { random } from '../../src/random';
import { measure } from '../../src/render';
import { createWhoosh } from '../../src/whoosh';

const RATE = 48000;

const renderWhoosh = (
  source: WhooshSource,
  frames: number,
  seed = 1201,
): { readonly mono: Float64Array; readonly stereo: Float64Array } => {
  const synth = createWhoosh(source, RATE, frames, 1, random(seed));
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

const rmsWindow = (pcm: Float64Array, start: number, end: number): number => {
  let sq = 0;
  for (let i = start; i < end; i++) sq += pcm[i]! * pcm[i]!;
  return Math.sqrt(sq / Math.max(1, end - start));
};

const zeroCrossingHz = (pcm: Float64Array, start: number, end: number): number => {
  let crossings = 0;
  for (let i = start + 1; i < end; i++) {
    if (pcm[i - 1]! <= 0 && pcm[i]! > 0) crossings++;
  }
  return (crossings * RATE) / Math.max(1, end - start);
};

// 1. Pressure scales nonlinearly (~v^3) between slow and fast velocity.
const slow = renderWhoosh({ kind: 'whoosh', velocity: 0.4, thickness: 0.25 }, 16000).mono;
const fast = renderWhoosh({ kind: 'whoosh', velocity: 1.6, thickness: 0.25 }, 16000).mono;
assert.ok(measure(fast).rms > measure(slow).rms * 10, 'v^3 pressure should scale steeply');

// 2. Strouhal vortex frequency increases for thinner blades/arrows.
const thick = renderWhoosh(
  { kind: 'whoosh', velocity: 1.2, thickness: 1.0, noiseTone: 0.1 },
  24000,
).mono;
const thin = renderWhoosh(
  { kind: 'whoosh', velocity: 1.2, thickness: 0.08, noiseTone: 0.1 },
  24000,
).mono;
assert.ok(
  zeroCrossingHz(thin, 2400, 20000) > zeroCrossingHz(thick, 2400, 20000) * 1.8,
  'thinner object should shed higher-frequency Strouhal vortex whistle',
);

// 3. Doppler shifts pitch downward across peak when enabled.
const doppler = renderWhoosh(
  {
    kind: 'whoosh',
    velocity: {
      domain: 'linear',
      interpolation: 'smooth',
      points: [
        { at: 0, value: 1.2 },
        { at: 0.5, value: 1.5 },
        { at: 1, value: 1.2 },
      ],
    },
    thickness: 0.2,
    doppler: 1,
    noiseTone: 0.1,
  },
  24000,
).mono;
assert.ok(
  zeroCrossingHz(doppler, 2000, 9000) > zeroCrossingHz(doppler, 15000, 22000),
  'doppler should drop frequency after approach peak',
);

// 4. sweepPan moves stereo energy cleanly from L to R.
const swept = renderWhoosh(
  {
    kind: 'whoosh',
    velocity: 1.2,
    thickness: 0.2,
    sweepPan: {
      domain: 'linear',
      interpolation: 'linear',
      points: [
        { at: 0, value: -0.9 },
        { at: 1, value: 0.9 },
      ],
    },
  },
  24000,
).stereo;
const earlyL = rmsWindow(swept, 0, 8000 * 2);
const lateR = rmsWindow(swept, 16000 * 2 + 1, 24000 * 2);
const earlyLRDiff =
  rmsWindow(
    swept.filter((_, i) => i % 2 === 0),
    1000,
    5000,
  ) -
  rmsWindow(
    swept.filter((_, i) => i % 2 === 1),
    1000,
    5000,
  );
const lateLRDiff =
  rmsWindow(
    swept.filter((_, i) => i % 2 === 1),
    19000,
    23000,
  ) -
  rmsWindow(
    swept.filter((_, i) => i % 2 === 0),
    19000,
    23000,
  );
assert.ok(earlyL > 1e-4 && lateR > 1e-4 && earlyLRDiff > 0 && lateLRDiff > 0);

process.stdout.write(
  'whoosh: v^3 pressure, Strouhal vortex thickness, Doppler shift, and stereo sweepPan passed\n',
);
