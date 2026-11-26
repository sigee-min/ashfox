import type { FmSource } from './contract';
import { evaluate } from './curve';

const FACTOR = 4;
const RATE = 48000 * FACTOR;
const TAPS = 64;
const MASK = TAPS - 1;
const DELAY_CENTER = (TAPS - 1) / 2;
const TARGET_OFFSET = 31;
const TAU = Math.PI * 2;

const coefficients = (() => {
  const values = new Float64Array(TAPS);
  let sum = 0;
  const cutoff = 24000 / RATE;
  for (let i = 0; i < TAPS; i++) {
    const x = i - DELAY_CENTER;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(TAU * cutoff * x) / (Math.PI * x);
    const window =
      0.42 - 0.5 * Math.cos((TAU * i) / (TAPS - 1)) + 0.08 * Math.cos((2 * TAU * i) / (TAPS - 1));
    values[i] = sinc * window;
    sum += values[i]!;
  }
  for (let i = 0; i < TAPS; i++) values[i] = values[i]! / sum;
  return values;
})();

const convolveFir = (history: Float64Array, target: number): number => {
  let sum = 0;
  if (target >= MASK) {
    for (let tap = 0; tap < TAPS; tap++) {
      sum += history[(target - tap) & MASK]! * coefficients[tap]!;
    }
    return sum;
  }
  for (let tap = 0; tap <= target; tap++) {
    sum += history[(target - tap) & MASK]! * coefficients[tap]!;
  }
  return sum;
};

export const createFm = (
  source: FmSource,
  frames: number,
  pitchShift: number,
): ((frameIndex: number, outLR: Float64Array) => void) => {
  const history = new Float64Array(TAPS);
  const vibHz = source.vibratoHz ?? 0;
  const vibCents = source.vibratoCents ?? 0;
  const span = Math.max(1, frames - 1);
  let next = 0;
  let phase = 0;
  return (frameIndex: number, outLR: Float64Array): void => {
    const target = frameIndex * FACTOR + TARGET_OFFSET;
    while (next <= target) {
      let value = 0;
      if (next <= span * FACTOR) {
        const u = next / FACTOR / span;
        const t = next / RATE;
        const frequency =
          evaluate(source.pitch, u) *
          pitchShift *
          2 ** ((Math.sin(TAU * vibHz * t) * vibCents) / 1200);
        phase += (TAU * frequency) / RATE;
        value = Math.sin(phase + evaluate(source.index, u) * Math.sin(phase * source.ratio));
      }
      history[next & MASK] = value;
      next++;
    }
    const sum = convolveFir(history, target);
    outLR[0] = sum;
    outLR[1] = sum;
  };
};
