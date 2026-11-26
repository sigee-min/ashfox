import type { GranularSource, GranularTexture } from './contract';
import { evaluate } from './curve';

const TAU = Math.PI * 2;
const MAX_GRAINS = 24;
const RING_SIZE = 64;
const RING_MASK = RING_SIZE - 1;
const HANN_SIZE = 256;
const HANN_LUT = Float64Array.from(
  { length: HANN_SIZE + 1 },
  (_, i) => 0.5 * (1 - Math.cos((TAU * i) / HANN_SIZE)),
);

const lookupHann = (t: number): number => {
  const pos = t * HANN_SIZE;
  const idx = pos | 0;
  const frac = pos - idx;
  return HANN_LUT[idx]! + (HANN_LUT[idx + 1]! - HANN_LUT[idx]!) * frac;
};

type GrainMode = 'crackle' | 'bandpass' | 'droplet' | 'airflow' | 'spark' | 'bubble';

interface TexturePreset {
  readonly defaultHz: number;
  readonly defaultGrainMs: number;
  readonly defaultSpread: number;
  readonly mode: GrainMode;
  readonly qMin: number;
  readonly qMax: number;
  readonly chirpMin: number;
  readonly chirpMax: number;
  readonly ampScale: number;
}

const TEXTURE_PRESETS: Record<GranularTexture, TexturePreset> = {
  ember: {
    defaultHz: 2400,
    defaultGrainMs: 11,
    defaultSpread: 0.7,
    mode: 'crackle',
    qMin: 1.5,
    qMax: 5.5,
    chirpMin: -0.15,
    chirpMax: 0.1,
    ampScale: 1.0,
  },
  gravel: {
    defaultHz: 1150,
    defaultGrainMs: 14,
    defaultSpread: 0.65,
    mode: 'bandpass',
    qMin: 1.8,
    qMax: 4.5,
    chirpMin: -0.1,
    chirpMax: 0.05,
    ampScale: 1.1,
  },
  water: {
    defaultHz: 950,
    defaultGrainMs: 22,
    defaultSpread: 0.8,
    mode: 'droplet',
    qMin: 3.0,
    qMax: 8.0,
    chirpMin: -0.25,
    chirpMax: 0.45,
    ampScale: 0.95,
  },
  foliage: {
    defaultHz: 2800,
    defaultGrainMs: 26,
    defaultSpread: 0.45,
    mode: 'bandpass',
    qMin: 1.2,
    qMax: 3.0,
    chirpMin: -0.05,
    chirpMax: 0.05,
    ampScale: 0.95,
  },
  wind: {
    defaultHz: 520,
    defaultGrainMs: 55,
    defaultSpread: 0.4,
    mode: 'airflow',
    qMin: 2.0,
    qMax: 5.5,
    chirpMin: -0.2,
    chirpMax: 0.25,
    ampScale: 0.85,
  },
  spark: {
    defaultHz: 3200,
    defaultGrainMs: 16,
    defaultSpread: 0.75,
    mode: 'spark',
    qMin: 2.5,
    qMax: 6.0,
    chirpMin: -0.45,
    chirpMax: 0.55,
    ampScale: 0.85,
  },
  bubble: {
    defaultHz: 380,
    defaultGrainMs: 32,
    defaultSpread: 0.6,
    mode: 'bubble',
    qMin: 6.0,
    qMax: 12.0,
    chirpMin: 150,
    chirpMax: 500,
    ampScale: 0.85,
  },
};

interface GrainSlot {
  active: boolean;
  age: number;
  dur: number;
  amp: number;
  freq: number;
  freqEnd: number;
  phase: number;
  noiseState: number;
  pan: number;
  panL: number;
  panR: number;
  itdFrames: number;
  sign: number;
  q: number;
  svfAge: number;
  a1: number;
  a2: number;
  a3: number;
  ic1: number;
  ic2: number;
}

interface TurbulenceNode {
  readonly stepFrames: number;
  frame: number;
  prev: number;
  next: number;
}

interface HaasRings {
  idx: number;
  readonly L: Float64Array;
  readonly R: Float64Array;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const stepTurbulence = (node: TurbulenceNode, rand: () => number): number => {
  if (node.frame >= node.stepFrames) {
    node.prev = node.next;
    node.next = rand();
    node.frame = 0;
  }
  const t = node.frame++ / node.stepFrames;
  const smooth = t * t * (3 - 2 * t);
  return node.prev + (node.next - node.prev) * smooth;
};

const stepBandpass = (slot: GrainSlot, x: number, hz: number, rate: number): number => {
  if (slot.svfAge <= 0) {
    const clamped = clamp(hz, 30, rate * 0.44);
    const g = Math.tan((Math.PI * clamped) / rate);
    const k = 1 / Math.max(0.5, slot.q);
    slot.a1 = 1 / (1 + g * (g + k));
    slot.a2 = g * slot.a1;
    slot.a3 = g * slot.a2;
    slot.svfAge = 16;
  }
  slot.svfAge--;
  const v3 = x - slot.ic2;
  const v1 = slot.a1 * slot.ic1 + slot.a2 * v3;
  const v2 = slot.ic2 + slot.a2 * slot.ic1 + slot.a3 * v3;
  slot.ic1 = 2 * v1 - slot.ic1;
  slot.ic2 = 2 * v2 - slot.ic2;
  return v1;
};

type ModeSampler = (
  slot: GrainSlot,
  instHz: number,
  t: number,
  rate: number,
  rand: () => number,
) => number;

const MODE_SAMPLERS: Record<GrainMode, ModeSampler> = {
  bubble: (slot, instHz, t, rate, rand) => {
    slot.phase = (slot.phase + (TAU * instHz) / rate) % TAU;
    const meniscus = t < 0.06 ? (1 - t / 0.06) * (rand() * 2 - 1) * 0.14 : 0;
    return Math.sin(slot.phase) + meniscus;
  },
  spark: (slot, instHz, _t, rate, rand) => {
    slot.phase = (slot.phase + (TAU * instHz) / rate) % TAU;
    const fm = Math.sin(slot.phase + 1.45 * Math.sin(slot.phase * 2.71));
    return fm * 0.8 + (rand() * 2 - 1) * 0.25;
  },
  crackle: (slot, instHz, t, rate, rand) => {
    const white = rand() * 2 - 1;
    const snap = t < 0.16 ? (1 - t / 0.16) * slot.sign * 0.9 : 0;
    const sizzle = stepBandpass(slot, white, instHz, rate) * 1.4;
    return snap + sizzle;
  },
  droplet: (slot, instHz, _t, rate, rand) => {
    slot.phase = (slot.phase + (TAU * instHz) / rate) % TAU;
    const ping = Math.sin(slot.phase) * 0.6;
    const spray = stepBandpass(slot, rand() * 2 - 1, instHz * 1.35, rate) * 0.7;
    return ping + spray;
  },
  bandpass: (slot, instHz, t, rate, rand) => {
    const dry = (rand() * 2 - 1) * (t < 0.15 ? 0.22 : 0.08);
    return stepBandpass(slot, rand() * 2 - 1, instHz, rate) * 1.45 + dry;
  },
  airflow: (slot, instHz, _t, rate, rand) => {
    slot.noiseState += 0.25 * (rand() * 2 - 1 - slot.noiseState);
    return stepBandpass(slot, slot.noiseState, instHz, rate) * 1.7;
  },
};

const createGrainPool = (): GrainSlot[] =>
  Array.from({ length: MAX_GRAINS }, () => ({
    active: false,
    age: 0,
    dur: 1,
    amp: 0,
    freq: 440,
    freqEnd: 440,
    phase: 0,
    noiseState: 0,
    pan: 0,
    panL: Math.SQRT1_2,
    panR: Math.SQRT1_2,
    itdFrames: 0,
    sign: 1,
    q: 2,
    svfAge: 0,
    a1: 0,
    a2: 0,
    a3: 0,
    ic1: 0,
    ic2: 0,
  }));

const spawnGrain = (
  pool: GrainSlot[],
  preset: TexturePreset,
  baseHz: number,
  grainMs: number,
  spread: number,
  ampScale: number,
  stereoWidth: number,
  itdMs: number,
  rate: number,
  rand: () => number,
): void => {
  const slot = pool.find((g) => !g.active);
  if (!slot) return;
  const durMs =
    preset.mode === 'bubble'
      ? clamp(grainMs * (0.65 + rand() * 0.7), 15, 55)
      : grainMs * (0.65 + rand() * 0.7);
  const dur = Math.max(16, Math.min(Math.round(rate * 0.25), Math.round((durMs * rate) / 1000)));
  const freq = clamp(baseHz * Math.pow(2, (rand() * 2 - 1) * spread), 40, rate * 0.42);
  const chirpSpan = preset.chirpMin + rand() * (preset.chirpMax - preset.chirpMin);
  const freqEnd =
    preset.mode === 'bubble'
      ? Math.min(rate * 0.42, freq + chirpSpan)
      : clamp(freq * (1 + chirpSpan), 40, rate * 0.42);
  const pan = clamp((rand() * 2 - 1) * stereoWidth, -1, 1);
  const angle = ((pan + 1) * Math.PI) / 4;
  slot.active = true;
  slot.age = 0;
  slot.dur = dur;
  slot.amp = preset.ampScale * ampScale * (0.55 + 0.45 * rand());
  slot.freq = freq;
  slot.freqEnd = freqEnd;
  slot.phase = rand() * TAU;
  slot.noiseState = 0;
  slot.pan = pan;
  slot.panL = Math.cos(angle);
  slot.panR = Math.sin(angle);
  slot.itdFrames =
    itdMs > 0 ? clamp((itdMs * (0.35 + 0.65 * Math.abs(pan)) * rate) / 1000, 0, RING_SIZE - 3) : 0;
  slot.sign = rand() >= 0.5 ? 1 : -1;
  slot.q = preset.qMin + rand() * (preset.qMax - preset.qMin);
  slot.svfAge = 0;
  slot.ic1 = 0;
  slot.ic2 = 0;
};

const writeDelayed = (ring: Float64Array, baseIdx: number, delay: number, val: number): void => {
  const d0 = Math.floor(delay);
  const frac = delay - d0;
  ring[(baseIdx + d0) & RING_MASK] += val * (1 - frac);
  ring[(baseIdx + d0 + 1) & RING_MASK] += val * frac;
};

const stepActiveGrains = (
  pool: GrainSlot[],
  rings: HaasRings,
  preset: TexturePreset,
  rate: number,
  rand: () => number,
  outLR: Float64Array,
): void => {
  const sampler = MODE_SAMPLERS[preset.mode];
  let activeCount = 0;
  for (let k = 0; k < MAX_GRAINS; k++) {
    if (pool[k]!.active) activeCount++;
  }
  const norm = activeCount > 1 ? 1 / Math.sqrt(activeCount * 0.65) : 1;
  const idx = rings.idx;

  for (let k = 0; k < MAX_GRAINS; k++) {
    const slot = pool[k]!;
    if (!slot.active) continue;
    const t = (slot.age + 0.5) / slot.dur;
    const env = lookupHann(t);
    const instHz = slot.freq + (slot.freqEnd - slot.freq) * t;
    const sig = sampler(slot, instHz, t, rate, rand) * env * slot.amp * norm;
    const gL = sig * slot.panL;
    const gR = sig * slot.panR;
    if (slot.pan >= 0) {
      rings.R[idx] += gR;
      writeDelayed(rings.L, idx, slot.itdFrames, gL);
    } else {
      rings.L[idx] += gL;
      writeDelayed(rings.R, idx, slot.itdFrames, gR);
    }
    slot.age++;
    if (slot.age >= slot.dur) slot.active = false;
  }

  outLR[0] = rings.L[idx]!;
  outLR[1] = rings.R[idx]!;
  rings.L[idx] = 0;
  rings.R[idx] = 0;
  rings.idx = (idx + 1) & RING_MASK;
};

interface GranularEngine {
  readonly source: GranularSource;
  readonly preset: TexturePreset;
  readonly pool: GrainSlot[];
  readonly rings: HaasRings;
  readonly slowTurb: TurbulenceNode;
  readonly fastTurb: TurbulenceNode;
  readonly rate: number;
  readonly pitchShift: number;
  readonly invLen: number;
  readonly grainMs: number;
  readonly spread: number;
  readonly burstAmt: number;
  readonly turbAmt: number;
  readonly stereoWidth: number;
  readonly itdMs: number;
  readonly grainRand: () => number;
  readonly turbRand: () => number;
  burstRemaining: number;
  burstCountdown: number;
}

const sampleGranularFrame = (e: GranularEngine, i: number, outLR: Float64Array): void => {
  const u = i * e.invLen;
  const turbVal =
    0.7 * stepTurbulence(e.slowTurb, e.turbRand) + 0.3 * stepTurbulence(e.fastTurb, e.turbRand);
  const turbMod = Math.max(0.15, 1 + e.turbAmt * (turbVal * 2 - 1) * 0.85);
  const baseHz =
    (e.source.pitch !== undefined ? evaluate(e.source.pitch, u) : e.preset.defaultHz) *
    e.pitchShift *
    (1 + e.turbAmt * (turbVal - 0.5) * 0.15);
  const prob = Math.min(0.25, (evaluate(e.source.density, u) * turbMod) / e.rate);

  if (e.grainRand() < prob) {
    spawnGrain(
      e.pool,
      e.preset,
      baseHz,
      e.grainMs,
      e.spread,
      0.7 + 0.3 * turbVal,
      e.stereoWidth,
      e.itdMs,
      e.rate,
      e.grainRand,
    );
    if (e.burstAmt > 0 && e.grainRand() < e.burstAmt) {
      e.burstRemaining = 1 + Math.floor(e.grainRand() * 3);
      e.burstCountdown = Math.round((0.004 + 0.014 * e.grainRand()) * e.rate);
    }
  }
  if (e.burstRemaining > 0 && --e.burstCountdown <= 0) {
    spawnGrain(
      e.pool,
      e.preset,
      baseHz,
      e.grainMs * 0.8,
      e.spread,
      0.65,
      e.stereoWidth,
      e.itdMs,
      e.rate,
      e.grainRand,
    );
    e.burstRemaining--;
    e.burstCountdown = Math.round((0.004 + 0.014 * e.grainRand()) * e.rate);
  }
  stepActiveGrains(e.pool, e.rings, e.preset, e.rate, e.grainRand, outLR);
};

// True-stereo stochastic micro-grain cloud with constant-power pan and 0.1-0.4ms ITD Haas ring.
export const createGranular = (
  source: GranularSource,
  rate: number,
  length: number,
  pitchShift: number,
  grainRand: () => number,
  turbRand: () => number,
): ((i: number, outLR: Float64Array) => void) => {
  const preset = TEXTURE_PRESETS[source.texture];
  const engine: GranularEngine = {
    source,
    preset,
    pool: createGrainPool(),
    rings: { idx: 0, L: new Float64Array(RING_SIZE), R: new Float64Array(RING_SIZE) },
    slowTurb: {
      stepFrames: Math.max(64, Math.round(rate * 0.14)),
      frame: 0,
      prev: turbRand(),
      next: turbRand(),
    },
    fastTurb: {
      stepFrames: Math.max(32, Math.round(rate * 0.045)),
      frame: 0,
      prev: turbRand(),
      next: turbRand(),
    },
    rate,
    pitchShift,
    invLen: 1 / Math.max(1, length - 1),
    grainMs: source.grainMs ?? preset.defaultGrainMs,
    spread: source.spread ?? preset.defaultSpread,
    burstAmt: source.burstiness ?? 0.25,
    turbAmt: source.turbulence ?? 0.3,
    stereoWidth: clamp(source.stereoWidth ?? 0.75, 0, 1),
    itdMs: clamp(source.itdMs ?? 0.28, 0, 0.4),
    grainRand,
    turbRand,
    burstRemaining: 0,
    burstCountdown: 0,
  };
  return (i: number, outLR: Float64Array): void => sampleGranularFrame(engine, i, outLR);
};
