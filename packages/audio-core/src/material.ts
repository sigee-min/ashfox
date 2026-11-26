import type { MaterialPreset, MaterialSource } from './contract';
import { evaluate } from './curve';

const RATE = 48000;
const TAU = Math.PI * 2;
const MAX_MODES = 32;

interface MaterialSpec {
  readonly ratios: readonly number[];
  readonly baseQ: number;
  readonly hfDampExp: number;
  readonly inharmonicity: number;
  readonly transientWeight: number;
  readonly scrapeNoise: number;
  readonly pitchDropCents: number;
  readonly pitchDropSec: number;
  readonly shearFactor: number;
  readonly modeStep: number;
}

// [baseQ, hfDampExp, inharmonicity, transientWeight, scrapeNoise, pitchDropCents, pitchDropSec, shearFactor, modeStep]
type MaterialParamTuple = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const MATERIAL_RATIOS: Record<MaterialPreset, readonly number[]> = {
  steel: [1, 2.756, 5.404, 8.933, 13.344, 15.12, 18.64, 21.8, 25.4, 29.1, 33.2, 37.5],
  iron: [1, 1.52, 2.18, 2.89, 3.64, 4.41, 5.23, 6.11, 7.04, 8.02, 9.05, 10.12],
  bronze: [0.5, 1, 1.188, 1.504, 2.0, 2.514, 3.011, 3.58, 4.02, 4.56, 5.13, 5.72],
  bell: [0.5, 1, 1.188, 1.504, 2.0, 2.514, 3.011, 3.52, 4.005, 4.51, 5.02, 5.56],
  wood: [1, 1.92, 2.78, 3.98, 5.25, 6.84, 9.0, 11.4, 14.5, 17.2, 20.1, 23.4],
  stone: [1, 1.46, 2.11, 2.79, 3.48, 4.32, 5.18, 6.09, 7.04, 8.05, 9.12, 10.25],
  glass: [1, 2.32, 4.18, 6.27, 8.64, 11.28, 13.92, 16.85, 19.9, 23.1, 26.4, 29.8],
  ceramic: [1, 1.84, 2.67, 3.74, 4.91, 6.18, 7.52, 8.95, 10.48, 12.11, 13.84, 15.66],
  bone: [1, 1.72, 2.58, 3.65, 4.82, 6.14, 7.58, 9.14, 10.82, 12.62, 14.54, 16.56],
  leather: [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.6, 4.06, 4.35, 4.68],
};

const MATERIAL_PARAMS: Record<MaterialPreset, MaterialParamTuple> = {
  steel: [820, 0.25, 0.018, 0.42, 0.32, 0, 0.01, 0.0022, 4.9],
  iron: [210, 0.46, 0.048, 0.5, 0.55, 0, 0.01, 0.0005, 1.18],
  bronze: [540, 0.36, 0.022, 0.36, 0.34, 0, 0.01, 0.0003, 0.7],
  bell: [1250, 0.24, 0.014, 0.3, 0.25, 0, 0.01, 0.0002, 0.62],
  wood: [78, 0.88, 0.03, 0.56, 0.48, 45, 0.014, 0.0012, 3.5],
  stone: [68, 0.72, 0.056, 0.88, 0.82, 35, 0.012, 0.0008, 1.3],
  glass: [1680, 0.18, 0.012, 0.44, 0.28, 0, 0.01, 0.0015, 3.6],
  ceramic: [440, 0.34, 0.024, 0.72, 0.5, 0, 0.01, 0.0008, 2.0],
  bone: [115, 0.68, 0.032, 0.66, 0.54, 25, 0.01, 0.0009, 2.3],
  leather: [52, 0.82, 0.02, 0.48, 0.42, 260, 0.035, 0, 0.35],
};

const getMaterialSpec = (preset: MaterialPreset): MaterialSpec => {
  const [
    baseQ,
    hfDampExp,
    inharmonicity,
    transientWeight,
    scrapeNoise,
    pitchDropCents,
    pitchDropSec,
    shearFactor,
    modeStep,
  ] = MATERIAL_PARAMS[preset];
  return {
    ratios: MATERIAL_RATIOS[preset],
    baseQ,
    hfDampExp,
    inharmonicity,
    transientWeight,
    scrapeNoise,
    pitchDropCents,
    pitchDropSec,
    shearFactor,
    modeStep,
  };
};

interface ModalBank {
  readonly count: number;
  readonly ratios: Float64Array;
  readonly gains: Float64Array;
  readonly qEff: Float64Array;
  readonly r: Float64Array;
  readonly a: Float64Array;
  readonly b: Float64Array;
  readonly exc: Float64Array;
  readonly y1: Float64Array;
  readonly y2: Float64Array;
  readonly avgR: number;
}

interface BounceSchedule {
  readonly times: Float64Array;
  readonly vels: Float64Array;
  readonly count: number;
}

const computeModeRatio = (spec: MaterialSpec, index: number, size: number): number => {
  const base =
    index < spec.ratios.length
      ? spec.ratios[index]!
      : spec.ratios[spec.ratios.length - 1]! + (index - spec.ratios.length + 1) * spec.modeStep;
  const sheared =
    spec.shearFactor > 0 ? base / Math.sqrt(1 + spec.shearFactor * base * base) : base;
  const spreadExp = 1 - 0.06 * Math.log2(size);
  const stretched = sheared * (1 + spec.inharmonicity * index * 0.25);
  return Math.pow(stretched, spreadExp);
};

const updateModalCoeffs = (bank: ModalBank, baseHz: number): void => {
  for (let k = 0; k < bank.count; k++) {
    const hz = baseHz * bank.ratios[k]!;
    if (hz >= 20500) {
      bank.r[k] = 0;
      bank.a[k] = 0;
      bank.b[k] = 0;
      bank.exc[k] = 0;
      continue;
    }
    const nyqFade = hz > 17500 ? (20500 - hz) / 3000 : 1;
    const r = Math.exp((-Math.PI * hz) / (bank.qEff[k]! * RATE));
    const theta = (TAU * hz) / RATE;
    bank.r[k] = r;
    bank.a[k] = 2 * r * Math.cos(theta);
    bank.b[k] = r * r;
    bank.exc[k] = Math.sin(theta) * nyqFade;
  }
};

const buildModalBank = (
  source: MaterialSource,
  spec: MaterialSpec,
  baseHz: number,
  random: () => number,
): ModalBank => {
  const count = Math.max(4, Math.min(MAX_MODES, Math.round(source.modes ?? 22)));
  const size = Math.max(0.25, Math.min(4, source.size ?? 1));
  const hardness = Math.max(0, Math.min(1, source.hardness ?? 0.6));
  const damping = Math.max(0, Math.min(1, source.damping ?? 0.3));
  const brightness = Math.max(0, Math.min(1, source.brightness ?? 0.65));
  const sizeDecay = Math.pow(size, 0.45);
  const dampScale = 0.35 + damping * 3.2;
  const ratios = new Float64Array(count);
  const gains = new Float64Array(count);
  const qEff = new Float64Array(count);
  let gainSum = 0;

  for (let k = 0; k < count; k++) {
    const jitter = 1 + (random() * 2 - 1) * 0.004 * (1 + k * 0.08);
    const ratio = computeModeRatio(spec, k, size) * jitter;
    ratios[k] = ratio;
    qEff[k] = Math.max(
      3,
      (spec.baseQ * sizeDecay) /
        (Math.pow(Math.max(0.5, ratio), spec.hfDampExp * (1.35 - 0.55 * brightness)) * dampScale),
    );
    const bodyBoost = k < 4 ? 1 + Math.max(0, size - 1) * 0.28 : 1;
    const brightRoll = 1 / (1 + k * (1.28 - 0.9 * brightness) * (1.15 - 0.55 * hardness));
    const g = (bodyBoost * brightRoll) / (1 + 0.14 * k);
    gains[k] = g;
    gainSum += g;
  }
  for (let k = 0; k < count; k++) gains[k] /= gainSum;

  const bank: ModalBank = {
    count,
    ratios,
    gains,
    qEff,
    r: new Float64Array(count),
    a: new Float64Array(count),
    b: new Float64Array(count),
    exc: new Float64Array(count),
    y1: new Float64Array(count),
    y2: new Float64Array(count),
    avgR: 0,
  };
  updateModalCoeffs(bank, baseHz);
  let rSum = 0;
  for (let k = 0; k < count; k++) rSum += bank.r[k]!;
  return { ...bank, avgR: rSum / count };
};

const buildBounceSchedule = (
  source: MaterialSource,
  totalFrames: number,
  random: () => number,
): BounceSchedule => {
  const strike = source.strike ?? 'mallet';
  const count = strike === 'bounce' ? Math.max(1, Math.min(6, Math.round(source.bounces ?? 3))) : 1;
  const times = new Float64Array(count);
  const vels = new Float64Array(count);
  vels[0] = 1;
  if (count === 1) return { times, vels, count };

  const span = Math.min(totalFrames * 0.68, (0.12 + 0.085 * count) * RATE);
  const weights = new Float64Array(count - 1);
  let weightSum = 0;
  for (let k = 0; k < count - 1; k++) {
    const w = Math.pow(0.62, k) * (0.94 + random() * 0.12);
    weights[k] = w;
    weightSum += w;
  }
  let acc = 0;
  for (let k = 1; k < count; k++) {
    acc += (weights[k - 1]! / weightSum) * span;
    times[k] = Math.round(acc);
    vels[k] = Math.pow(0.62, k) * (0.92 + random() * 0.16);
  }
  return { times, vels, count };
};

const stepModalBank = (bank: ModalBank, x: number): number => {
  let sum = 0;
  for (let k = 0; k < bank.count; k++) {
    const y = bank.a[k]! * bank.y1[k]! - bank.b[k]! * bank.y2[k]! + bank.exc[k]! * x;
    bank.y2[k] = bank.y1[k]!;
    bank.y1[k] = y;
    sum += y * bank.gains[k]!;
  }
  return sum;
};

interface StrikeState {
  bounceIdx: number;
  lastImpactFrame: number;
  impactVel: number;
  clickEnv: number;
}

const sampleStrikeInput = (
  i: number,
  schedule: BounceSchedule,
  state: StrikeState,
  pulseFrames: number,
  hardness: number,
  brightness: number,
  transientWeight: number,
  random: () => number,
): number => {
  while (state.bounceIdx + 1 < schedule.count && i >= schedule.times[state.bounceIdx + 1]!) {
    state.bounceIdx++;
    state.lastImpactFrame = i;
    state.impactVel = schedule.vels[state.bounceIdx]!;
    state.clickEnv = 1;
  }
  const local = i - state.lastImpactFrame;
  let pulse = 0;
  if (local < pulseFrames) {
    const win = 0.5 * (1 - Math.cos((TAU * (local + 0.5)) / pulseFrames));
    pulse = win / Math.sqrt(pulseFrames * 0.4);
  }
  let click = 0;
  if (state.clickEnv > 0.002) {
    const grit = (random() * 2 - 1) * transientWeight * (0.25 + 0.75 * hardness);
    click = grit * state.clickEnv * (0.5 + 0.5 * brightness);
    state.clickEnv *= 0.94 - 0.08 * hardness;
  }
  return (pulse + click) * state.impactVel;
};

interface ScrapeState {
  slipPhase: number;
  noiseLp: number;
  modPhase: number;
  scale: number;
}

const sampleScrapeInput = (
  i: number,
  totalFrames: number,
  baseHz: number,
  hardness: number,
  brightness: number,
  spec: MaterialSpec,
  state: ScrapeState,
  random: () => number,
): number => {
  const u = i / Math.max(1, totalFrames - 1);
  const env = Math.min(1, u / 0.08) * Math.min(1, (1 - u) / 0.08 + 0.15);
  state.modPhase = (state.modPhase + 4.2 / RATE) % 1;
  const mod = 0.65 + 0.35 * Math.sin(TAU * state.modPhase);
  const slipHz = Math.max(45, Math.min(480, baseHz * (0.25 + 0.45 * hardness) * mod));
  state.slipPhase += (slipHz * (0.85 + random() * 0.3)) / RATE;
  let slip = 0;
  if (state.slipPhase >= 1) {
    state.slipPhase -= 1;
    slip = (0.5 + 0.5 * hardness) * (0.6 + 0.8 * random());
  }
  const rawNoise = random() * 2 - 1;
  state.noiseLp += (0.15 + 0.65 * brightness) * (rawNoise - state.noiseLp);
  const friction = (rawNoise - state.noiseLp * (1 - brightness * 0.5)) * spec.scrapeNoise;
  return (slip + friction * mod * (0.35 + 0.65 * hardness)) * env * state.scale;
};

// Multi-mode acoustic synthesis across 10 physical materials and 3 strike excitations.
export const createMaterial = (
  source: MaterialSource,
  totalFrames: number,
  pitchShift: number,
  random: () => number,
): ((i: number) => number) => {
  const spec = getMaterialSpec(source.material);
  const hardness = Math.max(0, Math.min(1, source.hardness ?? 0.6));
  const brightness = Math.max(0, Math.min(1, source.brightness ?? 0.65));
  const initialHz = evaluate(source.pitch, 0) * pitchShift;
  const bank = buildModalBank(source, spec, initialHz, random);
  const isScrape = source.strike === 'scrape';
  const schedule = buildBounceSchedule(source, totalFrames, random);
  const pulseFrames = Math.max(4, Math.round((0.001 + (1 - hardness) * 0.013) * RATE));
  const dropFrames = Math.max(1, Math.round(spec.pitchDropSec * RATE));
  const dropCents = spec.pitchDropCents * (0.5 + 0.5 * hardness);
  const strikeState: StrikeState = { bounceIdx: 0, lastImpactFrame: 0, impactVel: 1, clickEnv: 1 };
  const scrapeState: ScrapeState = {
    slipPhase: 0,
    noiseLp: 0,
    modPhase: random(),
    scale: Math.sqrt(Math.max(0.001, 1 - bank.avgR * bank.avgR)) * 1.45,
  };
  let lastHz = initialHz;

  return (i: number): number => {
    const u = i / Math.max(1, totalFrames - 1);
    const x = isScrape
      ? sampleScrapeInput(i, totalFrames, lastHz, hardness, brightness, spec, scrapeState, random)
      : sampleStrikeInput(
          i,
          schedule,
          strikeState,
          pulseFrames,
          hardness,
          brightness,
          spec.transientWeight,
          random,
        );
    const baseHz =
      typeof source.pitch === 'number' ? initialHz : evaluate(source.pitch, u) * pitchShift;
    const local = i - strikeState.lastImpactFrame;
    const dropFactor =
      !isScrape && dropCents > 0 && local < dropFrames * 4
        ? Math.pow(2, (dropCents * Math.exp((-3 * local) / dropFrames)) / 1200)
        : 1;
    const effHz = baseHz * dropFactor;
    if (effHz !== lastHz) {
      lastHz = effHz;
      updateModalCoeffs(bank, effHz);
    }
    return stepModalBank(bank, x);
  };
};
