import { add3, cross3, scale3, sub3 } from '../math/vec3';
import type { BakedChannel, BakedKey, JointLimits, Quat, SecondarySpec, Vec3 } from './contract';
import {
  IDENTITY_QUAT,
  conjugateQuat,
  mulQuat,
  quatFromRotVec,
  quatToRotVec,
  rotateVec3ByQuat,
} from './quat';

export const SPRING_SUBSTEP_HZ = 120;
const STEP_DT = 1 / SPRING_SUBSTEP_HZ;
const DEG_TO_RAD = Math.PI / 180;

export interface SecondaryParentSample {
  readonly time: number;
  readonly worldPos: Vec3;
  readonly worldQuat: Quat;
}

export interface SecondaryJointInput {
  readonly jointId: string;
  readonly restRotation: Quat;
  readonly limits?: JointLimits;
  readonly targetLocalQuats: readonly Quat[];
}

export interface SecondarySolveInput {
  readonly spec: SecondarySpec;
  readonly joints: readonly SecondaryJointInput[];
  readonly parentSamples: readonly SecondaryParentSample[];
  readonly duration: number;
  readonly loop: boolean;
}

interface LinkState {
  theta: Vec3;
  omega: Vec3;
}

interface SpringConstants {
  readonly k: number;
  readonly damp: number;
  readonly gravity: number;
  readonly inertiaGain: number;
}

const softClampAxis = (val: number, minRad: number, maxRad: number): number => {
  const span = Math.max(1e-4, maxRad - minRad);
  const margin = Math.min(0.15, 0.2 * span);
  const lo = minRad + margin;
  const hi = maxRad - margin;
  if (val < lo) return minRad + margin * (1 - Math.tanh((lo - val) / margin));
  if (val > hi) return maxRad - margin * (1 - Math.tanh((val - hi) / margin));
  return val;
};

const clampRotVecLimits = (theta: Vec3, limits: JointLimits | undefined): Vec3 => {
  if (!limits) return theta;
  const clampOne = (v: number, pair: readonly [number, number] | undefined): number =>
    pair ? softClampAxis(v, pair[0] * DEG_TO_RAD, pair[1] * DEG_TO_RAD) : v;
  return [
    clampOne(theta[0], limits.pitch),
    clampOne(theta[1], limits.yaw),
    clampOne(theta[2], limits.roll),
  ];
};

const computeParentForcing = (
  samples: readonly SecondaryParentSample[],
  idx: number,
  dt: number,
  loop: boolean,
): { readonly linearAcc: Vec3; readonly angularAcc: Vec3; readonly parentQuat: Quat } => {
  const n = samples.length;
  if (n < 3) {
    return {
      linearAcc: [0, 0, 0],
      angularAcc: [0, 0, 0],
      parentQuat: samples[0]?.worldQuat ?? IDENTITY_QUAT,
    };
  }
  const prevIdx = loop ? (idx - 1 + n) % n : Math.max(0, idx - 1);
  const nextIdx = loop ? (idx + 1) % n : Math.min(n - 1, idx + 1);
  const p0 = samples[prevIdx]!;
  const p1 = samples[idx]!;
  const p2 = samples[nextIdx]!;
  const invDt2 = 1 / (dt * dt);
  const linearAcc = scale3(add3(sub3(p2.worldPos, scale3(p1.worldPos, 2)), p0.worldPos), invDt2);
  const r0 = quatToRotVec(p0.worldQuat);
  const r1 = quatToRotVec(p1.worldQuat);
  const r2 = quatToRotVec(p2.worldQuat);
  const angularAcc = scale3(add3(sub3(r2, scale3(r1, 2)), r0), invDt2);
  return { linearAcc, angularAcc, parentQuat: p1.worldQuat };
};

const resolveConstants = (spec: SecondarySpec): SpringConstants => {
  const lagTargetWn =
    spec.lagSeconds && spec.lagSeconds > 1e-4
      ? (2 * Math.max(0.15, spec.damping)) / spec.lagSeconds
      : Number.POSITIVE_INFINITY;
  const baseWn = Math.sqrt(Math.max(1, spec.stiffness)) * 2.4;
  const wn = Math.min(280, Math.max(1, Math.min(baseWn, lagTargetWn)));
  const k = wn * wn;
  const damp = 2 * Math.max(0.05, spec.damping) * wn + Math.max(0, spec.drag ?? 0) * 4;
  return {
    k,
    damp,
    gravity: spec.gravity ?? 0,
    inertiaGain: 0.025,
  };
};

const evalAccel = (
  theta: Vec3,
  omega: Vec3,
  targetTheta: Vec3,
  extTorque: Vec3,
  c: SpringConstants,
): Vec3 => [
  -c.k * (theta[0] - targetTheta[0]) - c.damp * omega[0] + extTorque[0],
  -c.k * (theta[1] - targetTheta[1]) - c.damp * omega[1] + extTorque[1],
  -c.k * (theta[2] - targetTheta[2]) - c.damp * omega[2] + extTorque[2],
];

const stepRk4 = (
  state: LinkState,
  targetTheta: Vec3,
  extTorque: Vec3,
  c: SpringConstants,
  dt: number,
  limits: JointLimits | undefined,
): LinkState => {
  const th = state.theta;
  const om = state.omega;
  const a1 = evalAccel(th, om, targetTheta, extTorque, c);
  const th2 = add3(th, scale3(om, 0.5 * dt));
  const om2 = add3(om, scale3(a1, 0.5 * dt));
  const a2 = evalAccel(th2, om2, targetTheta, extTorque, c);
  const th3 = add3(th, scale3(om2, 0.5 * dt));
  const om3 = add3(om, scale3(a2, 0.5 * dt));
  const a3 = evalAccel(th3, om3, targetTheta, extTorque, c);
  const th4 = add3(th, scale3(om3, dt));
  const om4 = add3(om, scale3(a3, dt));
  const a4 = evalAccel(th4, om4, targetTheta, extTorque, c);

  const dTheta = scale3(add3(add3(om, scale3(om2, 2)), add3(scale3(om3, 2), om4)), dt / 6);
  const dOmega = scale3(add3(add3(a1, scale3(a2, 2)), add3(scale3(a3, 2), a4)), dt / 6);
  return {
    theta: clampRotVecLimits(add3(th, dTheta), limits),
    omega: add3(om, dOmega),
  };
};

const computeExternalTorque = (
  parentAcc: Vec3,
  parentAngAcc: Vec3,
  prevTheta: Vec3,
  parentQuat: Quat,
  c: SpringConstants,
  chainGain: number,
): Vec3 => {
  const invParent: Quat = [-parentQuat[0], -parentQuat[1], -parentQuat[2], parentQuat[3]];
  const localAcc = rotateVec3ByQuat(parentAcc, invParent);
  const localGrav = rotateVec3ByQuat([0, -9.8 * c.gravity, 0], invParent);
  const boneAxis: Vec3 = [0, -1, 0];
  const inertia = cross3(boneAxis, scale3(localAcc, -c.inertiaGain * chainGain));
  const gravTorque = cross3(boneAxis, scale3(localGrav, 0.02 * chainGain));
  const parentDrag = scale3(parentAngAcc, -0.06 * chainGain);
  const cascade = scale3(prevTheta, 0.15 * c.k);
  return add3(add3(inertia, gravTorque), add3(parentDrag, cascade));
};

const applyLoopClosureFade = (recorded: Vec3[]): Vec3[] => {
  const n = recorded.length;
  if (n < 2) return recorded;
  const diff = sub3(recorded[0]!, recorded[n - 1]!);
  return recorded.map((val, i) => {
    const u = i / (n - 1);
    const fade = 0.5 * (1 - Math.cos(Math.PI * u));
    return add3(val, scale3(diff, fade));
  });
};

/**
 * Deterministic 120Hz RK4 angular spring-damper solver for secondary chains & joints.
 * Uses 2-cycle pre-roll warm-up + cosine residual fade for exact C1 loop closure.
 */
export const solveSecondaryChain = (input: SecondarySolveInput): readonly BakedChannel[] => {
  const stepsPerCycle = Math.max(2, Math.round(Math.max(0.05, input.duration) * SPRING_SUBSTEP_HZ));
  const dt = input.duration / stepsPerCycle;
  const constants = resolveConstants(input.spec);
  const cycles = input.loop ? 3 : 1;
  const totalSteps = stepsPerCycle * cycles;
  const invRests = input.joints.map((j) => conjugateQuat(j.restRotation));
  const states: LinkState[] = input.joints.map((j, jIdx) => ({
    theta: quatToRotVec(mulQuat(invRests[jIdx]!, j.targetLocalQuats[0] ?? j.restRotation)),
    omega: [0, 0, 0],
  }));
  const recorded: Vec3[][] = input.joints.map(() => []);

  for (let step = 0; step < totalSteps; step += 1) {
    const cycleIdx = step % stepsPerCycle;
    const sampleIdx = Math.min(input.parentSamples.length - 1, cycleIdx);
    const forcing = computeParentForcing(input.parentSamples, sampleIdx, STEP_DT, input.loop);
    let prevDelta: Vec3 = [0, 0, 0];
    for (let j = 0; j < input.joints.length; j += 1) {
      if (step >= (cycles - 1) * stepsPerCycle) {
        recorded[j]!.push(states[j]!.theta);
      }
      const joint = input.joints[j]!;
      const qTarget =
        joint.targetLocalQuats[Math.min(joint.targetLocalQuats.length - 1, cycleIdx)] ??
        joint.restRotation;
      const targetTheta = quatToRotVec(mulQuat(invRests[j]!, qTarget));
      const extTorque = computeExternalTorque(
        forcing.linearAcc,
        forcing.angularAcc,
        prevDelta,
        forcing.parentQuat,
        constants,
        1 + j * 0.25,
      );
      states[j] = stepRk4(states[j]!, targetTheta, extTorque, constants, dt, joint.limits);
      prevDelta = sub3(states[j]!.theta, targetTheta);
    }
  }
  for (let j = 0; j < input.joints.length; j += 1) {
    recorded[j]!.push(states[j]!.theta);
  }

  return input.joints.map((joint, j) => {
    const rawThetas = recorded[j]!;
    const closed = input.loop ? applyLoopClosureFade(rawThetas) : rawThetas;
    const keys: BakedKey[] = closed.map((theta, idx) => {
      const time = Number(((idx / stepsPerCycle) * input.duration).toFixed(6));
      const solvedQuat = mulQuat(joint.restRotation, quatFromRotVec(theta));
      return { time, value: solvedQuat, interpolation: 'linear' };
    });
    return { jointId: joint.jointId, property: 'rotation', keys };
  });
};
