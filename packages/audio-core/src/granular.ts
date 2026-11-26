import type { GranularSource, GranularTexture } from './contract';
import { evaluate } from './curve';

const TAU = Math.PI * 2;
const MAX_GRAINS = 24;

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
  panBias: number;
  q: number;
  ic1: number;
  ic2: number;
}

interface TurbulenceNode {
  readonly stepFrames: number;
  frame: number;
  prev: number;
  next: number;
}

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
  const clamped = Math.max(30, Math.min(rate * 0.44, hz));
  const g = Math.tan((Math.PI * clamped) / rate);
  const k = 1 / Math.max(0.5, slot.q);
  const a1 = 1 / (1 + g * (g + k));
  const a2 = g * a1;
  const a3 = g * a2;
  const v3 = x - slot.ic2;
  const v1 = a1 * slot.ic1 + a2 * v3;
  const v2 = slot.ic2 + a2 * slot.ic1 + a3 * v3;
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
  bubble: (slot, instHz, _t, rate) => {
    slot.phase = (slot.phase + (TAU * instHz) / rate) % TAU;
    return Math.sin(slot.phase);
  },
  spark: (slot, instHz, _t, rate, rand) => {
    slot.phase = (slot.phase + (TAU * instHz) / rate) % TAU;
    const fm = Math.sin(slot.phase + 1.45 * Math.sin(slot.phase * 2.71));
    return fm * 0.8 + (rand() * 2 - 1) * 0.25;
  },
  crackle: (slot, instHz, t, rate, rand) => {
    const white = rand() * 2 - 1;
    const snap = t < 0.16 ? (1 - t / 0.16) * (slot.panBias >= 0 ? 1 : -1) * 0.9 : 0;
    const sizzle = stepBandpass(slot, white, instHz, rate) * 1.4;
    return snap + sizzle;
  },
  droplet: (slot, instHz, _t, rate, rand) => {
    slot.phase = (slot.phase + (TAU * instHz) / rate) % TAU;
    const ping = Math.sin(slot.phase) * 0.6;
    const spray = stepBandpass(slot, rand() * 2 - 1, instHz * 1.35, rate) * 0.7;
    return ping + spray;
  },
  bandpass: (slot, instHz, _t, rate, rand) =>
    stepBandpass(slot, rand() * 2 - 1, instHz, rate) * 1.5,
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
    panBias: 0,
    q: 2,
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
  rate: number,
  rand: () => number,
): void => {
  const slot = pool.find((g) => !g.active);
  if (!slot) return;
  const durMs =
    preset.mode === 'bubble'
      ? Math.max(15, Math.min(55, grainMs * (0.65 + rand() * 0.7)))
      : grainMs * (0.65 + rand() * 0.7);
  const dur = Math.max(16, Math.min(Math.round(rate * 0.25), Math.round((durMs * rate) / 1000)));
  const freq = Math.max(40, Math.min(rate * 0.42, baseHz * Math.pow(2, (rand() * 2 - 1) * spread)));
  const chirpSpan = preset.chirpMin + rand() * (preset.chirpMax - preset.chirpMin);
  const freqEnd =
    preset.mode === 'bubble'
      ? Math.min(rate * 0.42, freq + chirpSpan)
      : Math.max(40, Math.min(rate * 0.42, freq * (1 + chirpSpan)));
  slot.active = true;
  slot.age = 0;
  slot.dur = dur;
  slot.amp = preset.ampScale * ampScale * (0.55 + 0.45 * rand());
  slot.freq = freq;
  slot.freqEnd = freqEnd;
  slot.phase = rand() * TAU;
  slot.noiseState = 0;
  slot.panBias = rand() * 2 - 1;
  slot.q = preset.qMin + rand() * (preset.qMax - preset.qMin);
  slot.ic1 = 0;
  slot.ic2 = 0;
};

const stepActiveGrains = (
  pool: GrainSlot[],
  preset: TexturePreset,
  rate: number,
  rand: () => number,
): number => {
  const sampler = MODE_SAMPLERS[preset.mode];
  let sum = 0;
  let activeCount = 0;
  for (let k = 0; k < MAX_GRAINS; k++) {
    const slot = pool[k]!;
    if (!slot.active) continue;
    activeCount++;
    const t = (slot.age + 0.5) / slot.dur;
    const env = 0.5 * (1 - Math.cos(TAU * t));
    const instHz = slot.freq + (slot.freqEnd - slot.freq) * t;
    const raw = sampler(slot, instHz, t, rate, rand);
    sum += raw * env * slot.amp * (1 + slot.panBias * 0.12);
    slot.age++;
    if (slot.age >= slot.dur) slot.active = false;
  }
  return activeCount > 1 ? sum / Math.sqrt(activeCount * 0.65) : sum;
};

// Stochastic micro-grain cloud with value-noise turbulence and burst clustering.
export const createGranular = (
  source: GranularSource,
  rate: number,
  length: number,
  pitchShift: number,
  grainRand: () => number,
  turbRand: () => number,
): ((i: number) => number) => {
  const preset = TEXTURE_PRESETS[source.texture];
  const pool = createGrainPool();
  const grainMs = source.grainMs ?? preset.defaultGrainMs;
  const spread = source.spread ?? preset.defaultSpread;
  const burstAmt = source.burstiness ?? 0.25;
  const turbAmt = source.turbulence ?? 0.3;
  const slowTurb: TurbulenceNode = {
    stepFrames: Math.max(64, Math.round(rate * 0.14)),
    frame: 0,
    prev: turbRand(),
    next: turbRand(),
  };
  const fastTurb: TurbulenceNode = {
    stepFrames: Math.max(32, Math.round(rate * 0.045)),
    frame: 0,
    prev: turbRand(),
    next: turbRand(),
  };
  const invLen = 1 / Math.max(1, length - 1);
  let burstRemaining = 0;
  let burstCountdown = 0;

  return (i: number): number => {
    const u = i * invLen;
    const turbVal =
      0.7 * stepTurbulence(slowTurb, turbRand) + 0.3 * stepTurbulence(fastTurb, turbRand);
    const turbMod = Math.max(0.15, 1 + turbAmt * (turbVal * 2 - 1) * 0.85);
    const baseHz =
      (source.pitch !== undefined ? evaluate(source.pitch, u) : preset.defaultHz) *
      pitchShift *
      (1 + turbAmt * (turbVal - 0.5) * 0.15);
    const prob = Math.min(0.25, (evaluate(source.density, u) * turbMod) / rate);

    if (grainRand() < prob) {
      spawnGrain(pool, preset, baseHz, grainMs, spread, 0.7 + 0.3 * turbVal, rate, grainRand);
      if (burstAmt > 0 && grainRand() < burstAmt) {
        burstRemaining = 1 + Math.floor(grainRand() * 3);
        burstCountdown = Math.round((0.004 + 0.014 * grainRand()) * rate);
      }
    }
    if (burstRemaining > 0 && --burstCountdown <= 0) {
      spawnGrain(pool, preset, baseHz, grainMs * 0.8, spread, 0.65, rate, grainRand);
      burstRemaining--;
      burstCountdown = Math.round((0.004 + 0.014 * grainRand()) * rate);
    }
    return stepActiveGrains(pool, preset, rate, grainRand);
  };
};
