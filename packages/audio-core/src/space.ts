import type { SpacePreset, SpaceSpec } from './contract';

interface SpaceParams {
  readonly mix: number;
  readonly decay: number;
  readonly damping: number;
  readonly size: number;
  readonly preDelayMs: number;
  readonly width: number;
  readonly erGain: number;
  readonly fdnGain: number;
}

const SPACE_DEFAULTS: Record<SpacePreset, SpaceParams> = {
  dry_close: {
    mix: 0.08,
    decay: 0.12,
    damping: 8000,
    size: 0.35,
    preDelayMs: 2,
    width: 0.6,
    erGain: 0.65,
    fdnGain: 0.35,
  },
  timber_room: {
    mix: 0.22,
    decay: 0.38,
    damping: 4500,
    size: 0.65,
    preDelayMs: 8,
    width: 0.9,
    erGain: 0.55,
    fdnGain: 0.55,
  },
  stone_hall: {
    mix: 0.34,
    decay: 1.15,
    damping: 5500,
    size: 1.25,
    preDelayMs: 18,
    width: 1.1,
    erGain: 0.45,
    fdnGain: 0.72,
  },
  small_chamber: {
    mix: 0.25,
    decay: 0.52,
    damping: 6200,
    size: 0.55,
    preDelayMs: 6,
    width: 0.85,
    erGain: 0.58,
    fdnGain: 0.58,
  },
  courtyard: {
    mix: 0.2,
    decay: 0.65,
    damping: 7200,
    size: 1.45,
    preDelayMs: 24,
    width: 1.15,
    erGain: 0.6,
    fdnGain: 0.45,
  },
  cavern: {
    mix: 0.42,
    decay: 1.45,
    damping: 3200,
    size: 1.65,
    preDelayMs: 28,
    width: 1.2,
    erGain: 0.42,
    fdnGain: 0.78,
  },
  ethereal: {
    mix: 0.48,
    decay: 1.5,
    damping: 9500,
    size: 1.5,
    preDelayMs: 22,
    width: 1.35,
    erGain: 0.35,
    fdnGain: 0.82,
  },
};

const FALLBACK_SPACE: SpaceParams = {
  mix: 0,
  decay: 0.4,
  damping: 5500,
  size: 0.8,
  preDelayMs: 8,
  width: 1.0,
  erGain: 0.5,
  fdnGain: 0.6,
};

const ER_BASE_TAPS = [199, 379, 541, 751, 953, 1201, 1523, 1789] as const;
const ER_PAN = [-0.85, 0.72, -0.55, 0.9, -0.35, 0.48, -0.75, 0.62] as const;
const AP_BASE_LENGTHS = [142, 379] as const;
const FDN_BASE_DELAYS = [1093, 1327, 1609, 1933, 2269, 2657, 3049, 3491] as const;
const LFO_RATES_HZ = [0.23, 0.29, 0.34, 0.41, 0.47, 0.53, 0.61, 0.67] as const;
const LFO_DEPTH_SAMPLES = [3.2, 4.1, 5.0, 3.7, 5.5, 4.4, 3.5, 4.8] as const;
const INPUT_SIGNS = [1, -1, 1, -1, 1, -1, 1, -1] as const;
const INV_SQRT8 = 1 / Math.sqrt(8);

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const resolveSpaceParams = (space: SpaceSpec, rate: number): SpaceParams => {
  const base = space.preset ? SPACE_DEFAULTS[space.preset] : FALLBACK_SPACE;
  return {
    mix: clamp(space.mix ?? base.mix, 0, 1),
    decay: Math.max(0.01, space.decay ?? base.decay),
    damping: clamp(space.damping ?? base.damping, 200, rate * 0.45),
    size: clamp(space.size ?? base.size, 0.15, 2.5),
    preDelayMs: clamp(space.preDelayMs ?? base.preDelayMs, 0, 80),
    width: clamp(space.width ?? base.width, 0, 1.5),
    erGain: base.erGain,
    fdnGain: base.fdnGain,
  };
};

const createPreDelay = (preDelayMs: number, rate: number): ((x: number) => number) => {
  const delaySamples = Math.min(
    Math.round((80 * rate) / 1000),
    Math.max(0, Math.round((preDelayMs * rate) / 1000)),
  );
  if (delaySamples === 0) return (x) => x;
  const buf = new Float64Array(delaySamples);
  let idx = 0;
  return (x: number): number => {
    const out = buf[idx]!;
    buf[idx] = x;
    idx = (idx + 1) % delaySamples;
    return out;
  };
};

const createEarlyReflections = (
  size: number,
  rate: number,
): ((x: number, out: Float64Array) => void) => {
  const rateScale = rate / 48000;
  const tapDelays = ER_BASE_TAPS.map((t) => Math.max(2, Math.round(t * size * rateScale)));
  const maxDelay = tapDelays[tapDelays.length - 1]! + 1;
  const buf = new Float64Array(maxDelay);
  const rawGains = tapDelays.map((_, i) => 0.84 ** i);
  const norm = 1 / Math.sqrt(rawGains.reduce((acc, g) => acc + g * g, 0));
  const tapL = rawGains.map((g, i) => g * norm * Math.cos(((ER_PAN[i]! + 1) * Math.PI) / 4));
  const tapR = rawGains.map((g, i) => g * norm * Math.sin(((ER_PAN[i]! + 1) * Math.PI) / 4));
  let writeIdx = 0;
  return (x: number, out: Float64Array): void => {
    buf[writeIdx] = x;
    let sumL = 0;
    let sumR = 0;
    for (let k = 0; k < tapDelays.length; k += 1) {
      const readIdx = (writeIdx - tapDelays[k]! + maxDelay) % maxDelay;
      const sample = buf[readIdx]!;
      sumL += sample * tapL[k]!;
      sumR += sample * tapR[k]!;
    }
    writeIdx = (writeIdx + 1) % maxDelay;
    out[0] = sumL;
    out[1] = sumR;
  };
};

const createAllPass = (length: number, g: number): ((x: number) => number) => {
  const buf = new Float64Array(length);
  let idx = 0;
  return (x: number): number => {
    const delayed = buf[idx]!;
    const v = x + g * delayed;
    buf[idx] = v;
    idx = (idx + 1) % length;
    return delayed - g * v;
  };
};

const createDiffuser = (rate: number): ((x: number) => number) => {
  const scale = rate / 48000;
  const stages = AP_BASE_LENGTHS.map((len) =>
    createAllPass(Math.max(16, Math.round(len * scale)), 0.5),
  );
  return (x: number): number => {
    let y = x;
    for (let i = 0; i < stages.length; i += 1) y = stages[i]!(y);
    return y;
  };
};

const hadamard8 = (x: Float64Array, out: Float64Array): void => {
  for (let i = 0; i < 8; i += 1) out[i] = x[i]!;
  for (let stride = 1; stride < 8; stride <<= 1) {
    for (let i = 0; i < 8; i += stride << 1) {
      for (let j = 0; j < stride; j += 1) {
        const a = out[i + j]!;
        const b = out[i + j + stride]!;
        out[i + j] = a + b;
        out[i + j + stride] = a - b;
      }
    }
  }
  for (let i = 0; i < 8; i += 1) out[i] = out[i]! * INV_SQRT8;
};

const createFdn8 = (
  params: SpaceParams,
  rate: number,
): ((x: number, out: Float64Array) => void) => {
  const rateScale = rate / 48000;
  const sizeScale = (0.35 + 0.65 * params.size) * rateScale;
  const delays = FDN_BASE_DELAYS.map((d) => Math.max(32, Math.round(d * sizeScale)));
  const depths = LFO_DEPTH_SAMPLES.map((d, i) => Math.min(d * rateScale, delays[i]! * 0.25));
  const bufLens = delays.map((d, i) => d + Math.ceil(depths[i]!) + 4);
  const lines = bufLens.map((len) => new Float64Array(len));
  const writeIndices = new Int32Array(8);
  const phases = new Float64Array(8);
  for (let k = 0; k < 8; k += 1) phases[k] = (k * Math.PI) / 4;
  const phaseInc = LFO_RATES_HZ.map((hz) => (2 * Math.PI * hz) / rate);
  const lp = new Float64Array(8);
  const hpState = new Float64Array(8);
  const y = new Float64Array(8);
  const mixed = new Float64Array(8);
  const damp = 1 - Math.exp((-2 * Math.PI * params.damping) / rate);
  const hpAlpha = 1 - Math.exp((-2 * Math.PI * 120) / rate);
  const gains = delays.map((len) => 10 ** ((-3 * len) / (params.decay * rate)));

  return (x: number, out: Float64Array): void => {
    for (let k = 0; k < 8; k += 1) {
      const len = bufLens[k]!;
      const readPos = writeIndices[k]! - (delays[k]! + depths[k]! * Math.sin(phases[k]!));
      const r0 = Math.floor(readPos);
      const frac = readPos - r0;
      const i0 = ((r0 % len) + len) % len;
      const i1 = (i0 + 1) % len;
      y[k] = lines[k]![i0]! * (1 - frac) + lines[k]![i1]! * frac;
      phases[k] = (phases[k]! + phaseInc[k]!) % (2 * Math.PI);
    }
    hadamard8(y, mixed);
    for (let k = 0; k < 8; k += 1) {
      lp[k] = lp[k]! + damp * (mixed[k]! * gains[k]! - lp[k]!);
      hpState[k] = hpState[k]! + hpAlpha * (lp[k]! - hpState[k]!);
      const fb = lp[k]! - hpState[k]!;
      lines[k]![writeIndices[k]!] = x * INPUT_SIGNS[k]! * INV_SQRT8 + fb;
      writeIndices[k] = (writeIndices[k]! + 1) % bufLens[k]!;
    }
    out[0] = 0.5 * (y[0]! - y[1]! + y[2]! - y[3]! + y[4]! - y[5]! + y[6]! - y[7]!);
    out[1] = 0.5 * (y[0]! + y[1]! - y[2]! - y[3]! - y[4]! - y[5]! + y[6]! + y[7]!);
  };
};

/** Deterministic ER + 2-stage Schroeder diffuser + modulated FDN-8 stereo space. */
export const applySpace = (
  pcm: Float64Array,
  channels: 1 | 2,
  rate: number,
  space: SpaceSpec | undefined,
): Float64Array => {
  if (!space) return pcm;
  const params = resolveSpaceParams(space, rate);
  if (params.mix === 0) return pcm;
  const frames = pcm.length / channels;
  const preDelay = createPreDelay(params.preDelayMs, rate);
  const early = createEarlyReflections(params.size, rate);
  const diffuse = createDiffuser(rate);
  const fdn = createFdn8(params, rate);
  const erOut = new Float64Array(2);
  const fdnOut = new Float64Array(2);
  const out = new Float64Array(pcm.length);
  const dry = Math.cos(params.mix * Math.PI * 0.5);
  const wet = Math.sin(params.mix * Math.PI * 0.5);

  for (let i = 0; i < frames; i += 1) {
    const lIn = pcm[i * channels]!;
    const rIn = channels === 2 ? pcm[i * channels + 1]! : lIn;
    const pre = preDelay(0.5 * (lIn + rIn));
    early(pre, erOut);
    fdn(diffuse(pre), fdnOut);
    const wetL = params.erGain * erOut[0]! + params.fdnGain * fdnOut[0]!;
    const wetR = params.erGain * erOut[1]! + params.fdnGain * fdnOut[1]!;
    const mid = 0.5 * (wetL + wetR);
    const side = 0.5 * (wetL - wetR) * params.width;
    if (channels === 1) {
      out[i] = dry * lIn + wet * mid;
    } else {
      out[i * 2] = dry * lIn + wet * (mid + side);
      out[i * 2 + 1] = dry * rIn + wet * (mid - side);
    }
  }
  return out;
};
