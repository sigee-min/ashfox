import assert from 'node:assert/strict';
import { evaluateCurve, sampleScalarKeys, type ScalarKey } from '../../src/animation/curves';
import {
  IDENTITY_QUAT,
  composeJointQuat,
  computeSquadControl,
  mulQuat,
  quatAngleDeg,
  quatFromEulerXyzDeg,
  rotateVec3ByQuat,
  sampleQuatKeys,
  slerpQuat,
  squadQuat,
} from '../../src/animation/quat';
import { evaluateBreath, evaluateFlap, evaluatePeriodicSimplex } from '../../src/animation/wave';

// 1. Fritsch-Carlson monotone cubic: zero hold-overshoot
const holdKeys: ScalarKey[] = [
  { time: 0, value: 0, curve: { kind: 'smooth' } },
  { time: 0.25, value: 10, curve: { kind: 'smooth' } },
  { time: 0.75, value: 10, curve: { kind: 'smooth' } },
  { time: 1.0, value: 0, curve: { kind: 'smooth' } },
];
for (let i = 0; i <= 100; i += 1) {
  const t = i / 100;
  const v = sampleScalarKeys(holdKeys, t, { loop: false });
  assert.ok(v >= -1e-9 && v <= 10 + 1e-9, `hold overshoot at t=${t}: ${v}`);
  if (t >= 0.25 && t <= 0.75) {
    assert.ok(Math.abs(v - 10) <= 1e-9, `flat hold drifted at t=${t}: ${v}`);
  }
}

// 2. Cyclic C1 loop velocity continuity <= 1e-4
const loopKeys: ScalarKey[] = [
  { time: 0, value: 0, curve: { kind: 'smooth' } },
  { time: 0.25, value: 12, curve: { kind: 'smooth' } },
  { time: 0.5, value: 0, curve: { kind: 'smooth' } },
  { time: 0.75, value: -12, curve: { kind: 'smooth' } },
  { time: 1.0, value: 0, curve: { kind: 'smooth' } },
];
const dt = 1e-5;
const vStart =
  (sampleScalarKeys(loopKeys, dt, { loop: true, duration: 1 }) -
    sampleScalarKeys(loopKeys, 0, { loop: true, duration: 1 })) /
  dt;
const vEnd =
  (sampleScalarKeys(loopKeys, 1, { loop: true, duration: 1 }) -
    sampleScalarKeys(loopKeys, 1 - dt, { loop: true, duration: 1 })) /
  dt;
assert.ok(Math.abs(vStart - vEnd) <= 1e-4, `loop velocity discontinuity: ${vStart} vs ${vEnd}`);

// 3. All CurveKind behaviors
assert.equal(evaluateCurve({ kind: 'linear' }, 0.35), 0.35);
assert.equal(evaluateCurve({ kind: 'step' }, 0.99), 0);
assert.equal(evaluateCurve({ kind: 'step' }, 1), 1);
assert.ok(evaluateCurve({ kind: 'ease_in' }, 0.5) < 0.25);
assert.ok(evaluateCurve({ kind: 'ease_out' }, 0.5) > 0.75);
assert.ok(Math.abs(evaluateCurve({ kind: 'ease_in_out' }, 0.5) - 0.5) < 1e-9);
assert.ok(evaluateCurve({ kind: 'snap' }, 0.3) > 0.8);
assert.ok(evaluateCurve({ kind: 'cubic', params: [0.42, 0, 0.58, 1] }, 0.5) - 0.5 < 1e-4);
assert.ok(
  evaluateCurve({ kind: 'anticipate', params: [0.4] }, 0.25) < 0,
  'anticipate must dip negative',
);
assert.ok(evaluateCurve({ kind: 'overshoot', params: [0.35] }, 0.7) > 1, 'overshoot must exceed 1');
assert.ok(
  evaluateCurve({ kind: 'bounce' }, 1) === 1 && evaluateCurve({ kind: 'bounce' }, 0.5) > 0.5,
);
assert.ok(
  evaluateCurve({ kind: 'elastic' }, 0) === 0 && evaluateCurve({ kind: 'elastic' }, 1) === 1,
);

// 4. Quaternion SLERP & SQUAD: no gimbal flip at +-90deg and 360deg
const q0 = quatFromEulerXyzDeg([0, 0, 0]);
const q90 = quatFromEulerXyzDeg([90, 0, 0]);
const q180 = quatFromEulerXyzDeg([180, 0, 0]);
const q270 = quatFromEulerXyzDeg([270, 0, 0]);
const qMid = slerpQuat(q0, q90, 0.5);
assert.ok(Math.abs(quatAngleDeg(q0, qMid) - 45) < 1e-4);
assert.ok(Math.abs(quatAngleDeg(qMid, q90) - 45) < 1e-4);

// Full 360-degree pitch flip via SQUAD: test smooth monotonic forward motion of +Y vector
const flipKeys = [
  { time: 0, quat: q0, curve: { kind: 'smooth' } as const },
  { time: 0.25, quat: q90, curve: { kind: 'smooth' } as const },
  { time: 0.5, quat: q180, curve: { kind: 'smooth' } as const },
  { time: 0.75, quat: q270, curve: { kind: 'smooth' } as const },
  { time: 1.0, quat: q0, curve: { kind: 'smooth' } as const },
];
let prevQ = sampleQuatKeys(flipKeys, 0, evaluateCurve, true, 1);
for (let i = 1; i <= 40; i += 1) {
  const q = sampleQuatKeys(flipKeys, i / 40, evaluateCurve, true, 1);
  const stepDeg = quatAngleDeg(prevQ, q);
  assert.ok(stepDeg > 7 && stepDeg < 12, `gimbal flip or stall at step ${i}: ${stepDeg} deg`);
  prevQ = q;
}
const s0 = computeSquadControl(q270, q0, q90);
const s1 = computeSquadControl(q0, q90, q180);
const sq = squadQuat(q0, q90, s0, s1, 0.5);
assert.ok(
  Math.abs(rotateVec3ByQuat([0, 1, 0], sq)[0]) < 1e-5,
  'pitch rotation must stay in YZ plane',
);

// Rest + base + override + additive composition
const qRest = quatFromEulerXyzDeg([10, 0, 0]);
const qBase = quatFromEulerXyzDeg([20, 0, 0]);
const qOver = quatFromEulerXyzDeg([50, 0, 0]);
const qAdd = quatFromEulerXyzDeg([0, 15, 0]);
const composed = composeJointQuat(qRest, qBase, qOver, 0.5, qAdd);
const expected = mulQuat(mulQuat(qRest, slerpQuat(qBase, qOver, 0.5)), qAdd);
assert.ok(quatAngleDeg(composed, expected) < 1e-6);
assert.ok(quatAngleDeg(composeJointQuat(IDENTITY_QUAT, qBase), qBase) < 1e-6);

// 5. Periodic 2D-torus wave & breath/flap closure
const period = 1.6;
const w0 = evaluatePeriodicSimplex(0, period, 2.5, 4, 7);
const wEnd = evaluatePeriodicSimplex(period, period, 2.5, 4, 7);
assert.ok(Math.abs(w0 - wEnd) <= 1e-9, `torus wave did not close: ${w0} vs ${wEnd}`);
const wDt = 1e-5;
const dw0 =
  (evaluatePeriodicSimplex(wDt, period, 2.5, 4, 7) -
    evaluatePeriodicSimplex(-wDt, period, 2.5, 4, 7)) /
  (2 * wDt);
const dwEnd =
  (evaluatePeriodicSimplex(period + wDt, period, 2.5, 4, 7) -
    evaluatePeriodicSimplex(period - wDt, period, 2.5, 4, 7)) /
  (2 * wDt);
assert.ok(Math.abs(dw0 - dwEnd) <= 1e-6, `torus wave velocity mismatch: ${dw0} vs ${dwEnd}`);

const inhalePeak = evaluateBreath(0.42 * 2, 2, 0.42);
assert.ok(Math.abs(inhalePeak - 1) < 1e-6);
assert.ok(Math.abs(evaluateBreath(0, 2, 0.42)) < 1e-6);
const flapDown = evaluateFlap(0.19, 1, 0.38, 1.5);
const flapEnd = evaluateFlap(1, 1, 0.38, 1.5);
const flapStart = evaluateFlap(0, 1, 0.38, 1.5);
assert.ok(Math.abs(flapEnd.wing - flapStart.wing) < 1e-6);
assert.ok(flapDown.comLift > 0, 'downstroke must produce positive CoM lift');
