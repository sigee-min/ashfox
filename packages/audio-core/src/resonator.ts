import { compareText } from '@ashfox/internal-contracts';
import type { ResonatorSource } from './contract';
import { frame } from './curve';

const computeNoiseNorm = (length: number): number => {
  let sum = 0;
  for (let n = 0; n < length; n += 1) sum += Math.sin((Math.PI * n) / (length - 1)) ** 4;
  return Math.sqrt(sum);
};

const sampleExcitation = (
  ex: ResonatorSource['excitation'],
  i: number,
  length: number,
  norm: number,
  random: () => number,
): number => {
  if (ex.kind === 'impulse') return i === 0 ? 1 : 0;
  if (i >= length) return 0;
  const win = Math.sin((Math.PI * i) / (length - 1)) ** 2;
  if (ex.kind === 'noise') return ((random() * 2 - 1) * win) / norm;
  const body = Math.sin((Math.PI * i) / (length - 1));
  const click =
    (random() * 2 - 1) * ex.hardness * (i < Math.max(4, Math.floor(length * 0.25)) ? 1 : 0.2);
  return ((body * (1 - ex.hardness * 0.5) + click) * win) / Math.max(1, Math.sqrt(length * 0.35));
};

export const createResonator = (source: ResonatorSource, pitch: number, random: () => number) => {
  const sorted = [...source.modes].sort((a, b) => compareText(a.id, b.id));
  const total = sorted.reduce((sum, mode) => sum + mode.gain, 0);
  const dropCents = source.pitchDropCents ?? 0;
  const dropFrames = Math.max(1, frame(source.pitchDropSeconds ?? 0.04));
  const modes = sorted.map((mode) => {
    const theta = (2 * Math.PI * mode.hz * pitch) / 48000;
    const r = 10 ** (-3 / (mode.decay * 48000));
    return {
      hz: mode.hz * pitch,
      a: 2 * r * Math.cos(theta),
      b: r * r,
      r,
      excitation: Math.sin(theta),
      gain: mode.gain / total,
      y1: 0,
      y2: 0,
    };
  });
  const ex = source.excitation;
  const length = ex.kind === 'impulse' ? 1 : frame(ex.duration);
  const norm = ex.kind === 'noise' ? computeNoiseNorm(length) : 1;
  return (i: number): number => {
    const x = sampleExcitation(ex, i, length, norm, random);
    const dropFactor =
      dropCents > 0 && i < dropFrames * 4
        ? 2 ** ((dropCents * Math.exp((-3 * i) / dropFrames)) / 1200)
        : 1;
    let sum = 0;
    for (const mode of modes) {
      let a = mode.a;
      let exc = mode.excitation;
      if (dropFactor !== 1) {
        const theta = (2 * Math.PI * Math.min(20000, mode.hz * dropFactor)) / 48000;
        a = 2 * mode.r * Math.cos(theta);
        exc = Math.sin(theta);
      }
      const y = a * mode.y1 - mode.b * mode.y2 + exc * x;
      mode.y2 = mode.y1;
      mode.y1 = y;
      sum += y * mode.gain;
    }
    return sum;
  };
};
