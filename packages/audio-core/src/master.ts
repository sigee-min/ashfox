import type { MasterSpec } from './contract';

interface BiquadCoeffs {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

type BiquadNode = (x: number) => number;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const createBiquad = (c: BiquadCoeffs): BiquadNode => {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x: number): number => {
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
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
  const alpha = Math.sin(w0) * Math.SQRT1_2;
  const beta = 2 * Math.sqrt(amp) * alpha;
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

const applyChannelBiquad = (buf: Float64Array, channels: 1 | 2, coeffs: BiquadCoeffs): void => {
  const f0 = createBiquad(coeffs);
  const f1 = channels === 2 ? createBiquad(coeffs) : null;
  const frames = buf.length / channels;
  for (let i = 0; i < frames; i += 1) {
    buf[i * channels] = f0(buf[i * channels]!);
    if (f1) buf[i * 2 + 1] = f1(buf[i * 2 + 1]!);
  }
};

const applyTransientShaper = (
  buf: Float64Array,
  channels: 1 | 2,
  rate: number,
  punch: number,
): void => {
  const p = clamp(punch, -1, 1);
  if (p === 0) return;
  const attFast = Math.exp(-1 / (0.002 * rate));
  const relFast = Math.exp(-1 / (0.012 * rate));
  const attSlow = Math.exp(-1 / (0.02 * rate));
  const relSlow = Math.exp(-1 / (0.12 * rate));
  const frames = buf.length / channels;
  let fast = 0;
  let slow = 0;
  for (let i = 0; i < frames; i += 1) {
    const l = buf[i * channels]!;
    const r = channels === 2 ? buf[i * 2 + 1]! : l;
    const level = Math.max(Math.abs(l), Math.abs(r));
    const cf = level > fast ? attFast : relFast;
    const cs = level > slow ? attSlow : relSlow;
    fast = cf * fast + (1 - cf) * level;
    slow = cs * slow + (1 - cs) * level;
    const diff = clamp((fast - slow) / (slow + 0.02), -0.5, 1.5);
    const gain = Math.max(0.1, 1 + p * 1.4 * diff);
    buf[i * channels] = l * gain;
    if (channels === 2) buf[i * 2 + 1] = r * gain;
  }
};

const softKneeGainDb = (over: number, ratio: number, knee: number): number => {
  const half = knee * 0.5;
  if (over <= -half) return 0;
  const slope = 1 / ratio - 1;
  if (over >= half) return slope * over;
  const t = over + half;
  return (slope * t * t) / (2 * knee);
};

const applyGlueCompressor = (
  buf: Float64Array,
  channels: 1 | 2,
  rate: number,
  glue: number,
): void => {
  const g = clamp(glue, 0, 1);
  if (g <= 0) return;
  const att = Math.exp(-1 / (0.01 * rate));
  const rel = Math.exp(-1 / (0.11 * rate));
  const ratio = 1 + g * 3;
  const makeup = 10 ** ((g * 1.5) / 20);
  const frames = buf.length / channels;
  let env = 0;
  for (let i = 0; i < frames; i += 1) {
    const l = buf[i * channels]!;
    const r = channels === 2 ? buf[i * 2 + 1]! : l;
    const peak = Math.max(Math.abs(l), Math.abs(r));
    const rms = channels === 2 ? Math.hypot(l, r) * Math.SQRT1_2 : peak;
    const det = 0.5 * (peak + rms);
    const coeff = det > env ? att : rel;
    env = coeff * env + (1 - coeff) * det;
    const grDb = softKneeGainDb(20 * Math.log10(Math.max(env, 1e-12)) + 14, ratio, 6);
    const gain = 10 ** (grDb / 20) * makeup;
    buf[i * channels] = l * gain;
    if (channels === 2) buf[i * 2 + 1] = r * gain;
  }
};

const applyBassMonoWidth = (
  buf: Float64Array,
  channels: 1 | 2,
  rate: number,
  width: number,
): void => {
  if (channels === 1) return;
  const w = clamp(width, 0, 1.5);
  const lpAlpha = 1 - Math.exp((-2 * Math.PI * 150) / rate);
  const frames = buf.length / 2;
  let bassSide = 0;
  for (let i = 0; i < frames; i += 1) {
    const l = buf[i * 2]!;
    const r = buf[i * 2 + 1]!;
    const mid = 0.5 * (l + r);
    const side = 0.5 * (l - r);
    bassSide += lpAlpha * (side - bassSide);
    const highSide = (side - bassSide) * w;
    buf[i * 2] = mid + highSide;
    buf[i * 2 + 1] = mid - highSide;
  }
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

const kWeightedPower = (buf: Float64Array, channels: 1 | 2, rate: number): Float64Array => {
  const [shelf, rlb] = kWeightStages(rate);
  const s0 = createBiquad(shelf);
  const r0 = createBiquad(rlb);
  const s1 = channels === 2 ? createBiquad(shelf) : null;
  const r1 = channels === 2 ? createBiquad(rlb) : null;
  const frames = buf.length / channels;
  const power = new Float64Array(frames);
  for (let i = 0; i < frames; i += 1) {
    const k0 = r0(s0(buf[i * channels]!));
    const k1 = s1 && r1 ? r1(s1(buf[i * 2 + 1]!)) : 0;
    power[i] = k0 * k0 + k1 * k1;
  }
  return power;
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

const measureKWeightedLufs = (buf: Float64Array, channels: 1 | 2, rate: number): number => {
  const power = kWeightedPower(buf, channels, rate);
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

const computeLimiterGain = (
  buf: Float64Array,
  channels: 1 | 2,
  rate: number,
  safeCeiling: number,
): Float64Array => {
  const frames = buf.length / channels;
  const lookahead = Math.max(1, Math.round(0.003 * rate));
  const slope = 1 / lookahead;
  const gBack = new Float64Array(frames);
  let future = 1;
  for (let i = frames - 1; i >= 0; i -= 1) {
    const l = Math.abs(buf[i * channels]!);
    const r = channels === 2 ? Math.abs(buf[i * 2 + 1]!) : l;
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
  for (let i = 0; i < buf.length; i += 1) buf[i] = buf[i]! * linearGain;
  if (policy.limit !== true) return;
  const safeCeiling = 10 ** (policy.peakDb / 20) * 0.992;
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

/** 7-stage deterministic mastering bus: DC-HPF, punch, glue, tilt EQ, bass-mono, LUFS trim, lookahead limiter. */
export const applyMasterBus = (
  pcm: Float64Array,
  policy: MasterSpec,
  channels: 1 | 2,
  rate: number,
): Float64Array => {
  const work = new Float64Array(pcm);
  applyChannelBiquad(work, channels, butterworthHpfCoeffs(20, rate));
  applyTransientShaper(work, channels, rate, policy.punch ?? 0);
  applyGlueCompressor(work, channels, rate, policy.glue ?? 0);
  const warmth = clamp(policy.warmth ?? 0, -1, 1);
  if (warmth !== 0) applyChannelBiquad(work, channels, shelfCoeffs('low', 180, warmth * 4.5, rate));
  const air = clamp(policy.air ?? 0, -1, 1);
  if (air !== 0) applyChannelBiquad(work, channels, shelfCoeffs('high', 6500, air * 4.5, rate));
  applyBassMonoWidth(work, channels, rate, policy.width ?? 1);
  let lufsTrimDb = 0;
  if (policy.targetLufs !== undefined) {
    const lufs = measureKWeightedLufs(work, channels, rate);
    if (Number.isFinite(lufs)) lufsTrimDb = clamp(policy.targetLufs - lufs, -12, 18);
  }
  applyOutputAndLimiter(work, policy, channels, rate, policy.gainDb + lufsTrimDb);
  return work;
};
