import assert from 'node:assert/strict';
import { bakeClip } from '../../src/animation/bake';
import { computeVolumePreservingSquash } from '../../src/animation/combat';
import type { ClipSpec, Quat, RigSpec, Vec3 } from '../../src/animation/contract';
import { compileGait } from '../../src/animation/gait';
import { solveFootLock, solveTwoBoneIk } from '../../src/animation/ik';
import {
  IDENTITY_QUAT,
  mulQuat,
  quatAngleDeg,
  quatFromEulerXyzDeg,
  quatToRotVec,
  rotateVec3ByQuat,
} from '../../src/animation/quat';
import { SPRING_SUBSTEP_HZ, solveSecondaryChain } from '../../src/animation/spring';

// 1. 2-Bone Analytical IK & Soft-IK hyperextension clamp
const ikReachable = solveTwoBoneIk({
  rootPos: [0, 10, 0],
  targetPos: [0, 3, -3],
  poleDir: [0, 0, -1],
  upperLen: 5,
  lowerLen: 5,
});
assert.equal(ikReachable.softClamped, false);
const dUpper = Math.hypot(
  ikReachable.midPos[0] - 0,
  ikReachable.midPos[1] - 10,
  ikReachable.midPos[2] - 0,
);
const dLower = Math.hypot(
  ikReachable.endPos[0] - ikReachable.midPos[0],
  ikReachable.endPos[1] - ikReachable.midPos[1],
  ikReachable.endPos[2] - ikReachable.midPos[2],
);
assert.ok(Math.abs(dUpper - 5) < 1e-5 && Math.abs(dLower - 5) < 1e-5);
assert.ok(ikReachable.midPos[2] < ikReachable.endPos[2], 'knee must bend toward pole (0,0,-1)');

const ikOver = solveTwoBoneIk({
  rootPos: [0, 10, 0],
  targetPos: [0, -5, 0],
  poleDir: [0, 0, -1],
  upperLen: 5,
  lowerLen: 5,
});
assert.equal(ikOver.softClamped, true);
assert.ok(10 - ikOver.endPos[1] < 10, 'Soft-IK must prevent full 180-deg hyperextension');

// 2. foot_lock ground pin solver
const footFrames = solveFootLock({
  samples: Array.from({ length: 21 }, (_, i) => {
    const phase = i / 20;
    return {
      time: phase,
      phase,
      hipWorldPos: [0, 9.2 - Math.sin(phase * Math.PI) * 1.2, phase * 4],
      desiredFootWorldPos: [0, phase <= 0.5 ? -0.3 : 2.5, phase * 4],
    };
  }),
  windows: [{ start: 0, end: 0.48 }],
  groundY: 0,
  poleDir: [0, 0, -1],
  upperLen: 5.5,
  lowerLen: 5.5,
});
for (const frame of footFrames) {
  assert.ok(frame.footWorldPos[1] >= -1e-6, `foot penetrated ground: ${frame.footWorldPos[1]}`);
  if (frame.time >= 0.05 && frame.time <= 0.42) {
    assert.ok(Math.abs(frame.footWorldPos[1]) < 0.05, 'stance foot must stay pinned to y=0');
  }
}
const plantedZStart = footFrames[2]!.footWorldPos[2];
const plantedZEnd = footFrames[8]!.footWorldPos[2];
assert.ok(Math.abs(plantedZEnd - plantedZStart) < 0.05, 'stance foot must not slide on ground');

// 3. RK4 Spring: 2-cycle C1 loop closure + phase lag 30..180ms + limits clamping
const duration = 1.0;
const steps = SPRING_SUBSTEP_HZ;
const parentSamples = Array.from({ length: steps + 1 }, (_, i) => {
  const u = i / steps;
  const angle = Math.sin(u * Math.PI * 2) * 28;
  return {
    time: u * duration,
    worldPos: [0, Math.sin(u * Math.PI * 4) * 1.2, 0] as Vec3,
    worldQuat: quatFromEulerXyzDeg([angle, 0, 0]),
  };
});
const tailChannels = solveSecondaryChain({
  spec: {
    id: 'tail_sec',
    targetKind: 'chain',
    targetId: 'tail',
    stiffness: 16,
    damping: 0.32,
    gravity: 0.35,
    drag: 0.25,
  },
  joints: [
    {
      jointId: 'tail_base',
      restRotation: IDENTITY_QUAT,
      limits: { pitch: [-40, 40] },
      targetLocalQuats: parentSamples.map(() => IDENTITY_QUAT),
    },
    {
      jointId: 'tail_tip',
      restRotation: IDENTITY_QUAT,
      limits: { pitch: [-45, 45] },
      targetLocalQuats: parentSamples.map(() => IDENTITY_QUAT),
    },
  ],
  parentSamples,
  duration,
  loop: true,
});
assert.equal(tailChannels.length, 2);
for (const ch of tailChannels) {
  const first = ch.keys[0]!.value as Quat;
  const last = ch.keys[ch.keys.length - 1]!.value as Quat;
  assert.ok(quatAngleDeg(first, last) < 1e-4, `spring loop failed to close on ${ch.jointId}`);
}
// Measure signed phase lag between parent peak and tail_base / tail_tip peaks
let parentPeakIdx = 0;
let parentPeakVal = -Infinity;
let basePeakIdx = 0;
let basePeakVal = -Infinity;
let tipPeakIdx = 0;
let tipPeakVal = -Infinity;
for (let i = 0; i < steps; i += 1) {
  const pRad = quatToRotVec(parentSamples[i]!.worldQuat)[0];
  if (pRad > parentPeakVal) {
    parentPeakVal = pRad;
    parentPeakIdx = i;
  }
  const bRad = quatToRotVec(tailChannels[0]!.keys[i]!.value as Quat)[0];
  if (bRad > basePeakVal) {
    basePeakVal = bRad;
    basePeakIdx = i;
  }
  const tRad = quatToRotVec(tailChannels[1]!.keys[i]!.value as Quat)[0];
  if (tRad > tipPeakVal) {
    tipPeakVal = tRad;
    tipPeakIdx = i;
  }
}
const baseLagMs = (((basePeakIdx - parentPeakIdx + steps) % steps) / steps) * duration * 1000;
const tipLagMs = (((tipPeakIdx - parentPeakIdx + steps) % steps) / steps) * duration * 1000;
assert.ok(
  baseLagMs >= 30 && baseLagMs <= 180,
  `secondary base lag out of 30..180ms range: ${baseLagMs}ms`,
);
assert.ok(
  tipLagMs >= baseLagMs && tipLagMs <= 180,
  `secondary tip lag out of range: ${tipLagMs}ms`,
);

// 4. Volume-preserving squash V = 1
const sq = computeVolumePreservingSquash('y', -0.18, 10);
assert.ok(Math.abs(sq.volume - 1) < 1e-9, `volume not preserved: ${sq.volume}`);
assert.ok(sq.yCompensation < 0, 'Y squash must lower pivot to preserve ground contact');

// 5. Full bakeClip: Gait + Mirror + Hitstop STEP + RDP accuracy + Byte Determinism
const testRig: RigSpec = {
  joints: [
    {
      id: 'pelvis',
      parentId: null,
      role: 'pelvis',
      channels: ['position', 'rotation', 'scale'],
      restPosition: [0, 8, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'torso',
      parentId: 'pelvis',
      role: 'body',
      channels: ['rotation'],
      restPosition: [0, 5, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'head',
      parentId: 'torso',
      role: 'head',
      channels: ['rotation'],
      restPosition: [0, 5, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'shoulder_l',
      parentId: 'torso',
      role: 'arm',
      channels: ['rotation'],
      restPosition: [-4, 4, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'shoulder_r',
      parentId: 'torso',
      role: 'arm',
      channels: ['rotation'],
      restPosition: [4, 4, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
      mirror: 'shoulder_l',
    },
    {
      id: 'weapon',
      parentId: 'shoulder_r',
      role: 'weapon',
      channels: ['rotation', 'scale'],
      restPosition: [0, -5, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
  ],
  chains: [{ id: 'spine', joints: ['torso', 'head'] }],
};

const clipSpec: ClipSpec = {
  id: 'clip-cleave',
  name: 'flame_cleave',
  duration: 0.8,
  fps: 30,
  loop: 'once',
  rig: testRig,
  layers: [
    {
      id: 'base',
      mode: 'base',
      mirrorMode: 'antiphase',
      tracks: [
        {
          jointId: 'pelvis',
          property: 'position',
          keys: [
            { time: 0, value: [0, 0, 0] },
            { time: 0.25, value: [0, -1.6, 2], curve: { kind: 'anticipate', params: [0.3] } },
            { time: 0.4, value: [0, 0.5, -4], curve: { kind: 'snap' } },
            { time: 0.8, value: [0, 0, 0], curve: { kind: 'smooth' } },
          ],
        },
        {
          jointId: 'torso',
          property: 'rotation',
          keys: [
            { time: 0, value: [0, 0, 0] },
            { time: 0.25, value: [-12, -35, 0], curve: { kind: 'ease_out' } },
            { time: 0.4, value: [20, 45, 0], curve: { kind: 'snap' } },
            { time: 0.8, value: [0, 0, 0], curve: { kind: 'overshoot', params: [0.2] } },
          ],
        },
        {
          jointId: 'shoulder_l',
          property: 'rotation',
          keys: [
            { time: 0, value: [0, 0, 0] },
            { time: 0.4, value: [-55, 0, 0], curve: { kind: 'ease_in_out' } },
            { time: 0.8, value: [0, 0, 0], curve: { kind: 'smooth' } },
          ],
        },
      ],
    },
  ],
  secondaries: [
    { id: 'head_lag', targetKind: 'joint', targetId: 'head', stiffness: 18, damping: 0.4 },
  ],
  combat: {
    squashes: [
      { kind: 'squash', jointId: 'pelvis', at: 0.25, axis: 'y', amount: -0.14, pivotHeight: 8 },
    ],
    smears: [{ kind: 'smear', jointId: 'weapon', start: 0.35, end: 0.4, stretch: 1.65 }],
    hitstops: [{ kind: 'hitstop', at: 0.4, hold: 0.06, shake: 0.3 }],
    recoils: [{ kind: 'recoil', jointId: 'torso', at: 0.46, impulseDeg: [-12, 0, 0], decay: 0.16 }],
  },
  cues: [{ kind: 'vfx', time: 0.38, name: 'flame_cleave', anchor: 'weapon_tip' }],
};

const bakedA = bakeClip(clipSpec);
const bakedB = bakeClip(clipSpec);
assert.equal(JSON.stringify(bakedA), JSON.stringify(bakedB), 'bakeClip must be byte-deterministic');
const weaponScale = bakedA.channels.find((c) => c.jointId === 'weapon' && c.property === 'scale');
assert.ok(
  weaponScale?.keys.some((k) => k.interpolation === 'step'),
  'smear STEP boundary must be preserved',
);
const shoulderRRot = bakedA.channels.find(
  (c) => c.jointId === 'shoulder_r' && c.property === 'rotation',
);
assert.ok((shoulderRRot?.keys.length ?? 0) >= 3, 'mirror synthesis must populate shoulder_r');

// 6. All 7 GaitKinds compile cleanly with footstep cues
for (const kind of [
  'biped_walk',
  'biped_run',
  'biped_sneak',
  'quadruped_trot',
  'quadruped_gallop',
  'avian_glide',
  'hop',
] as const) {
  const g = compileGait({ kind }, 0.8, 30);
  assert.ok(g.tracks.length >= 6);
  if (kind !== 'avian_glide') assert.ok(g.cues.length >= 1, `${kind} must emit footstep cues`);
}

// 7. Two-bone IK foot-lock converts solved rotations into parent-local space
const ikClip = bakeClip({
  id: 'ik_parent_local_test',
  name: 'ik_parent_local_test',
  duration: 0.4,
  fps: 30,
  loop: 'once',
  rig: {
    joints: [
      {
        id: 'thigh',
        parentId: null,
        role: 'leg',
        channels: ['rotation'],
        restPosition: [0, 7, 0],
        restRotation: IDENTITY_QUAT,
        restScale: [1, 1, 1],
      },
      {
        id: 'shin',
        parentId: 'thigh',
        role: 'leg',
        channels: ['rotation'],
        restPosition: [0, -4, 0],
        restRotation: IDENTITY_QUAT,
        restScale: [1, 1, 1],
      },
      {
        id: 'foot',
        parentId: 'shin',
        role: 'leg',
        channels: ['rotation'],
        restPosition: [0, -4, 0],
        restRotation: IDENTITY_QUAT,
        restScale: [1, 1, 1],
      },
    ],
    ikLimbs: [
      {
        id: 'leg',
        chain: ['thigh', 'shin'],
        endEffectorId: 'foot',
        pole: [0, 0, -1],
        ground: 0,
        footLockWindows: [{ start: 0, end: 1 }],
      },
    ],
  },
  layers: [],
});
const thighRot = ikClip.channels.find((c) => c.jointId === 'thigh')?.keys[0]?.value as Quat;
const shinRot = ikClip.channels.find((c) => c.jointId === 'shin')?.keys[0]?.value as Quat;
assert.ok(thighRot && shinRot);
const shinWorld = mulQuat(thighRot, shinRot);
const kneePos = rotateVec3ByQuat([0, -4, 0], thighRot);
const footRelPos = rotateVec3ByQuat([0, -4, 0], shinWorld);
const footWorldPos: Vec3 = [
  kneePos[0] + footRelPos[0],
  7 + kneePos[1] + footRelPos[1],
  kneePos[2] + footRelPos[2],
];
assert.ok(
  Math.hypot(footWorldPos[0], footWorldPos[1], footWorldPos[2]) < 1e-2,
  `expected IK foot planted near (0,0,0), got ${JSON.stringify(footWorldPos)}`,
);

// 8. Secondary joint with non-identity restRotation does not double-apply restRotation
const rest30 = quatFromEulerXyzDeg([0, 0, 30]);
const restSecondaryClip = bakeClip({
  id: 'secondary_rest_test',
  name: 'secondary_rest_test',
  duration: 0.4,
  fps: 30,
  loop: 'once',
  rig: {
    joints: [
      {
        id: 'anchor',
        parentId: null,
        role: 'body',
        channels: ['rotation'],
        restPosition: [0, 0, 0],
        restRotation: IDENTITY_QUAT,
        restScale: [1, 1, 1],
      },
      {
        id: 'pendulum',
        parentId: 'anchor',
        role: 'tail',
        channels: ['rotation'],
        restPosition: [0, -4, 0],
        restRotation: rest30,
        restScale: [1, 1, 1],
      },
    ],
  },
  layers: [],
  secondaries: [
    {
      id: 'pendulum_sec',
      targetKind: 'joint',
      targetId: 'pendulum',
      stiffness: 20,
      damping: 0.5,
      gravity: 0,
      drag: 0,
    },
  ],
});
const pendRot = restSecondaryClip.channels.find((c) => c.jointId === 'pendulum')?.keys[0]
  ?.value as Quat;
assert.ok(pendRot, 'expected baked rotation channel for pendulum');
assert.ok(
  quatAngleDeg(pendRot, rest30) < 1e-2,
  `expected stationary pendulum frame 0 to remain near 30 deg restRotation, got diff=${quatAngleDeg(pendRot, rest30)}`,
);
