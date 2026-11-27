import type { WaveSpec } from './contract';

const TAU = Math.PI * 2;
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRADIENTS: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const hash2D = (ix: number, iy: number, seed: number): number => {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) % GRADIENTS.length;
};

const gradDot = (ix: number, iy: number, dx: number, dy: number, seed: number): number => {
  const g = GRADIENTS[hash2D(ix, iy, seed)]!;
  return g[0] * dx + g[1] * dy;
};

const simplexContrib = (ix: number, iy: number, dx: number, dy: number, seed: number): number => {
  const t = 0.5 - dx * dx - dy * dy;
  if (t <= 0) return 0;
  const t2 = t * t;
  return t2 * t2 * gradDot(ix, iy, dx, dy, seed);
};

/** Deterministic 2D simplex noise in roughly [-1, 1]. */
export const simplexNoise2D = (x: number, y: number, seed = 0): number => {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const n0 = simplexContrib(i, j, x0, y0, seed);
  const n1 = simplexContrib(i + i1, j + j1, x1, y1, seed);
  const n2 = simplexContrib(i + 1, j + 1, x2, y2, seed);
  return 70 * (n0 + n1 + n2);
};

const phaseInPeriod = (time: number, period: number): number => {
  if (period <= 1e-6) return 0;
  const p = (time % period) / period;
  return p < 0 ? p + 1 : p;
};

/** Asymmetric C1 breathing wave in [0, 1]: fast inhale, slower exhale. */
export const evaluateBreath = (time: number, period: number, inhale = 0.42): number => {
  const ratio = Math.min(0.9, Math.max(0.1, inhale));
  const p = phaseInPeriod(time, period);
  if (p < ratio) {
    const u = p / ratio;
    return 0.5 - 0.5 * Math.cos(Math.PI * u);
  }
  const u = (p - ratio) / (1 - ratio);
  return 0.5 + 0.5 * Math.cos(Math.PI * u);
};

export interface FlapSample {
  readonly wing: number;
  readonly comLift: number;
}

/** Asymmetric wing flap wave in [-1, 1] with synced CoM vertical lift. */
export const evaluateFlap = (
  time: number,
  period: number,
  downRatio = 0.38,
  comLiftAmp = 1,
): FlapSample => {
  const ratio = Math.min(0.85, Math.max(0.15, downRatio));
  const p = phaseInPeriod(time, period);
  let wing: number;
  if (p < ratio) {
    const u = p / ratio;
    wing = Math.cos(Math.PI * u);
  } else {
    const u = (p - ratio) / (1 - ratio);
    wing = -Math.cos(Math.PI * u);
  }
  const liftPhase = (p - 0.5 * ratio + 1) % 1;
  const comLift = Math.cos(TAU * liftPhase) * comLiftAmp;
  return { wing, comLift };
};

/**
 * Periodic 2D-torus simplex wave guaranteeing exact C-infinity closure over `period`.
 */
export const evaluatePeriodicSimplex = (
  time: number,
  period: number,
  freq: number,
  amp: number,
  seed = 0,
): number => {
  const p = phaseInPeriod(time, period);
  const angle = TAU * p;
  const radius = Math.max(0.5, freq * period * 0.25);
  const seedOffset = ((seed | 0) % 97) * 1.37;
  const sx = radius * Math.cos(angle) + seedOffset;
  const sy = radius * Math.sin(angle) - seedOffset * 0.71;
  return simplexNoise2D(sx, sy, seed | 0) * amp;
};

export interface WaveSample {
  readonly value: number;
  readonly comLift: number;
}

/** Evaluate any WaveSpec at `time` over clip `duration`. */
export const evaluateWave = (spec: WaveSpec, time: number, duration: number): WaveSample => {
  const period = spec.period > 1e-6 ? spec.period : Math.max(0.1, duration);
  const amp = spec.amp ?? 1;
  if (spec.kind === 'breath') {
    return {
      value: evaluateBreath(time, period, spec.inhale ?? 0.42) * amp,
      comLift: 0,
    };
  }
  if (spec.kind === 'flap') {
    const flap = evaluateFlap(time, period, spec.downRatio ?? 0.38, spec.comLiftAmp ?? 0.5 * amp);
    return {
      value: flap.wing * amp,
      comLift: flap.comLift,
    };
  }
  return {
    value: evaluatePeriodicSimplex(time, period, spec.freq ?? 1, amp, spec.seed ?? 0),
    comLift: 0,
  };
};
