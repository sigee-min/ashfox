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

const ER_TAPS_L = [199, 379, 541, 751, 953, 1201, 1523, 1789] as const;
const ER_TAPS_R = [223, 409, 577, 797, 997, 1249, 1571, 1847] as const;
const AP_LENGTHS_L = [142, 379] as const;
const AP_LENGTHS_R = [173, 419] as const;
const FDN_BASE_DELAYS = [1093, 1327, 1609, 1933, 2269, 2657, 3049, 3491] as const;
const LFO_RATES_HZ = [0.23, 0.29, 0.34, 0.41, 0.47, 0.53, 0.61, 0.67] as const;
const LFO_DEPTH_SAMPLES = [3.2, 4.1, 5.0, 3.7, 5.5, 4.4, 3.5, 4.8] as const;
const INPUT_SIGNS_L = [1, -1, 1, -1, 1, -1, 1, -1] as const;
const INPUT_SIGNS_R = [1, 1, -1, -1, -1, -1, 1, 1] as const;
const INV_SQRT8 = 1 / Math.sqrt(8);
const CROSS_COS = 0.9238795325112867;
const CROSS_SIN = 0.3826834323650898;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

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
  const bufLen = nextPow2(delaySamples + 1);
  const mask = bufLen - 1;
  const buf = new Float64Array(bufLen);
  let idx = 0;
  return (x: number): number => {
    const out = buf[(idx - delaySamples) & mask]!;
    buf[idx] = x;
    idx = (idx + 1) & mask;
    return out;
  };
};

const buildErTapDelays = (taps: readonly number[], size: number, rateScale: number): Int32Array =>
  Int32Array.from(taps, (t) => Math.max(2, Math.round(t * size * rateScale)));

const createStereoEarlyReflections = (
  size: number,
  rate: number,
): ((inL: number, inR: number, out: Float64Array) => void) => {
  const rateScale = rate / 48000;
  const delaysL = buildErTapDelays(ER_TAPS_L, size, rateScale);
  const delaysR = buildErTapDelays(ER_TAPS_R, size, rateScale);
  const maxDelay = Math.max(delaysL[delaysL.length - 1]!, delaysR[delaysR.length - 1]!) + 1;
  const bufLen = nextPow2(maxDelay);
  const mask = bufLen - 1;
  const bufL = new Float64Array(bufLen);
  const bufR = new Float64Array(bufLen);
  const rawGains = ER_TAPS_L.map((_, i) => 0.84 ** i);
  const norm = 1 / Math.sqrt(rawGains.reduce((acc, g) => acc + g * g, 0));
  const ipsi = Float64Array.from(rawGains, (g) => g * norm * 0.92);
  const contra = Float64Array.from(rawGains, (g, i) => g * norm * (i % 2 === 0 ? 0.34 : -0.34));
  let writeIdx = 0;
  return (inL: number, inR: number, out: Float64Array): void => {
    bufL[writeIdx] = inL;
    bufR[writeIdx] = inR;
    let sumL = 0;
    let sumR = 0;
    for (let k = 0; k < 8; k += 1) {
      const sL = bufL[(writeIdx - delaysL[k]!) & mask]!;
      const sR = bufR[(writeIdx - delaysR[k]!) & mask]!;
      sumL += sL * ipsi[k]! + sR * contra[k]!;
      sumR += sR * ipsi[k]! + sL * contra[k]!;
    }
    writeIdx = (writeIdx + 1) & mask;
    out[0] = sumL;
    out[1] = sumR;
  };
};

const createAllPass = (length: number, g: number): ((x: number) => number) => {
  const bufLen = nextPow2(length + 1);
  const mask = bufLen - 1;
  const buf = new Float64Array(bufLen);
  let idx = 0;
  return (x: number): number => {
    const delayed = buf[(idx - length) & mask]!;
    const v = x + g * delayed;
    buf[idx] = v;
    idx = (idx + 1) & mask;
    return delayed - g * v;
  };
};

const createCrossedDiffuser = (
  rate: number,
): ((inL: number, inR: number, out: Float64Array) => void) => {
  const scale = rate / 48000;
  const l1 = createAllPass(Math.max(16, Math.round(AP_LENGTHS_L[0] * scale)), 0.5);
  const l2 = createAllPass(Math.max(16, Math.round(AP_LENGTHS_L[1] * scale)), 0.5);
  const r1 = createAllPass(Math.max(16, Math.round(AP_LENGTHS_R[0] * scale)), 0.5);
  const r2 = createAllPass(Math.max(16, Math.round(AP_LENGTHS_R[1] * scale)), 0.5);
  return (inL: number, inR: number, out: Float64Array): void => {
    const aL = l1(inL);
    const aR = r1(inR);
    out[0] = l2(CROSS_COS * aL + CROSS_SIN * aR);
    out[1] = r2(CROSS_COS * aR - CROSS_SIN * aL);
  };
};

const hadamard8 = (x: Float64Array, out: Float64Array): void => {
  const x0 = x[0]!;
  const x1 = x[1]!;
  const x2 = x[2]!;
  const x3 = x[3]!;
  const x4 = x[4]!;
  const x5 = x[5]!;
  const x6 = x[6]!;
  const x7 = x[7]!;
  const a0 = x0 + x1;
  const a1 = x0 - x1;
  const a2 = x2 + x3;
  const a3 = x2 - x3;
  const a4 = x4 + x5;
  const a5 = x4 - x5;
  const a6 = x6 + x7;
  const a7 = x6 - x7;
  const b0 = a0 + a2;
  const b1 = a1 + a3;
  const b2 = a0 - a2;
  const b3 = a1 - a3;
  const b4 = a4 + a6;
  const b5 = a5 + a7;
  const b6 = a4 - a6;
  const b7 = a5 - a7;
  out[0] = (b0 + b4) * INV_SQRT8;
  out[1] = (b1 + b5) * INV_SQRT8;
  out[2] = (b2 + b6) * INV_SQRT8;
  out[3] = (b3 + b7) * INV_SQRT8;
  out[4] = (b0 - b4) * INV_SQRT8;
  out[5] = (b1 - b5) * INV_SQRT8;
  out[6] = (b2 - b6) * INV_SQRT8;
  out[7] = (b3 - b7) * INV_SQRT8;
};

interface FdnState {
  readonly delays: Int32Array;
  readonly depths: Float64Array;
  readonly masks: Int32Array;
  readonly lines: Float64Array[];
  readonly writeIndices: Int32Array;
  readonly lfoS: Float64Array;
  readonly lfoC: Float64Array;
  readonly lfoEps: Float64Array;
  readonly lp: Float64Array;
  readonly hpState: Float64Array;
  readonly y: Float64Array;
  readonly mixed: Float64Array;
  readonly gains: Float64Array;
  readonly damp: number;
  readonly hpAlpha: number;
}

const initFdnState = (params: SpaceParams, rate: number): FdnState => {
  const rateScale = rate / 48000;
  const sizeScale = (0.35 + 0.65 * params.size) * rateScale;
  const delays = Int32Array.from(FDN_BASE_DELAYS, (d) => Math.max(32, Math.round(d * sizeScale)));
  const depths = Float64Array.from(LFO_DEPTH_SAMPLES, (d, i) =>
    Math.min(d * rateScale, delays[i]! * 0.25),
  );
  const masks = new Int32Array(8);
  const lines: Float64Array[] = [];
  const lfoS = new Float64Array(8);
  const lfoC = new Float64Array(8);
  const lfoEps = new Float64Array(8);
  for (let k = 0; k < 8; k += 1) {
    const bufLen = nextPow2(delays[k]! + Math.ceil(depths[k]!) + 4);
    masks[k] = bufLen - 1;
    lines.push(new Float64Array(bufLen));
    const phi0 = (k * Math.PI) / 4;
    const w = (2 * Math.PI * LFO_RATES_HZ[k]!) / rate;
    lfoEps[k] = 2 * Math.sin(w * 0.5);
    lfoS[k] = Math.sin(phi0);
    lfoC[k] = Math.cos(phi0 - w * 0.5);
  }
  return {
    delays,
    depths,
    masks,
    lines,
    writeIndices: new Int32Array(8),
    lfoS,
    lfoC,
    lfoEps,
    lp: new Float64Array(8),
    hpState: new Float64Array(8),
    y: new Float64Array(8),
    mixed: new Float64Array(8),
    gains: Float64Array.from(delays, (len) => 10 ** ((-3 * len) / (params.decay * rate))),
    damp: 1 - Math.exp((-2 * Math.PI * params.damping) / rate),
    hpAlpha: 1 - Math.exp((-2 * Math.PI * 120) / rate),
  };
};

const stepFdn8 = (st: FdnState, inL: number, inR: number, out: Float64Array): void => {
  for (let k = 0; k < 8; k += 1) {
    const mask = st.masks[k]!;
    const s = st.lfoS[k]! + st.lfoEps[k]! * st.lfoC[k]!;
    st.lfoC[k] = st.lfoC[k]! - st.lfoEps[k]! * s;
    st.lfoS[k] = s;
    const readPos = st.writeIndices[k]! - (st.delays[k]! + st.depths[k]! * s);
    const r0 = Math.floor(readPos);
    const frac = readPos - r0;
    const i0 = r0 & mask;
    const line = st.lines[k]!;
    st.y[k] = line[i0]! * (1 - frac) + line[(i0 + 1) & mask]! * frac;
  }
  hadamard8(st.y, st.mixed);
  for (let k = 0; k < 8; k += 1) {
    st.lp[k] = st.lp[k]! + st.damp * (st.mixed[k]! * st.gains[k]! - st.lp[k]!);
    st.hpState[k] = st.hpState[k]! + st.hpAlpha * (st.lp[k]! - st.hpState[k]!);
    const fb = st.lp[k]! - st.hpState[k]!;
    const inj = (inL * INPUT_SIGNS_L[k]! + inR * INPUT_SIGNS_R[k]!) * INV_SQRT8;
    const wIdx = st.writeIndices[k]!;
    st.lines[k]![wIdx] = inj + fb;
    st.writeIndices[k] = (wIdx + 1) & st.masks[k]!;
  }
  const y = st.y;
  out[0] = 0.5 * (y[0]! - y[1]! + y[2]! - y[3]! + y[4]! - y[5]! + y[6]! - y[7]!);
  out[1] = 0.5 * (y[0]! + y[1]! - y[2]! - y[3]! - y[4]! - y[5]! + y[6]! + y[7]!);
};

/** Deterministic True-Stereo ER + crossed all-pass diffuser + dual-input FDN-8 stereo space. */
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
  const preDelayL = createPreDelay(params.preDelayMs, rate);
  const preDelayR = createPreDelay(params.preDelayMs, rate);
  const early = createStereoEarlyReflections(params.size, rate);
  const diffuse = createCrossedDiffuser(rate);
  const fdn = initFdnState(params, rate);
  const erOut = new Float64Array(2);
  const diffOut = new Float64Array(2);
  const fdnOut = new Float64Array(2);
  const out = new Float64Array(pcm.length);
  const dry = Math.cos(params.mix * Math.PI * 0.5);
  const wet = Math.sin(params.mix * Math.PI * 0.5);

  for (let i = 0; i < frames; i += 1) {
    const lIn = pcm[i * channels]!;
    const rIn = channels === 2 ? pcm[i * 2 + 1]! : lIn;
    const preL = preDelayL(lIn);
    const preR = preDelayR(rIn);
    early(preL, preR, erOut);
    diffuse(preL, preR, diffOut);
    stepFdn8(fdn, diffOut[0]!, diffOut[1]!, fdnOut);
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
