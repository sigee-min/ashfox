import type { MasterSpec } from './contract';

interface BiquadCoeffs {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const stepBiquad = (s: Float64Array, c: BiquadCoeffs, x: number): number => {
  const y = c.b0 * x + c.b1 * s[0]! + c.b2 * s[1]! - c.a1 * s[2]! - c.a2 * s[3]!;
  s[1] = s[0]!;
  s[0] = x;
  s[3] = s[2]!;
  s[2] = y;
  return y;
};

const butterworthHpfCoeffs = (hz: number, rate: number): BiquadCoeffs => {
  const w0 = (2 * Math.PI * hz) / rate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cosW0) * 0.5) / a0,
    b1: -(1 + cosW0) / a0,
    b2: ((1 + cosW0) * 0.5) / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
};

const shelfCoeffs = (
  kind: 'low' | 'high',
  hz: number,
  dbGain: number,
  rate: number,
): BiquadCoeffs => {
  const amp = 10 ** (dbGain / 40);
  const w0 = (2 * Math.PI * hz) / rate;
  const cosW0 = Math.cos(w0);
  const beta = 2 * Math.sqrt(amp) * Math.sin(w0) * Math.SQRT1_2;
  const s = kind === 'low' ? 1 : -1;
  const a0 = amp + 1 + s * (amp - 1) * cosW0 + beta;
  return {
    b0: (amp * (amp + 1 - s * (amp - 1) * cosW0 + beta)) / a0,
    b1: (s * 2 * amp * (amp - 1 - s * (amp + 1) * cosW0)) / a0,
    b2: (amp * (amp + 1 - s * (amp - 1) * cosW0 - beta)) / a0,
    a1: (-s * 2 * (amp - 1 + s * (amp + 1) * cosW0)) / a0,
    a2: (amp + 1 + s * (amp - 1) * cosW0 - beta) / a0,
  };
};

const softKneeGainDb = (over: number, ratio: number, knee: number): number => {
  const half = knee * 0.5;
  if (over <= -half) return 0;
  const slope = 1 / ratio - 1;
  if (over >= half) return slope * over;
  const t = over + half;
  return (slope * t * t) / (2 * knee);
};

const kWeightStages = (rate: number): readonly [BiquadCoeffs, BiquadCoeffs] => {
  const kShelf = Math.tan((Math.PI * 1681.974450955533) / rate);
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const qShelf = 0.7071752369554196;
  const a0S = 1 + kShelf / qShelf + kShelf * kShelf;
  const shelf: BiquadCoeffs = {
    b0: (vh + (vb * kShelf) / qShelf + kShelf * kShelf) / a0S,
    b1: (2 * (kShelf * kShelf - vh)) / a0S,
    b2: (vh - (vb * kShelf) / qShelf + kShelf * kShelf) / a0S,
    a1: (2 * (kShelf * kShelf - 1)) / a0S,
    a2: (1 - kShelf / qShelf + kShelf * kShelf) / a0S,
  };
  const kRlb = Math.tan((Math.PI * 38.13547087602444) / rate);
  const qRlb = 0.5003270373238773;
  const a0R = 1 + kRlb / qRlb + kRlb * kRlb;
  const rlb: BiquadCoeffs = {
    b0: 1 / a0R,
    b1: -2 / a0R,
    b2: 1 / a0R,
    a1: (2 * (kRlb * kRlb - 1)) / a0R,
    a2: (1 - kRlb / qRlb + kRlb * kRlb) / a0R,
  };
  return [shelf, rlb];
};

interface Conditioner {
  readonly hpfC: BiquadCoeffs;
  readonly hpf0: Float64Array;
  readonly hpf1: Float64Array;
  readonly punch: number;
  readonly attFast: number;
  readonly relFast: number;
  readonly attSlow: number;
  readonly relSlow: number;
  fast: number;
  slow: number;
  readonly glue: number;
  readonly glueAtt: number;
  readonly glueRel: number;
  readonly glueRatio: number;
  readonly glueMakeup: number;
  glueEnv: number;
  readonly warmC: BiquadCoeffs | null;
  readonly warm0: Float64Array;
  readonly warm1: Float64Array;
  readonly airC: BiquadCoeffs | null;
  readonly air0: Float64Array;
  readonly air1: Float64Array;
  readonly width: number;
  readonly lpAlpha: number;
  bassSide: number;
  readonly kShelfC: BiquadCoeffs;
  readonly kRlbC: BiquadCoeffs;
  readonly kS0: Float64Array;
  readonly kR0: Float64Array;
  readonly kS1: Float64Array;
  readonly kR1: Float64Array;
}

const initConditioner = (policy: MasterSpec, rate: number): Conditioner => {
  const warmth = clamp(policy.warmth ?? 0, -1, 1);
  const air = clamp(policy.air ?? 0, -1, 1);
  const glue = clamp(policy.glue ?? 0, 0, 1);
  const [kShelfC, kRlbC] = kWeightStages(rate);
  return {
    hpfC: butterworthHpfCoeffs(20, rate),
    hpf0: new Float64Array(4),
    hpf1: new Float64Array(4),
    punch: clamp(policy.punch ?? 0, -1, 1),
    attFast: Math.exp(-1 / (0.002 * rate)),
    relFast: Math.exp(-1 / (0.012 * rate)),
    attSlow: Math.exp(-1 / (0.02 * rate)),
    relSlow: Math.exp(-1 / (0.12 * rate)),
    fast: 0,
    slow: 0,
    glue,
    glueAtt: Math.exp(-1 / (0.01 * rate)),
    glueRel: Math.exp(-1 / (0.11 * rate)),
    glueRatio: 1 + glue * 3,
    glueMakeup: 10 ** ((glue * 1.5) / 20),
    glueEnv: 0,
    warmC: warmth !== 0 ? shelfCoeffs('low', 180, warmth * 4.5, rate) : null,
    warm0: new Float64Array(4),
    warm1: new Float64Array(4),
    airC: air !== 0 ? shelfCoeffs('high', 6500, air * 4.5, rate) : null,
    air0: new Float64Array(4),
    air1: new Float64Array(4),
    width: clamp(policy.width ?? 1, 0, 1.5),
    lpAlpha: 1 - Math.exp((-2 * Math.PI * 150) / rate),
    bassSide: 0,
    kShelfC,
    kRlbC,
    kS0: new Float64Array(4),
    kR0: new Float64Array(4),
    kS1: new Float64Array(4),
    kR1: new Float64Array(4),
  };
};

const stepPunchAndGlue = (st: Conditioner, peak: number, rms: number): number => {
  let gain = 1;
  if (st.punch !== 0) {
    const cf = peak > st.fast ? st.attFast : st.relFast;
    const cs = peak > st.slow ? st.attSlow : st.relSlow;
    st.fast = cf * st.fast + (1 - cf) * peak;
    st.slow = cs * st.slow + (1 - cs) * peak;
    const diff = clamp((st.fast - st.slow) / (st.slow + 0.02), -0.5, 1.5);
    gain = Math.max(0.1, 1 + st.punch * 1.4 * diff);
  }
  if (st.glue > 0) {
    const det = 0.5 * (peak * gain + rms * gain);
    const coeff = det > st.glueEnv ? st.glueAtt : st.glueRel;
    st.glueEnv = coeff * st.glueEnv + (1 - coeff) * det;
    const grDb = softKneeGainDb(20 * Math.log10(Math.max(st.glueEnv, 1e-12)) + 14, st.glueRatio, 6);
    gain *= 10 ** (grDb / 20) * st.glueMakeup;
  }
  return gain;
};

const runMonoConditioning = (
  work: Float64Array,
  st: Conditioner,
  power: Float64Array | null,
): void => {
  for (let i = 0; i < work.length; i += 1) {
    let x = stepBiquad(st.hpf0, st.hpfC, work[i]!);
    const mag = Math.abs(x);
    x *= stepPunchAndGlue(st, mag, mag);
    if (st.warmC) x = stepBiquad(st.warm0, st.warmC, x);
    if (st.airC) x = stepBiquad(st.air0, st.airC, x);
    work[i] = x;
    if (power) {
      const k0 = stepBiquad(st.kR0, st.kRlbC, stepBiquad(st.kS0, st.kShelfC, x));
      power[i] = k0 * k0;
    }
  }
};

const runStereoConditioning = (
  work: Float64Array,
  st: Conditioner,
  power: Float64Array | null,
): void => {
  const frames = work.length / 2;
  for (let i = 0; i < frames; i += 1) {
    let l = stepBiquad(st.hpf0, st.hpfC, work[i * 2]!);
    let r = stepBiquad(st.hpf1, st.hpfC, work[i * 2 + 1]!);
    const dynGain = stepPunchAndGlue(
      st,
      Math.max(Math.abs(l), Math.abs(r)),
      Math.hypot(l, r) * Math.SQRT1_2,
    );
    l *= dynGain;
    r *= dynGain;
    if (st.warmC) {
      l = stepBiquad(st.warm0, st.warmC, l);
      r = stepBiquad(st.warm1, st.warmC, r);
    }
    if (st.airC) {
      l = stepBiquad(st.air0, st.airC, l);
      r = stepBiquad(st.air1, st.airC, r);
    }
    const mid = 0.5 * (l + r);
    const side = 0.5 * (l - r);
    st.bassSide += st.lpAlpha * (side - st.bassSide);
    const highSide = (side - st.bassSide) * st.width;
    const outL = mid + highSide;
    const outR = mid - highSide;
    work[i * 2] = outL;
    work[i * 2 + 1] = outR;
    if (power) {
      const k0 = stepBiquad(st.kR0, st.kRlbC, stepBiquad(st.kS0, st.kShelfC, outL));
      const k1 = stepBiquad(st.kR1, st.kRlbC, stepBiquad(st.kS1, st.kShelfC, outR));
      power[i] = k0 * k0 + k1 * k1;
    }
  }
};

const collectAbsBlocks = (power: Float64Array, blockLen: number, hop: number): number[] => {
  const absGate = 10 ** ((-70 + 0.691) / 10);
  const blocks: number[] = [];
  for (let start = 0; start + blockLen <= power.length; start += hop) {
    let sum = 0;
    for (let j = 0; j < blockLen; j += 1) sum += power[start + j]!;
    const ms = sum / blockLen;
    if (ms > absGate) blocks.push(ms);
  }
  return blocks;
};

const gatedMeanSquare = (blocks: readonly number[]): number => {
  let absMean = 0;
  for (let i = 0; i < blocks.length; i += 1) absMean += blocks[i]!;
  absMean /= blocks.length;
  const relGate = absMean * 0.1;
  let gatedSum = 0;
  let gatedCount = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i]! <= relGate) continue;
    gatedSum += blocks[i]!;
    gatedCount += 1;
  }
  return gatedCount > 0 ? gatedSum / gatedCount : absMean;
};

const measurePowerLufs = (power: Float64Array, rate: number): number => {
  const blockLen = Math.max(1, Math.round(0.4 * rate));
  if (power.length < blockLen) {
    let total = 0;
    for (let i = 0; i < power.length; i += 1) total += power[i]!;
    const mean = total / Math.max(1, power.length);
    return mean > 1e-16 ? -0.691 + 10 * Math.log10(mean) : -Infinity;
  }
  const blocks = collectAbsBlocks(power, blockLen, Math.max(1, Math.round(0.1 * rate)));
  if (blocks.length === 0) return -Infinity;
  const finalMs = gatedMeanSquare(blocks);
  return finalMs > 1e-16 ? -0.691 + 10 * Math.log10(finalMs) : -Infinity;
};

const buildSincPhase = (frac: number): Float64Array => {
  const kernel = new Float64Array(12);
  let sum = 0;
  for (let t = 0; t < 12; t += 1) {
    const m = t - 5;
    const x = m - frac;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const u = (t + 0.5) / 12;
    const blackman = 0.42 - 0.5 * Math.cos(2 * Math.PI * u) + 0.08 * Math.cos(4 * Math.PI * u);
    const w = sinc * blackman;
    kernel[t] = w;
    sum += w;
  }
  for (let t = 0; t < 12; t += 1) kernel[t] = kernel[t]! / sum;
  return kernel;
};

const TRUE_PEAK_PHASES: readonly Float64Array[] = [
  buildSincPhase(0.25),
  buildSincPhase(0.5),
  buildSincPhase(0.75),
];

const channelTruePeak = (
  buf: Float64Array,
  channels: 1 | 2,
  frames: number,
  frameIdx: number,
  ch: number,
  fastThresh: number,
): number => {
  const peak0 = Math.abs(buf[frameIdx * channels + ch]!);
  const next = frameIdx + 1 < frames ? Math.abs(buf[(frameIdx + 1) * channels + ch]!) : 0;
  if (peak0 <= fastThresh && next <= fastThresh) return peak0;
  let peak = peak0;
  for (const kernel of TRUE_PEAK_PHASES) {
    let sum = 0;
    for (let t = 0; t < 12; t += 1) {
      const idx = clamp(frameIdx + t - 5, 0, frames - 1);
      sum += buf[idx * channels + ch]! * kernel[t]!;
    }
    const mag = Math.abs(sum);
    if (mag > peak) peak = mag;
  }
  return peak;
};

const computeLimiterGain = (
  buf: Float64Array,
  channels: 1 | 2,
  rate: number,
  safeCeiling: number,
): Float64Array => {
  const frames = buf.length / channels;
  const lookahead = Math.max(1, Math.round(0.003 * rate));
  const slope = 1 / lookahead;
  const fastThresh = safeCeiling * 0.65;
  const gBack = new Float64Array(frames);
  let future = 1;
  for (let i = frames - 1; i >= 0; i -= 1) {
    const l = channelTruePeak(buf, channels, frames, i, 0, fastThresh);
    const r = channels === 2 ? channelTruePeak(buf, channels, frames, i, 1, fastThresh) : l;
    const peak = Math.max(l, r);
    const req = peak > safeCeiling ? safeCeiling / peak : 1;
    future = Math.min(req, future + slope);
    gBack[i] = future;
  }
  const relCoeff = Math.exp(-1 / (0.065 * rate));
  let env = 1;
  for (let i = 0; i < frames; i += 1) {
    const released = 1 - relCoeff * (1 - env);
    env = Math.min(gBack[i]!, released);
    gBack[i] = env;
  }
  return gBack;
};

const applyOutputAndLimiter = (
  buf: Float64Array,
  policy: MasterSpec,
  channels: 1 | 2,
  rate: number,
  totalGainDb: number,
): void => {
  const linearGain = 10 ** (totalGainDb / 20);
  let maxAbs = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i]! * linearGain;
    buf[i] = v;
    const av = Math.abs(v);
    if (av > maxAbs) maxAbs = av;
  }
  if (policy.limit !== true) return;
  const safeCeiling = 10 ** (policy.peakDb / 20) * 0.992;
  if (maxAbs <= safeCeiling * 0.65) return;
  const env = computeLimiterGain(buf, channels, rate, safeCeiling);
  const frames = buf.length / channels;
  for (let i = 0; i < frames; i += 1) {
    const g = env[i]!;
    buf[i * channels] = clamp(buf[i * channels]! * g, -safeCeiling, safeCeiling);
    if (channels === 2) {
      buf[i * 2 + 1] = clamp(buf[i * 2 + 1]! * g, -safeCeiling, safeCeiling);
    }
  }
};

const buildLoopWorkBuffer = (
  pcm: Float64Array,
  channels: 1 | 2,
  rate: number,
): { readonly work: Float64Array; readonly warmFrames: number; readonly frames: number } => {
  const frames = pcm.length / channels;
  const warmFrames = Math.min(frames * 2, Math.max(Math.round(rate * 0.5), 2400));
  const tailFrames = Math.min(frames, Math.round(rate * 0.05));
  const total = warmFrames + frames + tailFrames;
  const work = new Float64Array(total * channels);
  for (let i = 0; i < total; i += 1) {
    const src = (((i - warmFrames) % frames) + frames) % frames;
    work[i * channels] = pcm[src * channels]!;
    if (channels === 2) work[i * 2 + 1] = pcm[src * 2 + 1]!;
  }
  return { work, warmFrames, frames };
};

/** 7-stage deterministic mastering bus: fused conditioning pass, LUFS trim, and fast-path true-peak limiter. */
export const applyMasterBus = (
  pcm: Float64Array,
  policy: MasterSpec,
  channels: 1 | 2,
  rate: number,
  loop = false,
): Float64Array => {
  const frames = pcm.length / channels;
  const padded = loop && frames > 0 ? buildLoopWorkBuffer(pcm, channels, rate) : null;
  const work = padded ? padded.work : new Float64Array(pcm);
  const st = initConditioner(policy, rate);
  const power = policy.targetLufs !== undefined ? new Float64Array(work.length / channels) : null;
  if (channels === 1) {
    runMonoConditioning(work, st, power);
  } else {
    runStereoConditioning(work, st, power);
  }
  let trimDb = 0;
  if (power && policy.targetLufs !== undefined) {
    const core = padded
      ? power.subarray(padded.warmFrames, padded.warmFrames + padded.frames)
      : power;
    const lufs = measurePowerLufs(core, rate);
    if (Number.isFinite(lufs)) trimDb = clamp(policy.targetLufs - lufs, -12, 18);
  }
  applyOutputAndLimiter(work, policy, channels, rate, policy.gainDb + trimDb);
  return padded
    ? work.slice(padded.warmFrames * channels, (padded.warmFrames + padded.frames) * channels)
    : work;
};
