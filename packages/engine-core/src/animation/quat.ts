import type { CurveSpec, Quat, Vec3 } from './contract';

const EPS = 1e-8;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

export const normalizeQuat = (q: Quat): Quat => {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len <= EPS) return IDENTITY_QUAT;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
};

export const conjugateQuat = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

export const dotQuat = (a: Quat, b: Quat): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

export const alignQuatHemisphere = (ref: Quat, q: Quat): Quat =>
  dotQuat(ref, q) < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;

export const mulQuat = (a: Quat, b: Quat): Quat => {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return normalizeQuat([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
};

export const quatFromAxisAngle = (axis: Vec3, angleRad: number): Quat => {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len <= EPS || Math.abs(angleRad) <= EPS) return IDENTITY_QUAT;
  const half = 0.5 * angleRad;
  const s = Math.sin(half) / len;
  return normalizeQuat([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)]);
};

/** One-way Euler XYZ (degrees) -> Unit Quaternion input conversion. */
export const quatFromEulerXyzDeg = (deg: Vec3): Quat => {
  const hx = 0.5 * deg[0] * DEG_TO_RAD;
  const hy = 0.5 * deg[1] * DEG_TO_RAD;
  const hz = 0.5 * deg[2] * DEG_TO_RAD;
  const sx = Math.sin(hx);
  const cx = Math.cos(hx);
  const sy = Math.sin(hy);
  const cy = Math.cos(hy);
  const sz = Math.sin(hz);
  const cz = Math.cos(hz);
  return normalizeQuat([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ]);
};

/** Rotate a 3D vector by a unit quaternion. */
export const rotateVec3ByQuat = (v: Vec3, q: Quat): Vec3 => {
  const [qx, qy, qz, qw] = q;
  const cx = qy * v[2] - qz * v[1];
  const cy = qz * v[0] - qx * v[2];
  const cz = qx * v[1] - qy * v[0];
  const sx = qy * cz - qz * cy;
  const sy = qz * cx - qx * cz;
  const sz = qx * cy - qy * cx;
  return [v[0] + 2 * (qw * cx + sx), v[1] + 2 * (qw * cy + sy), v[2] + 2 * (qw * cz + sz)];
};

/** Geodesic angle in radians between two unit quaternions, in [0, pi]. */
export const quatAngleRad = (a: Quat, b: Quat): number => {
  const d = Math.min(1, Math.abs(dotQuat(normalizeQuat(a), normalizeQuat(b))));
  return 2 * Math.acos(d);
};

export const quatAngleDeg = (a: Quat, b: Quat): number => quatAngleRad(a, b) * RAD_TO_DEG;

/** Shortest-arc SLERP between two unit quaternions for t in [0, 1] (or extrapolated). */
export const slerpQuat = (a: Quat, b: Quat, t: number): Quat => {
  const qa = normalizeQuat(a);
  const qb = alignQuatHemisphere(qa, normalizeQuat(b));
  const cosHalf = Math.min(1, Math.max(-1, dotQuat(qa, qb)));
  if (cosHalf > 0.99995) {
    return normalizeQuat([
      qa[0] + t * (qb[0] - qa[0]),
      qa[1] + t * (qb[1] - qa[1]),
      qa[2] + t * (qb[2] - qa[2]),
      qa[3] + t * (qb[3] - qa[3]),
    ]);
  }
  const halfTheta = Math.acos(cosHalf);
  const sinHalf = Math.sin(halfTheta);
  const wa = Math.sin((1 - t) * halfTheta) / sinHalf;
  const wb = Math.sin(t * halfTheta) / sinHalf;
  return normalizeQuat([
    wa * qa[0] + wb * qb[0],
    wa * qa[1] + wb * qb[1],
    wa * qa[2] + wb * qb[2],
    wa * qa[3] + wb * qb[3],
  ]);
};

const quatLog = (q: Quat): readonly [number, number, number] => {
  const nq = normalizeQuat(q);
  const sinHalf = Math.hypot(nq[0], nq[1], nq[2]);
  if (sinHalf <= EPS) return [0, 0, 0];
  const halfAngle = Math.atan2(sinHalf, Math.max(-1, Math.min(1, nq[3])));
  const scale = halfAngle / sinHalf;
  return [nq[0] * scale, nq[1] * scale, nq[2] * scale];
};

const quatExp = (v: readonly [number, number, number]): Quat => {
  const halfAngle = Math.hypot(v[0], v[1], v[2]);
  if (halfAngle <= EPS) return IDENTITY_QUAT;
  const scale = Math.sin(halfAngle) / halfAngle;
  return normalizeQuat([v[0] * scale, v[1] * scale, v[2] * scale, Math.cos(halfAngle)]);
};

/** Raise a relative quaternion to power w (for additive/weighted blending). */
export const scaleQuatPower = (q: Quat, weight: number): Quat => {
  if (Math.abs(weight) <= EPS) return IDENTITY_QUAT;
  const aligned = alignQuatHemisphere(IDENTITY_QUAT, q);
  const [lx, ly, lz] = quatLog(aligned);
  return quatExp([lx * weight, ly * weight, lz * weight]);
};

/** Extract signed rotation vector (axis * angleRad) from a relative quaternion. */
export const quatToRotVec = (q: Quat): Vec3 => {
  const aligned = alignQuatHemisphere(IDENTITY_QUAT, q);
  const [lx, ly, lz] = quatLog(aligned);
  return [2 * lx, 2 * ly, 2 * lz];
};

/** Construct a unit quaternion from a rotation vector (axis * angleRad). */
export const quatFromRotVec = (rotVec: Vec3): Quat =>
  quatExp([0.5 * rotVec[0], 0.5 * rotVec[1], 0.5 * rotVec[2]]);

/** Compute SQUAD inner control quaternion s_i from aligned neighbors q_{i-1}, q_i, q_{i+1}. */
export const computeSquadControl = (prev: Quat, curr: Quat, next: Quat): Quat => {
  const qPrev = alignQuatHemisphere(curr, prev);
  const qNext = alignQuatHemisphere(curr, next);
  const invCurr = conjugateQuat(curr);
  const logPrev = quatLog(mulQuat(invCurr, qPrev));
  const logNext = quatLog(mulQuat(invCurr, qNext));
  const avg: readonly [number, number, number] = [
    -0.25 * (logPrev[0] + logNext[0]),
    -0.25 * (logPrev[1] + logNext[1]),
    -0.25 * (logPrev[2] + logNext[2]),
  ];
  return mulQuat(curr, quatExp(avg));
};

/** Evaluate SQUAD cubic quaternion spline on segment [q0, q1] with control points [s0, s1]. */
export const squadQuat = (q0: Quat, q1: Quat, s0: Quat, s1: Quat, t: number): Quat => {
  const mainArc = slerpQuat(q0, q1, t);
  const ctrlArc = slerpQuat(s0, s1, t);
  return slerpQuat(mainArc, ctrlArc, 2 * t * (1 - t));
};

/** Compute shortest-arc rotation aligning vector `from` onto vector `to`. */
export const quatBetweenVectors = (from: Vec3, to: Vec3): Quat => {
  const fl = Math.hypot(from[0], from[1], from[2]);
  const tl = Math.hypot(to[0], to[1], to[2]);
  if (fl <= EPS || tl <= EPS) return IDENTITY_QUAT;
  const fx = from[0] / fl;
  const fy = from[1] / fl;
  const fz = from[2] / fl;
  const tx = to[0] / tl;
  const ty = to[1] / tl;
  const tz = to[2] / tl;
  const dot = fx * tx + fy * ty + fz * tz;
  if (dot > 0.999999) return IDENTITY_QUAT;
  if (dot < -0.999999) {
    const ortho: Vec3 = Math.abs(fx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const ax = fy * ortho[2] - fz * ortho[1];
    const ay = fz * ortho[0] - fx * ortho[2];
    const az = fx * ortho[1] - fy * ortho[0];
    return quatFromAxisAngle([ax, ay, az], Math.PI);
  }
  const cx = fy * tz - fz * ty;
  const cy = fz * tx - fx * tz;
  const cz = fx * ty - fy * tx;
  return normalizeQuat([cx, cy, cz, 1 + dot]);
};

/** Mirror a relative joint quaternion across the sagittal (X=0) plane. */
export const mirrorQuatAcrossX = (q: Quat): Quat => normalizeQuat([q[0], -q[1], -q[2], q[3]]);

/** Compose rest, base, optional masked override, and additive rotation natively in Quat space. */
export const composeJointQuat = (
  rest: Quat,
  base: Quat,
  override?: Quat,
  overrideWeight = 0,
  additive?: Quat,
): Quat => {
  const blended =
    override && overrideWeight > EPS ? slerpQuat(base, override, overrideWeight) : base;
  const withRest = mulQuat(rest, blended);
  return additive ? mulQuat(withRest, additive) : withRest;
};

export interface QuatKey {
  readonly time: number;
  readonly quat: Quat;
  readonly curve?: CurveSpec;
}

const alignChainHemispheres = (keys: readonly QuatKey[]): Quat[] => {
  const aligned: Quat[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const q = normalizeQuat(keys[i]!.quat);
    aligned.push(i === 0 ? q : alignQuatHemisphere(aligned[i - 1]!, q));
  }
  return aligned;
};

const wrapQuatTime = (
  keys: readonly QuatKey[],
  time: number,
  loop: boolean,
  duration?: number,
): number => {
  const total = duration ?? keys[keys.length - 1]!.time;
  if (!loop || total <= EPS) return time;
  if (Math.abs(time - total) <= EPS && time > 0) return total;
  return ((time % total) + total) % total;
};

const findQuatSegment = (keys: readonly QuatKey[], t: number): number => {
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (keys[i + 1]!.time >= t) return i;
  }
  return keys.length - 2;
};

const sampleSquadSegment = (
  aligned: readonly Quat[],
  idx: number,
  u: number,
  loop: boolean,
): Quat => {
  const n = aligned.length;
  const intervals = n - 1;
  const prevIdx = idx === 0 ? (loop ? Math.max(0, intervals - 1) : 0) : idx - 1;
  const nextIdx = idx + 2 < n ? idx + 2 : loop ? Math.min(1, n - 1) : n - 1;
  const s0 = computeSquadControl(aligned[prevIdx]!, aligned[idx]!, aligned[idx + 1]!);
  const s1 = computeSquadControl(aligned[idx]!, aligned[idx + 1]!, aligned[nextIdx]!);
  return squadQuat(aligned[idx]!, aligned[idx + 1]!, s0, s1, u);
};

export const sampleQuatKeys = (
  keys: readonly QuatKey[],
  time: number,
  evalCurve: (curve: CurveSpec | undefined, u: number) => number,
  loop: boolean,
  duration?: number,
): Quat => {
  if (keys.length === 0) return IDENTITY_QUAT;
  if (keys.length === 1) return normalizeQuat(keys[0]!.quat);
  const t = wrapQuatTime(keys, time, loop, duration);
  if (t <= keys[0]!.time + EPS) return normalizeQuat(keys[0]!.quat);
  if (t >= keys[keys.length - 1]!.time - EPS) return normalizeQuat(keys[keys.length - 1]!.quat);

  const idx = findQuatSegment(keys, t);
  const a = keys[idx]!;
  const b = keys[idx + 1]!;
  const dt = b.time - a.time;
  if (dt <= EPS || a.curve?.kind === 'step') return normalizeQuat(a.quat);
  const u = (t - a.time) / dt;
  const aligned = alignChainHemispheres(keys);
  if (a.curve?.kind === 'smooth') return sampleSquadSegment(aligned, idx, u, loop);
  return slerpQuat(aligned[idx]!, aligned[idx + 1]!, evalCurve(a.curve, u));
};
