import type { ResonatorSource } from './contract';
import { frame } from './curve';
const computeNoiseNorm = (length: number): number => {
  let sum = 0;
  for (let n = 0; n < length; n++) sum += Math.sin((Math.PI * n) / (length - 1)) ** 4;
  return Math.sqrt(sum);
};

export const createResonator = (source: ResonatorSource, pitch: number, random: () => number) => {
  const sorted = [...source.modes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const total = sorted.reduce((sum, mode) => sum + mode.gain, 0);
  const modes = sorted.map((mode) => {
    const theta = (2 * Math.PI * mode.hz * pitch) / 48000;
    const r = 10 ** (-3 / (mode.decay * 48000));
    return {
      a: 2 * r * Math.cos(theta),
      b: r * r,
      excitation: Math.sin(theta),
      gain: mode.gain / total,
      y1: 0,
      y2: 0,
    };
  });
  const isNoise = source.excitation.kind === 'noise';
  const length = source.excitation.kind === 'noise' ? frame(source.excitation.duration) : 1;
  const norm = isNoise ? computeNoiseNorm(length) : 1;
  return (i: number): number => {
    const x = !isNoise
      ? i === 0
        ? 1
        : 0
      : i < length
        ? ((random() * 2 - 1) * Math.sin((Math.PI * i) / (length - 1)) ** 2) / norm
        : 0;
    let sum = 0;
    for (const mode of modes) {
      const y = mode.a * mode.y1 - mode.b * mode.y2 + mode.excitation * x;
      mode.y2 = mode.y1;
      mode.y1 = y;
      sum += y * mode.gain;
    }
    return sum;
  };
};
