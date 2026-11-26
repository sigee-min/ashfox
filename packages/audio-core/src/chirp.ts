import type { ChirpSource } from './contract';
import { evaluate } from './curve';

const TAU = Math.PI * 2;
const smooth = (value: number) => value * value * (3 - 2 * value);

interface ChirpState {
  phase: number;
  jitterFrom: number;
  jitterTo: number;
  jitterFrame: number;
  air: number;
  readonly trillPhase: number;
  readonly jitterPeriod: number;
}

const chirpHarmonics = (
  phase: number,
  frequency: number,
  rate: number,
  brightness: number,
): number => {
  let tone = Math.sin(phase);
  for (let harmonic = 2; harmonic <= 3; harmonic++) {
    const band = Math.max(0, Math.min(1, (rate * 0.48 - frequency * harmonic) / (rate * 0.06)));
    tone += Math.sin(phase * harmonic) * brightness * (harmonic === 2 ? 0.22 : 0.055) * band;
  }
  return tone;
};

const sampleChirp = (
  state: ChirpState,
  source: ChirpSource,
  rate: number,
  pitchShift: number,
  random: () => number,
  breath: () => number,
  time: number,
  progress: number,
): number => {
  const pitch = evaluate(source.pitch, progress) * pitchShift;
  if (state.jitterFrame >= state.jitterPeriod) {
    state.jitterFrom = state.jitterTo;
    state.jitterTo = random();
    state.jitterFrame = 0;
  }
  const jitter =
    state.jitterFrom +
    (state.jitterTo - state.jitterFrom) * smooth(state.jitterFrame++ / state.jitterPeriod);
  const trillHz = source.trillHz ?? 0;
  const trill = trillHz === 0 ? 0 : Math.sin(TAU * trillHz * time + state.trillPhase);
  const frequency =
    pitch *
    Math.pow(
      2,
      (jitter * (source.jitterCents ?? 0) * 0.35 + trill * (source.trillCents ?? 0)) / 1200,
    );
  state.phase = (state.phase + (TAU * frequency) / rate) % TAU;
  const tone = chirpHarmonics(state.phase, frequency, rate, evaluate(source.brightness, progress));
  const breathAmt = source.breath ?? 0;
  const turbulence = breathAmt === 0 ? 0 : breath();
  state.air += 0.32 * (turbulence - state.air);
  const articulation = trillHz === 0 ? 1 : 1 - (source.trillDepth ?? 0) * (0.5 - 0.5 * trill);
  return (tone + (turbulence - state.air) * breathAmt) * articulation;
};

export const createChirp = (
  source: ChirpSource,
  rate: number,
  pitchShift: number,
  random: () => number,
  breath: () => number,
  trillRandom: () => number,
): ((time: number, progress: number, outLR: Float64Array) => void) => {
  const state: ChirpState = {
    phase: 0,
    jitterFrom: random(),
    jitterTo: random(),
    jitterFrame: 0,
    air: 0,
    trillPhase: trillRandom() * 0.25,
    jitterPeriod: Math.round(rate * 0.018),
  };
  return (time: number, progress: number, outLR: Float64Array): void => {
    const sample = sampleChirp(state, source, rate, pitchShift, random, breath, time, progress);
    outLR[0] = sample;
    outLR[1] = sample;
  };
};
