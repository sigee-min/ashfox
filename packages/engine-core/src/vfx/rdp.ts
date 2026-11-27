import type { Vec3 } from '../model/identity';
import type { VfxQuat } from './contract';

const pointToSegmentDistSqVec3 = (p: Vec3, a: Vec3, b: Vec3): number => {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const lenSq = abx * abx + aby * aby + abz * abz;
  if (lenSq <= 1e-12) {
    return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 + (p[2] - a[2]) ** 2;
  }
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / lenSq),
  );
  const dx = p[0] - (a[0] + abx * t);
  const dy = p[1] - (a[1] + aby * t);
  const dz = p[2] - (a[2] + abz * t);
  return dx * dx + dy * dy + dz * dz;
};

const rdpIndices = <T>(
  items: readonly T[],
  start: number,
  end: number,
  epsilon: number,
  dist: (mid: T, a: T, b: T, frac: number) => number,
  keep: Uint8Array,
): void => {
  if (end - start <= 1) return;
  let maxDist = -1;
  let splitIndex = -1;
  const a = items[start]!;
  const b = items[end]!;
  const span = end - start;
  for (let i = start + 1; i < end; i += 1) {
    const d = dist(items[i]!, a, b, (i - start) / span);
    if (d > maxDist) {
      maxDist = d;
      splitIndex = i;
    }
  }
  if (maxDist > epsilon && splitIndex > start) {
    keep[splitIndex] = 1;
    rdpIndices(items, start, splitIndex, epsilon, dist, keep);
    rdpIndices(items, splitIndex, end, epsilon, dist, keep);
  }
};

/** Ramer-Douglas-Peucker simplification for sampled Vec3 tracks. */
export const rdpSimplifyVec3 = (
  times: readonly number[],
  values: readonly Vec3[],
  epsilon: number,
): { readonly times: readonly number[]; readonly values: readonly Vec3[] } => {
  if (times.length <= 2) return { times, values };
  const keep = new Uint8Array(times.length);
  keep[0] = 1;
  keep[times.length - 1] = 1;
  rdpIndices(
    values,
    0,
    values.length - 1,
    epsilon * epsilon,
    (mid, a, b) => pointToSegmentDistSqVec3(mid, a, b),
    keep,
  );
  const outTimes: number[] = [];
  const outValues: Vec3[] = [];
  for (let i = 0; i < times.length; i += 1) {
    if (keep[i] === 1) {
      outTimes.push(times[i]!);
      outValues.push(values[i]!);
    }
  }
  return { times: outTimes, values: outValues };
};

const nlerpQuat = (a: VfxQuat, b: VfxQuat, t: number): VfxQuat => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  const x = a[0] + (b[0] * sign - a[0]) * t;
  const y = a[1] + (b[1] * sign - a[1]) * t;
  const z = a[2] + (b[2] * sign - a[2]) * t;
  const w = a[3] + (b[3] * sign - a[3]) * t;
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
};

const quatAngularErrorDeg = (q: VfxQuat, ref: VfxQuat): number => {
  const dot = Math.min(1, Math.abs(q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3]));
  return (2 * Math.acos(dot) * 180) / Math.PI;
};

/** Ramer-Douglas-Peucker simplification for unit quaternion tracks by angular tolerance (deg). */
export const rdpSimplifyQuat = (
  times: readonly number[],
  values: readonly VfxQuat[],
  epsilonDeg: number,
): { readonly times: readonly number[]; readonly values: readonly VfxQuat[] } => {
  if (times.length <= 2) return { times, values };
  const keep = new Uint8Array(times.length);
  keep[0] = 1;
  keep[times.length - 1] = 1;
  rdpIndices(
    values,
    0,
    values.length - 1,
    epsilonDeg,
    (mid, a, b, frac) => quatAngularErrorDeg(mid, nlerpQuat(a, b, frac)),
    keep,
  );
  const outTimes: number[] = [];
  const outValues: VfxQuat[] = [];
  for (let i = 0; i < times.length; i += 1) {
    if (keep[i] === 1) {
      outTimes.push(times[i]!);
      outValues.push(values[i]!);
    }
  }
  return { times: outTimes, values: outValues };
};
