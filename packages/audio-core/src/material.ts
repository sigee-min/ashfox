import type { MaterialPreset, MaterialSource } from './contract';
import { evaluate } from './curve';

const RATE = 48000;
const TAU = Math.PI * 2;
const MAX_BASE_MODES = 32;
const MAX_TWIN_PAIRS = 10;

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

type ParamTuple = readonly [number, number, number, number, number, number, number, number, number];

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

const MATERIAL_PARAMS: Record<MaterialPreset, ParamTuple> = {
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
  const p = MATERIAL_PARAMS[preset];
  return {
    ratios: MATERIAL_RATIOS[preset],
    baseQ: p[0],
    hfDampExp: p[1],
    inharmonicity: p[2],
    transientWeight: p[3],
    scrapeNoise: p[4],
    pitchDropCents: p[5],
    pitchDropSec: p[6],
    shearFactor: p[7],
    modeStep: p[8],
  };
};

interface ModalBank {
  readonly count: number;
  readonly ratios: Float64Array;
  readonly gains: Float64Array;
  readonly qEff: Float64Array;
  readonly panL: Float64Array;
  readonly panR: Float64Array;
  readonly upperMask: Float64Array;
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

interface StrikeState {
  bounceIdx: number;
  lastImpactFrame: number;
  impactVel: number;
  slapEnv: number;
  shockEnv: number;
  splashEnv: number;
}

interface ScrapeState {
  slipPhase: number;
  noiseLp: number;
  modPhase: number;
  scale: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

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

const setModeStereo = (
  bank: ModalBank,
  idx: number,
  pan: number,
  ratio: number,
  q: number,
  gain: number,
  isUpper: boolean,
): void => {
  const angle = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  bank.ratios[idx] = ratio;
  bank.qEff[idx] = q;
  bank.gains[idx] = gain;
  bank.panL[idx] = Math.cos(angle);
  bank.panR[idx] = Math.sin(angle);
  bank.upperMask[idx] = isUpper ? 1 : 0;
};

const allocateBank = (totalCount: number): ModalBank => ({
  count: totalCount,
  ratios: new Float64Array(totalCount),
  gains: new Float64Array(totalCount),
  qEff: new Float64Array(totalCount),
  panL: new Float64Array(totalCount),
  panR: new Float64Array(totalCount),
  upperMask: new Float64Array(totalCount),
  r: new Float64Array(totalCount),
  a: new Float64Array(totalCount),
  b: new Float64Array(totalCount),
  exc: new Float64Array(totalCount),
  y1: new Float64Array(totalCount),
  y2: new Float64Array(totalCount),
  avgR: 0,
});

interface ModeCtx {
  readonly spec: MaterialSpec;
  readonly baseCount: number;
  readonly twinPairs: number;
  readonly twinBeat: number;
  readonly spread: number;
  readonly size: number;
  readonly hardness: number;
  readonly brightness: number;
  readonly sizeDecay: number;
  readonly dampScale: number;
  readonly random: () => number;
}

const populateMode = (
  bank: ModalBank,
  ctx: ModeCtx,
  k: number,
  write: number,
): readonly [number, number] => {
  const jitter = 1 + (ctx.random() * 2 - 1) * 0.004 * (1 + k * 0.08);
  const ratio = computeModeRatio(ctx.spec, k, ctx.size) * jitter;
  const q = Math.max(
    3,
    (ctx.spec.baseQ * ctx.sizeDecay) /
      (Math.pow(Math.max(0.5, ratio), ctx.spec.hfDampExp * (1.35 - 0.55 * ctx.brightness)) *
        ctx.dampScale),
  );
  const bodyBoost = k < 4 ? 1 + Math.max(0, ctx.size - 1) * 0.28 : 1;
  const brightRoll = 1 / (1 + k * (1.28 - 0.9 * ctx.brightness) * (1.15 - 0.55 * ctx.hardness));
  const g = (bodyBoost * brightRoll) / (1 + 0.14 * k);
  const side = (k & 1) === 0 ? -1 : 1;
  const pan = side * ctx.spread * (0.45 + 0.55 * (k / Math.max(1, ctx.baseCount - 1)));
  const isUpper = k >= Math.floor(ctx.baseCount * 0.35);
  if (k < ctx.twinPairs) {
    const detune = (0.0025 + 0.0035 * ctx.twinBeat) * (0.75 + 0.5 * ctx.random());
    setModeStereo(bank, write, pan * 0.85, ratio * (1 - detune), q, g * 0.52, isUpper);
    setModeStereo(bank, write + 1, -pan * 0.85, ratio * (1 + detune), q * 0.97, g * 0.48, isUpper);
    return [write + 2, g];
  }
  setModeStereo(bank, write, pan, ratio, q, g, isUpper);
  return [write + 1, g];
};

const buildModalBank = (
  source: MaterialSource,
  spec: MaterialSpec,
  baseHz: number,
  random: () => number,
): ModalBank => {
  const baseCount = Math.max(4, Math.min(MAX_BASE_MODES, Math.round(source.modes ?? 22)));
  const twinBeat = clamp(source.twinBeat ?? 0, 0, 1);
  const twinPairs = twinBeat > 0 ? Math.min(baseCount, MAX_TWIN_PAIRS) : 0;
  const totalCount = baseCount + twinPairs;
  const size = clamp(source.size ?? 1, 0.25, 4);
  const bank = allocateBank(totalCount);
  const ctx: ModeCtx = {
    spec,
    baseCount,
    twinPairs,
    twinBeat,
    spread: clamp(source.stereoSpread ?? 0.35, 0, 1),
    size,
    hardness: clamp(source.hardness ?? 0.6, 0, 1),
    brightness: clamp(source.brightness ?? 0.65, 0, 1),
    sizeDecay: Math.pow(size, 0.45),
    dampScale: 0.35 + clamp(source.damping ?? 0.3, 0, 1) * 3.2,
    random,
  };
  let gainSum = 0;
  let write = 0;
  for (let k = 0; k < baseCount; k++) {
    const [nextWrite, g] = populateMode(bank, ctx, k, write);
    write = nextWrite;
    gainSum += g;
  }
  for (let k = 0; k < totalCount; k++) bank.gains[k] /= gainSum;
  updateModalCoeffs(bank, baseHz);
  let rSum = 0;
  for (let k = 0; k < totalCount; k++) rSum += bank.r[k]!;
  return { ...bank, avgR: rSum / totalCount };
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

const stepModalBank = (
  bank: ModalBank,
  xBody: number,
  xSplash: number,
  outLR: Float64Array,
): void => {
  let sumL = 0;
  let sumR = 0;
  for (let k = 0; k < bank.count; k++) {
    const drive = xBody + xSplash * bank.upperMask[k]!;
    const y = bank.a[k]! * bank.y1[k]! - bank.b[k]! * bank.y2[k]! + bank.exc[k]! * drive;
    bank.y2[k] = bank.y1[k]!;
    bank.y1[k] = y;
    const weighted = y * bank.gains[k]!;
    sumL += weighted * bank.panL[k]!;
    sumR += weighted * bank.panR[k]!;
  }
  outLR[0] = sumL;
  outLR[1] = sumR;
};

const sampleStrikeInput = (e: MaterialEngine, i: number): readonly [number, number] => {
  const { schedule, strikeState: state } = e;
  while (state.bounceIdx + 1 < schedule.count && i >= schedule.times[state.bounceIdx + 1]!) {
    state.bounceIdx++;
    state.lastImpactFrame = i;
    state.impactVel = schedule.vels[state.bounceIdx]!;
    state.slapEnv = 1;
    state.shockEnv = 1;
    state.splashEnv = e.splashAmt * state.impactVel;
    e.ctrlAge = 0;
  }
  const local = i - state.lastImpactFrame;
  const slapFrames = Math.max(12, Math.round(0.002 * RATE)); // 0..2ms air slap/tick
  const shockFrames = Math.round(0.025 * RATE); // 2..25ms structural shock
  let airSlap = 0;
  if (local < slapFrames) {
    const w = 0.5 * (1 - Math.cos((TAU * (local + 0.5)) / slapFrames));
    airSlap =
      (w * 0.35 + (e.random() * 2 - 1) * 0.65 * e.hardness) *
      state.slapEnv *
      e.spec.transientWeight;
    state.slapEnv *= 0.96;
  }
  let shock = 0;
  if (local < e.pulseFrames) {
    shock =
      (0.5 * (1 - Math.cos((TAU * (local + 0.5)) / e.pulseFrames))) /
      Math.sqrt(e.pulseFrames * 0.4);
  }
  if (local < shockFrames && state.shockEnv > 0.002) {
    const grit = (e.random() * 2 - 1) * e.spec.transientWeight * (0.25 + 0.75 * e.hardness);
    shock += grit * state.shockEnv * (0.45 + 0.55 * e.brightness);
    state.shockEnv *= 0.992 - 0.008 * e.hardness;
  }
  let splash = 0;
  if (state.splashEnv > 0.003) {
    splash = (e.random() * 2 - 1) * state.splashEnv * (0.7 + 0.6 * e.brightness);
    state.splashEnv *= 0.995;
  }
  return [(airSlap + shock) * state.impactVel, splash];
};

const sampleScrapeInput = (e: MaterialEngine, i: number): number => {
  const { scrapeState: state } = e;
  const u = i / Math.max(1, e.totalFrames - 1);
  const env = Math.min(1, u / 0.08) * Math.min(1, (1 - u) / 0.08 + 0.15);
  state.modPhase = (state.modPhase + 4.2 / RATE) % 1;
  const mod = 0.65 + 0.35 * Math.sin(TAU * state.modPhase);
  const slipHz = clamp(e.lastHz * (0.25 + 0.45 * e.hardness) * mod, 45, 480);
  state.slipPhase += (slipHz * (0.85 + e.random() * 0.3)) / RATE;
  let slip = 0;
  if (state.slipPhase >= 1) {
    state.slipPhase -= 1;
    slip = (0.5 + 0.5 * e.hardness) * (0.6 + 0.8 * e.random());
  }
  const rawNoise = e.random() * 2 - 1;
  state.noiseLp += (0.15 + 0.65 * e.brightness) * (rawNoise - state.noiseLp);
  const friction = (rawNoise - state.noiseLp * (1 - e.brightness * 0.5)) * e.spec.scrapeNoise;
  return (slip + friction * mod * (0.35 + 0.65 * e.hardness)) * env * state.scale;
};

interface MaterialEngine {
  readonly source: MaterialSource;
  readonly spec: MaterialSpec;
  readonly bank: ModalBank;
  readonly schedule: BounceSchedule;
  readonly strikeState: StrikeState;
  readonly scrapeState: ScrapeState;
  readonly totalFrames: number;
  readonly pitchShift: number;
  readonly initialHz: number;
  readonly isScrape: boolean;
  readonly hardness: number;
  readonly brightness: number;
  readonly splashAmt: number;
  readonly pulseFrames: number;
  readonly dropFrames: number;
  readonly splashFrames: number;
  readonly dropCents: number;
  readonly random: () => number;
  lastHz: number;
  ctrlAge: number;
}

const sampleMaterialFrame = (e: MaterialEngine, i: number, outLR: Float64Array): void => {
  const [xBody, xSplash] = e.isScrape ? [sampleScrapeInput(e, i), 0] : sampleStrikeInput(e, i);
  if (e.ctrlAge <= 0) {
    const u = i / Math.max(1, e.totalFrames - 1);
    const baseHz =
      typeof e.source.pitch === 'number' ? e.initialHz : evaluate(e.source.pitch, u) * e.pitchShift;
    const local = i - e.strikeState.lastImpactFrame;
    const dropCentsNow =
      !e.isScrape && e.dropCents > 0 && local < e.dropFrames * 4
        ? e.dropCents * Math.exp((-3 * local) / e.dropFrames)
        : 0;
    const splashCentsNow =
      !e.isScrape && e.splashAmt > 0 && local < e.splashFrames * 4
        ? e.splashAmt * e.strikeState.impactVel * 75 * Math.exp((-3 * local) / e.splashFrames)
        : 0;
    const effHz = baseHz * Math.pow(2, (dropCentsNow + splashCentsNow) / 1200);
    if (effHz !== e.lastHz) {
      e.lastHz = effHz;
      updateModalCoeffs(e.bank, effHz);
    }
    e.ctrlAge = 16;
  }
  e.ctrlAge--;
  stepModalBank(e.bank, xBody, xSplash, outLR);
};

// Material: twin-mode beating, impact tension splash, 3-stage contact, stereo dispersion.
export const createMaterial = (
  source: MaterialSource,
  totalFrames: number,
  pitchShift: number,
  random: () => number,
): ((i: number, outLR: Float64Array) => void) => {
  const spec = getMaterialSpec(source.material);
  const hardness = clamp(source.hardness ?? 0.6, 0, 1);
  const brightness = clamp(source.brightness ?? 0.65, 0, 1);
  const splashAmt = clamp(source.splash ?? 0, 0, 1);
  const initialHz = evaluate(source.pitch, 0) * pitchShift;
  const bank = buildModalBank(source, spec, initialHz, random);
  const engine: MaterialEngine = {
    source,
    spec,
    bank,
    schedule: buildBounceSchedule(source, totalFrames, random),
    strikeState: {
      bounceIdx: 0,
      lastImpactFrame: 0,
      impactVel: 1,
      slapEnv: 1,
      shockEnv: 1,
      splashEnv: splashAmt,
    },
    scrapeState: {
      slipPhase: 0,
      noiseLp: 0,
      modPhase: random(),
      scale: Math.sqrt(Math.max(0.001, 1 - bank.avgR * bank.avgR)) * 1.45,
    },
    totalFrames,
    pitchShift,
    initialHz,
    isScrape: source.strike === 'scrape',
    hardness,
    brightness,
    splashAmt,
    pulseFrames: Math.max(4, Math.round((0.001 + (1 - hardness) * 0.013) * RATE)),
    dropFrames: Math.max(1, Math.round(spec.pitchDropSec * RATE)),
    splashFrames: Math.round(0.016 * RATE),
    dropCents: spec.pitchDropCents * (0.5 + 0.5 * hardness),
    random,
    lastHz: initialHz,
    ctrlAge: 0,
  };
  return (i: number, outLR: Float64Array): void => sampleMaterialFrame(engine, i, outLR);
};
