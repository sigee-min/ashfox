import type { CurveSpec, TransformKeyframe, Vec3 } from './contract';

const EPS = 1e-9;

export const clampUnit = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t);

const cubicBezierCoord = (u: number, p1: number, p2: number): number => {
  const inv = 1 - u;
  return 3 * inv * inv * u * p1 + 3 * inv * u * u * p2 + u * u * u;
};

const cubicBezierDeriv = (u: number, p1: number, p2: number): number => {
  const inv = 1 - u;
  return 3 * inv * inv * p1 + 6 * inv * u * (p2 - p1) + 3 * u * u * (1 - p2);
};

/** Evaluate standard CSS/Blender cubic-bezier(x1, y1, x2, y2) easing for t in [0, 1]. */
export const evalCubicBezier = (
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let u = t;
  for (let i = 0; i < 6; i += 1) {
    const err = cubicBezierCoord(u, x1, x2) - t;
    if (Math.abs(err) < 1e-7) return cubicBezierCoord(u, y1, y2);
    const deriv = cubicBezierDeriv(u, x1, x2);
    if (Math.abs(deriv) < 1e-6) break;
    u = clampUnit(u - err / deriv);
  }
  let lo = 0;
  let hi = 1;
  u = t;
  for (let i = 0; i < 16; i += 1) {
    const x = cubicBezierCoord(u, x1, x2);
    if (Math.abs(x - t) < 1e-7) break;
    if (x < t) lo = u;
    else hi = u;
    u = 0.5 * (lo + hi);
  }
  return cubicBezierCoord(u, y1, y2);
};

const evalBounce = (t: number): number => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const x = t - 1.5 / d1;
    return n1 * x * x + 0.75;
  }
  if (t < 2.5 / d1) {
    const x = t - 2.25 / d1;
    return n1 * x * x + 0.9375;
  }
  const x = t - 2.625 / d1;
  return n1 * x * x + 0.984375;
};

const evalElastic = (t: number): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

const evalAnticipate = (t: number, amount: number): number => {
  const s = Math.max(0.05, amount) * 5.0;
  return t * t * ((s + 1) * t - s);
};

const evalOvershoot = (t: number, amount: number): number => {
  const s = Math.max(0.05, amount) * 5.0;
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
};

/** Evaluate a CurveSpec on normalized segment progress t in [0, 1]. */
export const evaluateCurve = (curve: CurveSpec | undefined, t: number): number => {
  const u = clampUnit(t);
  if (!curve || curve.kind === 'linear') return u;
  switch (curve.kind) {
    case 'step':
      return u >= 1 ? 1 : 0;
    case 'smooth':
    case 'ease_in_out':
      return u * u * (3 - 2 * u);
    case 'ease_in':
      return u * u * u;
    case 'ease_out':
      return 1 - (1 - u) * (1 - u) * (1 - u);
    case 'snap':
      return 1 - Math.pow(1 - u, 5);
    case 'cubic': {
      const p = curve.params ?? [0.25, 0.1, 0.25, 1];
      return evalCubicBezier(u, p[0] ?? 0.25, p[1] ?? 0.1, p[2] ?? 0.25, p[3] ?? 1);
    }
    case 'anticipate':
      return evalAnticipate(u, curve.params?.[0] ?? 0.35);
    case 'overshoot':
      return evalOvershoot(u, curve.params?.[0] ?? 0.25);
    case 'bounce':
      return evalBounce(u);
    case 'elastic':
      return evalElastic(u);
  }
};

export interface ScalarKey {
  readonly time: number;
  readonly value: number;
  readonly curve?: CurveSpec;
}

const computeInitialSlope = (prevDelta: number, nextDelta: number): number => {
  if (prevDelta * nextDelta <= 0) return 0;
  return 0.5 * (prevDelta + nextDelta);
};

const clampMonotoneInterval = (
  tangents: number[],
  idxA: number,
  idxB: number,
  delta: number,
): void => {
  if (Math.abs(delta) <= EPS) {
    tangents[idxA] = 0;
    tangents[idxB] = 0;
    return;
  }
  const alpha = tangents[idxA]! / delta;
  const beta = tangents[idxB]! / delta;
  const sq = alpha * alpha + beta * beta;
  if (sq <= 9) return;
  const scale = 3 / Math.sqrt(sq);
  tangents[idxA] = scale * alpha * delta;
  tangents[idxB] = scale * beta * delta;
};

/**
 * Fritsch-Carlson monotone cubic Hermite tangents.
 * Guarantees zero hold-overshoot and exact C1 loop boundary continuity when cyclic=true.
 */
export const computeMonotoneTangents = (
  keys: readonly ScalarKey[],
  cyclic: boolean,
): readonly number[] => {
  const n = keys.length;
  if (n < 2) return keys.map(() => 0);
  const intervals = n - 1;
  const deltas: number[] = [];
  for (let i = 0; i < intervals; i += 1) {
    const dt = keys[i + 1]!.time - keys[i]!.time;
    deltas.push(dt > EPS ? (keys[i + 1]!.value - keys[i]!.value) / dt : 0);
  }

  const tangents = new Array<number>(n).fill(0);
  const loopClosed = cyclic && Math.abs(keys[0]!.value - keys[n - 1]!.value) <= 1e-5;
  if (loopClosed) {
    for (let i = 0; i < intervals; i += 1) {
      const prevD = deltas[(i - 1 + intervals) % intervals]!;
      const nextD = deltas[i]!;
      tangents[i] = computeInitialSlope(prevD, nextD);
    }
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < intervals; i += 1) {
        clampMonotoneInterval(tangents, i, (i + 1) % intervals, deltas[i]!);
      }
    }
    tangents[n - 1] = tangents[0]!;
    return tangents;
  }

  tangents[0] = deltas[0]!;
  tangents[n - 1] = deltas[intervals - 1]!;
  for (let i = 1; i < intervals; i += 1) {
    tangents[i] = computeInitialSlope(deltas[i - 1]!, deltas[i]!);
  }
  for (let i = 0; i < intervals; i += 1) {
    clampMonotoneInterval(tangents, i, i + 1, deltas[i]!);
  }
  return tangents;
};

const evalHermite = (
  y0: number,
  y1: number,
  m0: number,
  m1: number,
  dt: number,
  u: number,
): number => {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * y0 + h10 * dt * m0 + h01 * y1 + h11 * dt * m1;
};

export interface SampleChannelOptions {
  readonly loop?: boolean;
  readonly duration?: number;
}

const wrapTime = (
  time: number,
  keys: readonly ScalarKey[],
  options?: SampleChannelOptions,
): number => {
  const duration = options?.duration ?? keys[keys.length - 1]!.time;
  if (!options?.loop || duration <= EPS) return time;
  const wrapped = ((time % duration) + duration) % duration;
  return Math.abs(time - duration) <= EPS && time > 0 ? duration : wrapped;
};

const findSegmentIndex = (keys: readonly ScalarKey[], t: number): number => {
  let lo = 0;
  let hi = keys.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid]!.time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

/** Sample a sorted scalar keyframe list at time t, preserving smooth C1 monotone Hermite. */
export const sampleScalarKeys = (
  keys: readonly ScalarKey[],
  time: number,
  options?: SampleChannelOptions,
): number => {
  if (keys.length === 0) return 0;
  if (keys.length === 1) return keys[0]!.value;
  const t = wrapTime(time, keys, options);
  if (t <= keys[0]!.time + EPS) return keys[0]!.value;
  const last = keys[keys.length - 1]!;
  if (t >= last.time - EPS) return last.value;

  const idx = findSegmentIndex(keys, t);
  const a = keys[idx]!;
  const b = keys[idx + 1]!;
  const dt = b.time - a.time;
  if (dt <= EPS) return a.value;
  if (a.curve?.kind === 'step') return a.value;
  const u = (t - a.time) / dt;
  if (a.curve?.kind === 'smooth') {
    const tangents = computeMonotoneTangents(keys, Boolean(options?.loop));
    return evalHermite(a.value, b.value, tangents[idx]!, tangents[idx + 1]!, dt, u);
  }
  const eased = evaluateCurve(a.curve, u);
  return a.value + (b.value - a.value) * eased;
};

/** Sample a Vec3 keyframe track component-wise at time t. */
export const sampleVec3Keys = (
  keys: readonly TransformKeyframe[],
  time: number,
  defaultValue: Vec3,
  options?: SampleChannelOptions,
): Vec3 => {
  if (keys.length === 0) return defaultValue;
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  const axisKeys = (axis: 0 | 1 | 2): ScalarKey[] =>
    sorted.map((k) => ({ time: k.time, value: k.value[axis], curve: k.curve }));
  return [
    sampleScalarKeys(axisKeys(0), time, options),
    sampleScalarKeys(axisKeys(1), time, options),
    sampleScalarKeys(axisKeys(2), time, options),
  ];
};
