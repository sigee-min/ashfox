import type { VocalSource } from './contract';
import { evaluate } from './curve';

const TAU = Math.PI * 2;
const RATTLE_SLOTS = 2;
const WIDTH_RING = 32;
const WIDTH_MASK = WIDTH_RING - 1;

interface VowelTarget {
  readonly f: readonly [number, number, number, number];
  readonly bw: readonly [number, number, number, number];
}

const VOWEL_TABLE: Record<string, VowelTarget> = {
  oo: { f: [300, 870, 2240, 3200], bw: [60, 85, 110, 150] },
  ah: { f: [730, 1090, 2440, 3400], bw: [85, 95, 120, 160] },
  aa: { f: [660, 1720, 2410, 3300], bw: [80, 105, 125, 160] },
  eh: { f: [530, 1840, 2480, 3400], bw: [70, 100, 125, 160] },
  ee: { f: [270, 2290, 3010, 3550], bw: [55, 100, 130, 165] },
  ih: { f: [390, 1990, 2550, 3450], bw: [60, 95, 125, 160] },
  oh: { f: [450, 800, 2350, 3250], bw: [70, 85, 115, 155] },
  uh: { f: [640, 1190, 2390, 3350], bw: [75, 95, 120, 160] },
  aw: { f: [570, 840, 2410, 3300], bw: [75, 85, 120, 155] },
  er: { f: [490, 1350, 1690, 3300], bw: [70, 90, 110, 155] },
};

interface CascadeNode {
  a: number;
  b: number;
  c: number;
  y1: number;
  y2: number;
  lastHz: number;
  lastBw: number;
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

interface RattleGrain {
  active: boolean;
  env: number;
  decay: number;
  a: number;
  b: number;
  gain: number;
  y1: number;
  y2: number;
}

interface VoiceState {
  phase: number;
  cycle: number;
  detune: number;
  strength: number;
  chaos: number;
  periodScale: number;
  cycleGain: number;
  openDur: number;
  fryEnv: number;
  widthIdx: number;
  ctrlAge: number;
  readonly io: Float64Array; // [dcX, dcY, apX, apY]
  readonly widthRing: Float64Array;
}

interface VoiceParams {
  readonly rate: number;
  readonly pitchShift: number;
  readonly jitterAmt: number;
  readonly roughAmt: number;
  readonly breathAmt: number;
  readonly growlAmt: number;
  readonly chestAmt: number;
  readonly nasalAmt: number;
  readonly rattleAmt: number;
  readonly widthDelay: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const clampFormantHz = (hz: number, rate: number): number =>
  Math.max(60, Math.min(rate * 0.44, hz));

const parseVowels = (vowels?: string): readonly VowelTarget[] => {
  if (!vowels) return [VOWEL_TABLE.ah!];
  const list: VowelTarget[] = [];
  for (const part of vowels.split('->')) {
    const target = VOWEL_TABLE[part.trim().toLowerCase()];
    if (target) list.push(target);
  }
  return list.length > 0 ? list : [VOWEL_TABLE.ah!];
};

const createCascade = (): CascadeNode[] =>
  Array.from({ length: 4 }, () => ({ a: 1, b: 0, c: 0, y1: 0, y2: 0, lastHz: -1, lastBw: -1 }));

const createChestNode = (rate: number): ChestNode => {
  const theta = (TAU * 140) / rate;
  const radius = Math.exp((-Math.PI * 72) / rate);
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
  const buzzR = Math.exp((-Math.PI * 160) / rate);
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

const createRattlePool = (): RattleGrain[] =>
  Array.from({ length: RATTLE_SLOTS }, () => ({
    active: false,
    env: 0,
    decay: 0.99,
    a: 0,
    b: 0,
    gain: 0,
    y1: 0,
    y2: 0,
  }));

const updateNodeCoeffs = (node: CascadeNode, hz: number, bw: number, rate: number): void => {
  const clampedHz = clampFormantHz(hz, rate);
  const clampedBw = Math.max(30, Math.min(800, bw));
  if (clampedHz === node.lastHz && clampedBw === node.lastBw) return;
  node.lastHz = clampedHz;
  node.lastBw = clampedBw;
  const radius = Math.exp((-Math.PI * clampedBw) / rate);
  const b = 2 * radius * Math.cos((TAU * clampedHz) / rate);
  const c = radius * radius;
  node.b = b;
  node.c = c;
  node.a = 1 - b + c;
};

const resolveVowelAt = (
  stops: readonly VowelTarget[],
  progress: number,
  outHz: Float64Array,
  outBw: Float64Array,
): void => {
  const n = stops.length;
  if (n === 1) {
    for (let k = 0; k < 4; k++) {
      outHz[k] = stops[0]!.f[k]!;
      outBw[k] = stops[0]!.bw[k]!;
    }
    return;
  }
  const pos = clamp01(progress) * (n - 1);
  const idx = Math.min(n - 2, Math.floor(pos));
  const t = pos - idx;
  const w = t * t * (3 - 2 * t);
  const a = stops[idx]!;
  const b = stops[idx + 1]!;
  for (let k = 0; k < 4; k++) {
    outHz[k] = a.f[k]! * Math.pow(b.f[k]! / a.f[k]!, w);
    outBw[k] = a.bw[k]! + (b.bw[k]! - a.bw[k]!) * w;
  }
};

const resolveFormants = (
  source: VocalSource,
  stops: readonly VowelTarget[],
  progress: number,
  outHz: Float64Array,
  outBw: Float64Array,
): void => {
  resolveVowelAt(stops, progress, outHz, outBw);
  if (source.formants && source.formants.length > 0) {
    const len = Math.min(4, source.formants.length);
    for (let k = 0; k < len; k++) outHz[k] = evaluate(source.formants[k]!, progress);
    if (len === 3) outHz[3] = Math.max(outHz[2]! + 500, 3400);
  }
  if (source.bandwidths && source.bandwidths.length > 0) {
    const len = Math.min(4, source.bandwidths.length);
    for (let k = 0; k < len; k++) outBw[k] = source.bandwidths[k]!;
  }
};

/** Asymmetric Liljencrants-Fant (LF) glottal flow derivative with sharp closure spike. */
const lfGlottalDerivative = (phase: number, te: number, ta: number): number => {
  const tp = te * 0.72;
  const alpha = 3.1;
  const eAtTe = Math.sin((Math.PI * te) / tp);
  if (phase < te) {
    const raw = Math.exp(alpha * (phase - te)) * Math.sin((Math.PI * phase) / tp);
    return raw > 0 ? raw * 0.58 : raw;
  }
  const rem = Math.max(0.02, 1 - te);
  const eEnd = Math.exp(-rem / ta);
  const rec = (Math.exp(-(phase - te) / ta) - eEnd) / Math.max(1e-6, 1 - eEnd);
  return eAtTe * rec;
};

const advanceGlottalCycle = (
  state: VoiceState,
  frequency: number,
  params: VoiceParams,
  random: () => number,
): void => {
  state.phase += (frequency * state.detune) / (params.rate * state.periodScale);
  if (state.phase < 1) return;
  state.phase -= 1;
  state.cycle++;
  const nextChaos = 3.85 * state.chaos * (1 - state.chaos);
  state.chaos = nextChaos > 0.05 && nextChaos < 0.95 ? nextChaos : 0.37;
  state.detune = Math.pow(2, random() * params.jitterAmt * 0.1);
  state.strength = 1 - params.roughAmt * (0.5 + 0.5 * Math.sin(state.cycle * 2.399963));
  if (params.growlAmt <= 0) {
    state.periodScale = 1;
    state.cycleGain = 1;
    state.openDur = 0.56;
    return;
  }
  const odd = (state.cycle & 1) === 1;
  const g = params.growlAmt;
  state.periodScale = 1 + (odd ? 0.22 : -0.18) * g + (state.chaos - 0.5) * 0.14 * g;
  state.cycleGain = odd ? 1 - 0.62 * g : 1 + 0.24 * g;
  state.openDur = 0.56 + (odd ? 0.06 : -0.05) * g;
  state.fryEnv = Math.min(1, state.fryEnv + g * (0.35 + 0.65 * state.chaos));
};

const stepCascade = (cascade: readonly CascadeNode[], input: number): number => {
  let sig = input;
  for (let k = 0; k < 4; k++) {
    const node = cascade[k]!;
    const y = node.a * sig + node.b * node.y1 - node.c * node.y2;
    node.y2 = node.y1;
    node.y1 = y;
    sig = y;
  }
  return sig;
};

const stepRattle = (
  pool: readonly RattleGrain[],
  rattleAmt: number,
  pulse: number,
  rate: number,
  random: () => number,
): number => {
  if (rattleAmt <= 0) return 0;
  let sum = 0;
  for (let k = 0; k < RATTLE_SLOTS; k++) {
    const g = pool[k]!;
    if (!g.active && Math.abs(random()) < rattleAmt * (0.008 + 0.045 * Math.abs(pulse))) {
      const hz = 420 + (random() * 0.5 + 0.5) * 920;
      const bw = 95 + (random() * 0.5 + 0.5) * 140;
      const r = Math.exp((-Math.PI * bw) / rate);
      g.active = true;
      g.env = 0.55 + 0.45 * Math.abs(random());
      g.decay = Math.exp(-1 / (0.004 * rate));
      g.a = 2 * r * Math.cos((TAU * hz) / rate);
      g.b = r * r;
      g.gain = 1 - r;
      g.y1 = 0;
      g.y2 = 0;
    }
    if (!g.active) continue;
    const exc = random() * g.env;
    const y = g.gain * exc + g.a * g.y1 - g.b * g.y2;
    g.y2 = g.y1;
    g.y1 = y;
    g.env *= g.decay;
    if (g.env < 0.004) g.active = false;
    sum += y;
  }
  return sum * rattleAmt * 0.9;
};

const applyNasal = (nasal: NasalNode, raw: number, nasalAmt: number): number => {
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
  const mix = nasalAmt * 0.78;
  const attenuated = raw * (1 - mix) + notched * mix;
  const buzz = nasal.buzzGain * attenuated + nasal.buzzA * nasal.by1 - nasal.buzzB * nasal.by2;
  nasal.by2 = nasal.by1;
  nasal.by1 = buzz;
  return attenuated + buzz * (nasalAmt * 0.85);
};

const writeStereoWidth = (
  state: VoiceState,
  mono: number,
  rattleSig: number,
  breathSig: number,
  widthDelay: number,
  outLR: Float64Array,
): void => {
  const ap = -0.22 * mono + state.io[2]! + 0.22 * state.io[3]!;
  state.io[2] = mono;
  state.io[3] = ap;
  state.widthRing[state.widthIdx] = ap;
  const delayed = state.widthRing[(state.widthIdx - widthDelay) & WIDTH_MASK]!;
  state.widthIdx = (state.widthIdx + 1) & WIDTH_MASK;
  const airSpread = (breathSig * 0.16 + rattleSig * 0.22) * 0.5;
  outLR[0] = mono * 0.92 + delayed * 0.08 + airSpread;
  outLR[1] = ap * 0.92 + mono * 0.08 - airSpread;
};

interface VoiceEngine {
  readonly source: VocalSource;
  readonly params: VoiceParams;
  readonly state: VoiceState;
  readonly stops: readonly VowelTarget[];
  readonly cascade: readonly CascadeNode[];
  readonly chest: ChestNode;
  readonly nasal: NasalNode;
  readonly rattlePool: readonly RattleGrain[];
  readonly hzBuf: Float64Array;
  readonly bwBuf: Float64Array;
  readonly random: () => number;
  readonly breath: () => number;
}

const sampleVoiceFrame = (e: VoiceEngine, progress: number, outLR: Float64Array): void => {
  const { source, params, state } = e;
  advanceGlottalCycle(
    state,
    evaluate(source.pitch, progress) * params.pitchShift,
    params,
    e.random,
  );
  const lf = lfGlottalDerivative(state.phase, state.openDur, 0.012 + params.breathAmt * 0.02);
  const fry = state.fryEnv > 0.01 && state.phase > state.openDur - 0.06 ? -state.fryEnv * 0.35 : 0;
  state.fryEnv *= 0.996;
  const pulse = (lf + fry) * state.strength * state.cycleGain;
  const breathSig =
    params.breathAmt === 0 ? 0 : e.breath() * params.breathAmt * (0.22 + Math.abs(pulse) * 0.78);
  const rattleSig = stepRattle(e.rattlePool, params.rattleAmt, pulse, params.rate, e.random);
  const rawExc = pulse * 0.45 + breathSig * 0.35 + rattleSig * 0.35;
  const dcExc = rawExc - state.io[0]! + 0.997 * state.io[1]!;
  state.io[0] = rawExc;
  state.io[1] = dcExc;
  if (state.ctrlAge <= 0) {
    resolveFormants(source, e.stops, progress, e.hzBuf, e.bwBuf);
    for (let k = 0; k < 4; k++)
      updateNodeCoeffs(e.cascade[k]!, e.hzBuf[k]!, e.bwBuf[k]!, params.rate);
    state.ctrlAge = 16;
  }
  state.ctrlAge--;
  let out = stepCascade(e.cascade, dcExc);
  if (params.chestAmt > 0) {
    const cy = e.chest.gain * pulse + e.chest.a * e.chest.y1 - e.chest.b * e.chest.y2;
    e.chest.y2 = e.chest.y1;
    e.chest.y1 = cy;
    out += cy * params.chestAmt * 0.65;
  }
  if (params.nasalAmt > 0) out = applyNasal(e.nasal, out, params.nasalAmt);
  writeStereoWidth(state, Math.tanh(out * 0.85), rattleSig, breathSig, params.widthDelay, outLR);
};

// Cascade 4-formant LF-glottal vocal synthesis with vowel trajectory, chaotic growl, and rattle.
export const createVoice = (
  source: VocalSource,
  rate: number,
  pitchShift: number,
  random: () => number,
  breath: () => number,
): ((progress: number, outLR: Float64Array) => void) => {
  const engine: VoiceEngine = {
    source,
    params: {
      rate,
      pitchShift,
      jitterAmt: clamp01(source.jitter ?? 0),
      roughAmt: clamp01(source.roughness ?? 0),
      breathAmt: clamp01(source.breath ?? 0),
      growlAmt: clamp01(source.growl ?? 0),
      chestAmt: clamp01(source.chest ?? 0.25),
      nasalAmt: clamp01(source.nasal ?? 0),
      rattleAmt: clamp01(source.rattle ?? 0),
      widthDelay: Math.max(1, Math.min(WIDTH_RING - 2, Math.round(rate * 0.00018))),
    },
    stops: parseVowels(source.vowels),
    cascade: createCascade(),
    chest: createChestNode(rate),
    nasal: createNasalNode(rate),
    rattlePool: createRattlePool(),
    hzBuf: new Float64Array(4),
    bwBuf: new Float64Array(4),
    random,
    breath,
    state: {
      phase: 0,
      cycle: 0,
      detune: 1,
      strength: 1,
      chaos: 0.37,
      periodScale: 1,
      cycleGain: 1,
      openDur: 0.56,
      fryEnv: 0,
      widthIdx: 0,
      ctrlAge: 0,
      io: new Float64Array(4),
      widthRing: new Float64Array(WIDTH_RING),
    },
  };
  return (progress: number, outLR: Float64Array): void => sampleVoiceFrame(engine, progress, outLR);
};
