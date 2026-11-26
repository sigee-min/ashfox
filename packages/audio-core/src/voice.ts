import type { Control, VocalSource } from './contract';
import { evaluate } from './curve';

const TAU = Math.PI * 2;

interface FormantNode {
  readonly control: Control;
  readonly radius: number;
  readonly b: number;
  readonly gain: number;
  readonly weight: number;
  a: number;
  lastHz: number;
  y1: number;
  y2: number;
}

interface ChestNode {
  readonly a: number;
  readonly b: number;
  readonly gain: number;
  y1: number;
  y2: number;
}

interface NasalNode {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
  readonly buzzA: number;
  readonly buzzB: number;
  readonly buzzGain: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  by1: number;
  by2: number;
}

interface VoiceState {
  phase: number;
  cycle: number;
  detune: number;
  strength: number;
  prior: number;
  prior2: number;
}

const clampFormantHz = (hz: number, rate: number): number =>
  Math.max(60, Math.min(rate * 0.44, hz));

const createFormantNodes = (source: VocalSource, rate: number): FormantNode[] =>
  source.formants.map((control, i) => {
    const bw = source.bandwidths[i] ?? 120;
    const radius = Math.exp((-Math.PI * bw) / rate);
    const hz = clampFormantHz(evaluate(control, 0), rate);
    return {
      control,
      radius,
      a: 2 * radius * Math.cos((TAU * hz) / rate),
      b: radius * radius,
      gain: 1 - radius,
      weight: 1 / (1 + i * 0.6),
      lastHz: typeof control === 'number' ? control : hz,
      y1: 0,
      y2: 0,
    };
  });

const createChestNode = (rate: number): ChestNode => {
  const theta = (TAU * 140) / rate;
  const radius = Math.exp((-Math.PI * 75) / rate);
  return {
    a: 2 * radius * Math.cos(theta),
    b: radius * radius,
    gain: (1 - radius) * 2 * Math.sin(theta),
    y1: 0,
    y2: 0,
  };
};

const createNasalNode = (rate: number): NasalNode => {
  const w = (TAU * 2500) / rate;
  const cosW = Math.cos(w);
  const alpha = Math.sin(w) / (2 * 3.5);
  const a0 = 1 + alpha;
  const buzzR = Math.exp((-Math.PI * 130) / rate);
  return {
    b0: 1 / a0,
    b1: (-2 * cosW) / a0,
    b2: 1 / a0,
    a1: (-2 * cosW) / a0,
    a2: (1 - alpha) / a0,
    buzzA: 2 * buzzR * Math.cos((TAU * 1050) / rate),
    buzzB: buzzR * buzzR,
    buzzGain: 1 - buzzR,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
    by1: 0,
    by2: 0,
  };
};

const glottalPulse = (phase: number, openDur: number): number => {
  if (phase < openDur) return 0.5 * (1 - Math.cos((Math.PI * phase) / openDur));
  if (phase < openDur + 0.2) return Math.cos(((Math.PI / 2) * (phase - openDur)) / 0.2);
  return 0;
};

const stepFormants = (
  formants: readonly FormantNode[],
  diffExcitation: number,
  progress: number,
  rate: number,
): number => {
  let result = 0;
  for (let i = 0; i < formants.length; i++) {
    const r = formants[i]!;
    if (typeof r.control !== 'number') {
      const hz = clampFormantHz(evaluate(r.control, progress), rate);
      if (hz !== r.lastHz) {
        r.lastHz = hz;
        r.a = 2 * r.radius * Math.cos((TAU * hz) / rate);
      }
    }
    const y = r.gain * diffExcitation + r.a * r.y1 - r.b * r.y2;
    r.y2 = r.y1;
    r.y1 = y;
    result += y * r.weight;
  }
  return result;
};

const applyNasal = (
  nasal: NasalNode,
  raw: number,
  diffExcitation: number,
  nasalAmt: number,
): number => {
  const notched =
    nasal.b0 * raw +
    nasal.b1 * nasal.x1 +
    nasal.b2 * nasal.x2 -
    nasal.a1 * nasal.y1 -
    nasal.a2 * nasal.y2;
  nasal.x2 = nasal.x1;
  nasal.x1 = raw;
  nasal.y2 = nasal.y1;
  nasal.y1 = notched;
  const buzz = nasal.buzzGain * diffExcitation + nasal.buzzA * nasal.by1 - nasal.buzzB * nasal.by2;
  nasal.by2 = nasal.by1;
  nasal.by1 = buzz;
  const mix = nasalAmt * 0.75;
  return raw * (1 - mix) + notched * mix + buzz * (nasalAmt * 0.35);
};

interface VoiceParams {
  readonly rate: number;
  readonly pitchShift: number;
  readonly jitterAmt: number;
  readonly roughAmt: number;
  readonly breathAmt: number;
  readonly growlAmt: number;
  readonly chestAmt: number;
  readonly nasalAmt: number;
}

const advanceGlottalCycle = (
  state: VoiceState,
  frequency: number,
  params: VoiceParams,
  random: () => number,
): void => {
  state.phase += (frequency * state.detune) / params.rate;
  if (state.phase < 1) return;
  state.phase -= 1;
  state.cycle++;
  state.detune = Math.pow(2, random() * params.jitterAmt * 0.1);
  state.strength = 1 - params.roughAmt * (0.5 + 0.5 * Math.sin(state.cycle * 2.399963));
};

const computeGlottalPulse = (state: VoiceState, growlAmt: number): number => {
  const parity = state.cycle & 1;
  if (growlAmt <= 0) return glottalPulse(state.phase, 0.45) * state.strength;
  const odd = parity === 1;
  const cycleGain = odd ? 1 - 0.55 * growlAmt : 1 + 0.2 * growlAmt;
  const openDur = 0.45 + (odd ? 0.08 : -0.05) * growlAmt;
  const subPhase = 0.5 * (parity + state.phase);
  const sub = (Math.sin(TAU * subPhase) + 0.35 * Math.sin(2 * TAU * subPhase)) * 0.45 * growlAmt;
  return glottalPulse(state.phase, openDur) * state.strength * cycleGain + sub;
};

const sampleVoiceFrame = (
  source: VocalSource,
  params: VoiceParams,
  state: VoiceState,
  formants: readonly FormantNode[],
  chest: ChestNode,
  nasal: NasalNode,
  random: () => number,
  breath: () => number,
  progress: number,
): number => {
  const frequency = evaluate(source.pitch, progress) * params.pitchShift;
  advanceGlottalCycle(state, frequency, params, random);
  const pulse = computeGlottalPulse(state, params.growlAmt);
  const breathSignal =
    params.breathAmt === 0 ? 0 : breath() * params.breathAmt * (0.2 + Math.abs(pulse) * 0.8);
  const excitation = pulse + breathSignal;
  const diffExcitation = excitation - state.prior2;
  state.prior2 = state.prior;
  state.prior = excitation;
  let out = stepFormants(formants, diffExcitation, progress, params.rate);
  if (params.chestAmt > 0) {
    const cy = chest.gain * pulse + chest.a * chest.y1 - chest.b * chest.y2;
    chest.y2 = chest.y1;
    chest.y1 = cy;
    out += cy * params.chestAmt * 0.65;
  }
  return params.nasalAmt > 0 ? applyNasal(nasal, out, diffExcitation, params.nasalAmt) : out;
};

// Dynamic formant bank, glottal pulse, subharmonic growl, chest cavity, and nasal antiresonance.
export const createVoice = (
  source: VocalSource,
  rate: number,
  pitchShift: number,
  random: () => number,
  breath: () => number,
): ((progress: number) => number) => {
  const params: VoiceParams = {
    rate,
    pitchShift,
    jitterAmt: source.jitter ?? 0,
    roughAmt: source.roughness ?? 0,
    breathAmt: source.breath ?? 0,
    growlAmt: source.growl ?? 0,
    chestAmt: source.chest ?? 0.25,
    nasalAmt: source.nasal ?? 0,
  };
  const formants = createFormantNodes(source, rate);
  const chest = createChestNode(rate);
  const nasal = createNasalNode(rate);
  const state: VoiceState = { phase: 0, cycle: 0, detune: 1, strength: 1, prior: 0, prior2: 0 };
  return (progress: number): number =>
    sampleVoiceFrame(source, params, state, formants, chest, nasal, random, breath, progress);
};
