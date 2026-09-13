import assert from 'node:assert/strict';
import { createFm } from '../../src/fm';
const tau = 2 * Math.PI, size = 512, period = 16;
const source = { kind: 'fm' as const, pitch: 3000, ratio: 4, index: 4, vibratoHz: 0, vibratoCents: 0 };
const oscillator = createFm(source, 4800, 1);
const values = Array.from({ length: 128 }, (_, i) => oscillator(i)).slice(64, 80);
// Independent dense analytic waveform projected onto the output passband.
// High-rate phase starts with one 384 kHz increment; startup FIR edges excluded.
const reference = Array.from({ length: size }, (_, i) => Math.sin(tau * (i / size + .125 / period) + 4 * Math.sin(4 * tau * (i / size + .125 / period))));
const dft = (samples: number[], bin: number) => ({
  re: samples.reduce((sum, value, i) => sum + value * Math.cos(tau * bin * i / samples.length), 0) / samples.length,
  im: samples.reduce((sum, value, i) => sum - value * Math.sin(tau * bin * i / samples.length), 0) / samples.length
});
let error = 0, total = 0;
for (const bin of [1, 3, 5]) {
  const actual = dft(values, bin), ideal = dft(reference, bin);
  error += (actual.re - ideal.re) ** 2 + (actual.im - ideal.im) ** 2;
  total += ideal.re ** 2 + ideal.im ** 2;
}
const residualDb = 10 * Math.log10(error / total);
assert.ok(residualDb < -50, `FM extreme passband alias residual ${residualDb} dB exceeds -50 dB`);
process.stdout.write(`fm: extreme 3 kHz carrier/ratio4/index4 passband residual ${residualDb.toFixed(2)} dB vs dense analytic reference\n`);
