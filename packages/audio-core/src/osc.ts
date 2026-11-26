import type { OscSource } from './contract';
import { evaluate } from './curve';

const TAU = Math.PI * 2;

const polyBlep = (t: number, dt: number): number => {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
};

const sampleVoice = (
  waveform: OscSource['waveform'],
  phase: number,
  dt: number,
  pw: number,
): number => {
  if (waveform === 'sine') return Math.sin(TAU * phase);
  if (waveform === 'saw') return 2 * phase - 1 - polyBlep(phase, dt);
  if (waveform === 'square') {
    const raw = phase < 0.5 ? 1 : -1;
    return raw + polyBlep(phase, dt) - polyBlep((phase + 0.5) % 1, dt);
  }
  if (waveform === 'pulse') {
    const raw = phase < pw ? 1 : -1;
    return raw + polyBlep(phase, dt) - polyBlep((phase + 1 - pw) % 1, dt);
  }
  return 1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));
};

export const createOsc = (source: OscSource, rate: number, pitchShift: number) => {
  const unison = source.unison ?? 1;
  const detune = source.detuneCents ?? 0;
  const phases = Array.from({ length: unison }, (_, idx) => (idx * 0.61803398875) % 1);
  const ratios =
    unison === 1
      ? [1]
      : Array.from({ length: unison }, (_, idx) => {
          const offset = (idx / (unison - 1)) * 2 - 1;
          return 2 ** ((offset * detune) / 1200);
        });
  const norm = 1 / Math.sqrt(unison);
  return (progress: number): number => {
    const baseHz = evaluate(source.pitch, progress) * pitchShift;
    const pw = source.pulseWidth !== undefined ? evaluate(source.pulseWidth, progress) : 0.5;
    let sum = 0;
    for (let v = 0; v < unison; v += 1) {
      const dt = Math.min(0.45, (baseHz * ratios[v]!) / rate);
      phases[v] = (phases[v]! + dt) % 1;
      sum += sampleVoice(source.waveform, phases[v]!, dt, pw);
    }
    return sum * norm;
  };
};
