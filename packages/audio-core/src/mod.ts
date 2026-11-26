import type { VoiceDriftSpec } from './contract';

const TAU = Math.PI * 2;
const RADIUS = 1.65;
const SQRT1_2 = Math.SQRT1_2;
const GRADS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [SQRT1_2, SQRT1_2],
  [-SQRT1_2, SQRT1_2],
  [SQRT1_2, -SQRT1_2],
  [-SQRT1_2, -SQRT1_2],
];

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

const hash2 = (ix: number, iy: number, seed: number): number => {
  let h =
    Math.imul(ix ^ 0x27d4eb2d, 0x165667b1) ^
    Math.imul(iy ^ 0x9e3779b9, 0x85ebca6b) ^
    Math.imul((seed + 1) | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
};

const gradDot = (ix: number, iy: number, dx: number, dy: number, seed: number): number => {
  const g = GRADS[hash2(ix, iy, seed) & 7]!;
  return g[0] * dx + g[1] * dy;
};

const perlin2d = (x: number, y: number, seed: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fade(fx);
  const v = fade(fy);
  const n00 = gradDot(ix, iy, fx, fy, seed);
  const n10 = gradDot(ix + 1, iy, fx - 1, fy, seed);
  const n01 = gradDot(ix, iy + 1, fx, fy - 1, seed);
  const n11 = gradDot(ix + 1, iy + 1, fx - 1, fy - 1, seed);
  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return clamp((nx0 + v * (nx1 - nx0)) * 1.35, -1, 1);
};

/**
 * Circular 2D Perlin seamless loop modulator.
 * When `loopFrames` is set, snaps cycle count to an integer across `loopFrames`
 * so start and end share exact C^2-continuous phase on the 2D gradient lattice.
 */
export const sampleCircularDrift = (
  rate: number,
  progress: number,
  totalFrames: number,
  spec: VoiceDriftSpec,
  loopFrames?: number,
): number => {
  const driftRate = Math.max(0.01, spec.rate ?? 0.35);
  const spanFrames = Math.max(1, totalFrames - 1);
  const seed = (spec.seed ?? 0) >>> 0;
  const hasLoop = loopFrames !== undefined && loopFrames > 0;
  const cycles = hasLoop ? Math.max(1, Math.round(driftRate * (loopFrames / rate))) : 0;
  const theta = hasLoop
    ? (TAU * cycles * progress * spanFrames) / loopFrames
    : TAU * driftRate * ((progress * spanFrames) / rate);
  const cx = 17.3 + (hash2(1, 3, seed) & 0xff) * 0.25;
  const cy = 41.7 + (hash2(7, 11, seed) & 0xff) * 0.25;
  return perlin2d(cx + RADIUS * Math.cos(theta), cy + RADIUS * Math.sin(theta), seed) * spec.depth;
};

export interface PitchDriftNode {
  readonly process: (inL: number, inR: number, driftVal: number, outLR: Float64Array) => void;
}

const readFrac = (
  buf: Float64Array,
  writeIdx: number,
  delaySamples: number,
  len: number,
): number => {
  const pos = writeIdx - delaySamples;
  const i0 = Math.floor(pos);
  const frac = pos - i0;
  const idx0 = ((i0 % len) + len) % len;
  const idx1 = (idx0 + 1) % len;
  return buf[idx0]! * (1 - frac) + buf[idx1]! * frac;
};

/** Bounded stereo fractional-delay pitch drift processor driven by `sampleCircularDrift`. */
export const createPitchDrift = (rate: number, spec: VoiceDriftSpec): PitchDriftNode => {
  const center = Math.max(16, Math.round(0.012 * rate));
  const len = center * 2 + 8;
  const bufL = new Float64Array(len);
  const bufR = new Float64Array(len);
  const driftRate = Math.max(0.01, spec.rate ?? 0.35);
  const depthScale = Math.abs(spec.depth) > 1e-9 ? 1 / Math.abs(spec.depth) : 0;
  const maxSwing = Math.min(
    center * 0.85,
    (Math.abs(spec.depth) * 0.05776 * rate) / (TAU * driftRate * RADIUS),
  );
  let writeIdx = 0;
  return {
    process: (inL: number, inR: number, driftVal: number, outLR: Float64Array): void => {
      bufL[writeIdx] = inL;
      bufR[writeIdx] = inR;
      const normDrift = clamp(driftVal * depthScale, -1, 1);
      const delay = clamp(center + normDrift * maxSwing, 1, len - 3);
      outLR[0] = readFrac(bufL, writeIdx, delay, len);
      outLR[1] = readFrac(bufR, writeIdx, delay, len);
      writeIdx = (writeIdx + 1) % len;
    },
  };
};

/** Computes a normalized `[0, 1]` peak/RMS sidechain follower envelope from a trigger buffer. */
export const computeDuckEnvelope = (
  triggerBuffer: Float64Array,
  channels: 1 | 2,
  rate: number,
  releaseMs: number,
): Float64Array => {
  const frames = Math.floor(triggerBuffer.length / channels);
  const envelope = new Float64Array(frames);
  if (frames === 0) return envelope;
  const att = Math.exp(-1 / (0.0015 * rate));
  const rel = Math.exp(-1 / ((Math.max(1, releaseMs) / 1000) * rate));
  let env = 0;
  let peakEnv = 0;
  for (let i = 0; i < frames; i += 1) {
    const l = triggerBuffer[i * channels]!;
    const r = channels === 2 ? triggerBuffer[i * 2 + 1]! : l;
    const peak = Math.max(Math.abs(l), Math.abs(r));
    const rms = channels === 2 ? Math.hypot(l, r) * SQRT1_2 : peak;
    const level = 0.6 * peak + 0.4 * rms;
    const coeff = level > env ? att : rel;
    env = coeff * env + (1 - coeff) * level;
    envelope[i] = env;
    if (env > peakEnv) peakEnv = env;
  }
  if (peakEnv <= 1e-6) {
    envelope.fill(0);
    return envelope;
  }
  const invRef = 1 / Math.max(0.35, peakEnv);
  for (let i = 0; i < frames; i += 1) {
    envelope[i] = clamp(envelope[i]! * invRef, 0, 1);
  }
  return envelope;
};

/** Attenuates a target mono/stereo buffer in-place using a precomputed sidechain envelope. */
export const applyDuckEnvelope = (
  targetBuffer: Float64Array,
  channels: 1 | 2,
  envelope: Float64Array,
  amount: number,
): void => {
  const depth = clamp(amount, 0, 1);
  if (depth === 0) return;
  const frames = Math.min(envelope.length, Math.floor(targetBuffer.length / channels));
  for (let i = 0; i < frames; i += 1) {
    const gain = Math.max(0, 1 - depth * envelope[i]!);
    targetBuffer[i * channels] = targetBuffer[i * channels]! * gain;
    if (channels === 2) targetBuffer[i * 2 + 1] = targetBuffer[i * 2 + 1]! * gain;
  }
};
