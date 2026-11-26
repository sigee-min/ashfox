import assert from 'node:assert/strict';
import { bakeClip } from '../../src/animation/bake';
import type { BakedClip, ClipSpec, RigSpec } from '../../src/animation/contract';
import { IDENTITY_QUAT, quatFromEulerXyzDeg } from '../../src/animation/quat';
import { evaluateMotionQuality } from '../../src/audit/motion';

const rig: RigSpec = {
  joints: [
    {
      id: 'pelvis',
      parentId: null,
      role: 'pelvis',
      channels: ['position', 'rotation'],
      restPosition: [0, 8, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'torso',
      parentId: 'pelvis',
      role: 'body',
      channels: ['rotation'],
      restPosition: [0, 4, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'head',
      parentId: 'torso',
      role: 'head',
      channels: ['rotation'],
      restPosition: [0, 4, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'thigh_l',
      parentId: 'pelvis',
      role: 'leg',
      channels: ['rotation'],
      restPosition: [-2, 0, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'shin_l',
      parentId: 'thigh_l',
      role: 'leg',
      channels: ['rotation'],
      restPosition: [0, -4, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'thigh_r',
      parentId: 'pelvis',
      role: 'leg',
      channels: ['rotation'],
      restPosition: [2, 0, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'shin_r',
      parentId: 'thigh_r',
      role: 'leg',
      channels: ['rotation'],
      restPosition: [0, -4, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'shoulder_l',
      parentId: 'torso',
      role: 'arm',
      channels: ['rotation'],
      restPosition: [-3, 3, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
    },
    {
      id: 'shoulder_r',
      parentId: 'torso',
      role: 'arm',
      channels: ['rotation'],
      restPosition: [3, 3, 0],
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1],
      mirror: 'shoulder_l',
    },
  ],
  chains: [{ id: 'spine', joints: ['torso', 'head'] }],
};

// 1. Rich motion: idle + gait run with secondary overlap + cues
const idleSpec: ClipSpec = {
  id: 'idle',
  name: 'idle',
  duration: 1.6,
  fps: 30,
  loop: 'loop',
  rig,
  layers: [
    {
      id: 'breath',
      mode: 'base',
      waves: [
        {
          jointId: 'pelvis',
          property: 'position',
          axis: 'y',
          spec: { kind: 'breath', period: 1.6, amp: 0.45 },
        },
        {
          jointId: 'torso',
          property: 'rotation',
          axis: 'x',
          spec: { kind: 'breath', period: 1.6, amp: 8 },
        },
      ],
    },
  ],
  secondaries: [
    { id: 'head_sec', targetKind: 'joint', targetId: 'head', stiffness: 15, damping: 0.35 },
  ],
};

const runSpec: ClipSpec = {
  id: 'run',
  name: 'run',
  duration: 0.64,
  fps: 30,
  loop: 'loop',
  rig,
  layers: [
    {
      id: 'gait',
      mode: 'base',
      gait: { kind: 'biped_run', bounce: 1.4, footstepSound: 'step_dirt' },
    },
  ],
  secondaries: [
    { id: 'head_sec', targetKind: 'joint', targetId: 'head', stiffness: 14, damping: 0.32 },
  ],
  cues: [{ kind: 'vfx', time: 0.32, name: 'dust_puff', anchor: 'foot_r' }],
};

const richReport = evaluateMotionQuality({
  clips: [bakeClip(idleSpec), bakeClip(runSpec)],
  joints: rig.joints,
  chains: rig.chains,
  footPositions: {
    left: [
      { time: 0, pos: [0, 0, 0], grounded: true },
      { time: 0.25, pos: [0, 0, 0.02], grounded: true },
      { time: 0.45, pos: [0, 2.5, 3], grounded: false },
    ],
  },
});
assert.equal(
  richReport.passed,
  true,
  `rich motion should pass: ${JSON.stringify(richReport.deductions)}`,
);
assert.ok(richReport.score >= 82, `expected high score for rich motion, got ${richReport.score}`);

// 2. Adversarial: Robot linear triangle wave + loop hitch + pinned root + sliding feet
const robotClip: BakedClip = {
  id: 'robot',
  name: 'walk',
  duration: 1.0,
  fps: 20,
  loop: 'loop',
  sampledFrames: 3,
  cues: [],
  channels: [
    {
      jointId: 'torso',
      property: 'rotation',
      keys: [
        { time: 0, value: quatFromEulerXyzDeg([0, 0, 0]), interpolation: 'linear' },
        { time: 0.5, value: quatFromEulerXyzDeg([15, 0, 0]), interpolation: 'linear' },
        { time: 1.0, value: quatFromEulerXyzDeg([1, 0, 0]), interpolation: 'linear' },
      ],
    },
    {
      jointId: 'head',
      property: 'rotation',
      keys: [
        { time: 0, value: quatFromEulerXyzDeg([0, 0, 0]), interpolation: 'linear' },
        { time: 0.5, value: quatFromEulerXyzDeg([15, 0, 0]), interpolation: 'linear' },
        { time: 1.0, value: quatFromEulerXyzDeg([1, 0, 0]), interpolation: 'linear' },
      ],
    },
  ],
};

const badReport = evaluateMotionQuality({
  clips: [robotClip],
  joints: rig.joints,
  chains: rig.chains,
  footPositions: {
    left: [
      { time: 0, pos: [0, -0.9, 0], grounded: true },
      { time: 0.5, pos: [0, -0.8, 3.5], grounded: true },
    ],
  },
});
assert.equal(badReport.passed, false, 'robotic hitched sliding clip must fail Motion Audit');
assert.ok(badReport.score < 55, `expected low score for robot clip, got ${badReport.score}`);
assert.ok(badReport.deductions.some((d) => d.includes('motion.loopContinuity')));
assert.ok(badReport.deductions.some((d) => d.includes('motion.weightAndRoot')));
assert.ok(badReport.deductions.some((d) => d.includes('motion.groundContact')));
assert.ok(badReport.deductions.some((d) => d.includes('motion.timingContrast')));
