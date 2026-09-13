import type { FmSource } from './contract';
import { evaluate } from './curve';
const FACTOR = 8, RATE = 48000 * FACTOR, TAPS = 257, DELAY = (TAPS - 1) / 2, TAU = Math.PI * 2;
// Offline centered FIR: 20 kHz passband cutoff, Blackman sidelobe suppression.
// Compensate the 128 high-rate sample delay rather than shifting event onsets.
const coefficients = (() => {
  const values = new Float64Array(TAPS); let sum = 0;
  for (let i = 0; i < TAPS; i++) {
    const x = i - DELAY, cutoff = 20000 / RATE;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(TAU * cutoff * x) / (Math.PI * x);
    const window = .42 - .5 * Math.cos(TAU * i / (TAPS - 1)) + .08 * Math.cos(2 * TAU * i / (TAPS - 1));
    values[i] = sinc * window; sum += values[i];
  }
  for (let i = 0; i < TAPS; i++) values[i] /= sum;
  return values;
})();
export const createFm = (source: FmSource, frames: number, pitchShift: number) => {
  const history = new Float64Array(TAPS);
  let next = 0, phase = 0;
  return (frameIndex: number): number => {
    const target = frameIndex * FACTOR + DELAY;
    while (next <= target) {
      let value = 0;
      if (next <= (frames - 1) * FACTOR) {
        const u = next / FACTOR / (frames - 1), t = next / RATE;
        const frequency = evaluate(source.pitch, u) * pitchShift * 2 ** (Math.sin(TAU * source.vibratoHz * t) * source.vibratoCents / 1200);
        phase += TAU * frequency / RATE;
        value = Math.sin(phase + evaluate(source.index, u) * Math.sin(phase * source.ratio));
      }
      history[next % TAPS] = value; next++;
    }
    let sum = 0;
    for (let tap = 0; tap < TAPS; tap++) {
      const index = target - tap;
      if (index >= 0) sum += history[index % TAPS] * coefficients[tap];
    }
    return sum;
  };
};
