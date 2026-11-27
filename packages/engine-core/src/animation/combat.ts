import type { CombatOps, HitstopOp, Quat, RecoilOp, SmearOp, SquashOp, Vec3 } from './contract';
import { IDENTITY_QUAT, mulQuat, quatFromEulerXyzDeg } from './quat';

const EPS = 1e-6;

export interface SquashResult {
  readonly scale: Vec3;
  readonly yCompensation: number;
  readonly volume: number;
}

/**
 * Compute volume-preserving squash/stretch `(1/sqrt(s), s, 1/sqrt(s))`
 * plus ground-contact Y compensation when compressing along Y.
 */
export const computeVolumePreservingSquash = (
  axis: 'x' | 'y' | 'z',
  amount: number,
  pivotHeight = 0,
): SquashResult => {
  const s = Math.max(0.25, 1 + amount);
  const invSqrt = 1 / Math.sqrt(s);
  const scale: Vec3 =
    axis === 'x'
      ? [s, invSqrt, invSqrt]
      : axis === 'y'
        ? [invSqrt, s, invSqrt]
        : [invSqrt, invSqrt, s];
  const yCompensation = axis === 'y' ? (s - 1) * pivotHeight : 0;
  return {
    scale,
    yCompensation,
    volume: scale[0] * scale[1] * scale[2],
  };
};

export interface HitstopTimeResult {
  readonly evalTime: number;
  readonly frozen: boolean;
  readonly shakeOffset: Vec3;
}

/** Remap clip time through hitstop freeze windows and compute deterministic micro-shake. */
export const evaluateHitstop = (
  hitstops: readonly HitstopOp[] | undefined,
  time: number,
): HitstopTimeResult => {
  if (!hitstops || hitstops.length === 0) {
    return { evalTime: time, frozen: false, shakeOffset: [0, 0, 0] };
  }
  for (const op of hitstops) {
    const end = op.at + Math.max(0, op.hold);
    if (time >= op.at - EPS && time <= end + EPS && op.hold > EPS) {
      const tick = Math.floor(((time - op.at) / Math.max(EPS, op.hold)) * 6);
      const sign = tick % 2 === 0 ? 1 : -1;
      const amp = op.shake;
      const shakeOffset: Vec3 = [sign * amp, -sign * amp * 0.6, sign * amp * 0.4];
      return { evalTime: op.at, frozen: true, shakeOffset };
    }
  }
  return { evalTime: time, frozen: false, shakeOffset: [0, 0, 0] };
};

/** Collect exact STEP transition timestamps for hitstops and smears so baking preserves them. */
export const collectCombatStepBoundaries = (ops: CombatOps | undefined): readonly number[] => {
  if (!ops) return [];
  const marks = new Set<number>();
  for (const smear of ops.smears ?? []) {
    marks.add(Number(smear.start.toFixed(6)));
    marks.add(Number(smear.end.toFixed(6)));
  }
  for (const hit of ops.hitstops ?? []) {
    const start = Number(hit.at.toFixed(6));
    const end = Number((hit.at + Math.max(0, hit.hold)).toFixed(6));
    marks.add(start);
    marks.add(end);
    for (let k = 1; k < 6; k += 1) {
      marks.add(Number((hit.at + (k / 6) * hit.hold).toFixed(6)));
    }
  }
  return [...marks].sort((a, b) => a - b);
};

const evaluateSquashEnvelope = (op: SquashOp, time: number): { readonly amount: number } => {
  const halfDur = 0.5 * Math.max(0.04, op.duration ?? 0.16);
  const dt = Math.abs(time - op.at);
  if (dt >= halfDur) return { amount: 0 };
  const u = 1 - dt / halfDur;
  const bell = u * u * (3 - 2 * u);
  return { amount: op.amount * bell };
};

const evaluateSmearScale = (op: SmearOp, time: number): Vec3 | null => {
  if (time < op.start - EPS || time > op.end + EPS) return null;
  const s = Math.max(0.25, op.stretch);
  const inv = 1 / Math.sqrt(s);
  const axis = op.axis ?? 'y';
  if (axis === 'x') return [s, inv, inv];
  if (axis === 'z') return [inv, inv, s];
  return [inv, s, inv];
};

const evaluateRecoilDelta = (op: RecoilOp, time: number): Quat => {
  const dt = time - op.at;
  const decay = Math.max(0.02, op.decay);
  if (dt < 0 || dt > decay * 4) return IDENTITY_QUAT;
  const u = dt / decay;
  const envelope = Math.exp(-3.2 * u) * Math.min(1, u * 6) * Math.cos(u * Math.PI * 1.5);
  return quatFromEulerXyzDeg([
    op.impulseDeg[0] * envelope,
    op.impulseDeg[1] * envelope,
    op.impulseDeg[2] * envelope,
  ]);
};

export interface CombatJointModifiers {
  readonly positionOffset: Vec3;
  readonly rotationDelta: Quat;
  readonly scaleMultiplier: Vec3;
}

const mulVec = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

const applySquashList = (
  squashes: readonly SquashOp[] | undefined,
  jointId: string,
  time: number,
): { readonly posOffset: Vec3; readonly scaleMult: Vec3 } => {
  let yOff = 0;
  let scaleMult: Vec3 = [1, 1, 1];
  for (const sq of squashes ?? []) {
    if (sq.jointId !== jointId) continue;
    const { amount } = evaluateSquashEnvelope(sq, time);
    if (Math.abs(amount) <= EPS) continue;
    const res = computeVolumePreservingSquash(sq.axis, amount, sq.pivotHeight ?? 0);
    scaleMult = mulVec(scaleMult, res.scale);
    yOff += res.yCompensation;
  }
  return { posOffset: [0, yOff, 0], scaleMult };
};

const applySmearList = (
  smears: readonly SmearOp[] | undefined,
  jointId: string,
  time: number,
  initial: Vec3,
): Vec3 => {
  let scaleMult = initial;
  for (const sm of smears ?? []) {
    if (sm.jointId !== jointId) continue;
    const smScale = evaluateSmearScale(sm, time);
    if (smScale) scaleMult = mulVec(scaleMult, smScale);
  }
  return scaleMult;
};

const applyRecoilList = (
  recoils: readonly RecoilOp[] | undefined,
  jointId: string,
  time: number,
): Quat => {
  let rotDelta = IDENTITY_QUAT;
  for (const rc of recoils ?? []) {
    if (rc.jointId === jointId) rotDelta = mulQuat(rotDelta, evaluateRecoilDelta(rc, time));
  }
  return rotDelta;
};

/** Evaluate all active CombatOps (squash, smear, recoil) for a joint at time t. */
export const evaluateCombatForJoint = (
  ops: CombatOps | undefined,
  jointId: string,
  time: number,
): CombatJointModifiers => {
  if (!ops) {
    return { positionOffset: [0, 0, 0], rotationDelta: IDENTITY_QUAT, scaleMultiplier: [1, 1, 1] };
  }
  const sq = applySquashList(ops.squashes, jointId, time);
  const scaleMultiplier = applySmearList(ops.smears, jointId, time, sq.scaleMult);
  const rotationDelta = applyRecoilList(ops.recoils, jointId, time);
  return { positionOffset: sq.posOffset, rotationDelta, scaleMultiplier };
};
