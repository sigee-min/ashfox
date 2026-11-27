import { compareText } from '@ashfox/internal-contracts';
import { deepFreeze } from '../immutable';
import { add3, length3, mul3, sub3 } from '../math/vec3';
import type {
  BakedChannel,
  BakedClip,
  BakedKey,
  ClipSpec,
  CueEvent,
  Quat,
  RigJoint,
  SecondarySpec,
  Vec3,
} from './contract';
import { collectCombatStepBoundaries, evaluateCombatForJoint, evaluateHitstop } from './combat';
import { applyIkLimbPass, computeWorldTransforms } from './ik';
import { evaluateLayerStack, prepareLayerEvaluator, type EvaluatedJointTransform } from './layers';
import { IDENTITY_QUAT, mulQuat, quatAngleDeg, slerpQuat } from './quat';
import { SPRING_SUBSTEP_HZ, solveSecondaryChain, type SecondaryJointInput } from './spring';

const DEFAULT_ANGLE_TOL_DEG = 0.15;
const DEFAULT_POS_TOL = 0.002;
const EPS = 1e-6;

export interface BakeClipOptions {
  readonly sampleHz?: number;
  readonly angleToleranceDeg?: number;
  readonly positionTolerance?: number;
}

const cleanZero = (n: number): number => (Math.abs(n) < 1e-6 ? 0 : Number(n.toFixed(6)));
const cleanVec3 = (v: Vec3): Vec3 => [cleanZero(v[0]), cleanZero(v[1]), cleanZero(v[2])];
const cleanQuat = (q: Quat): Quat => [
  cleanZero(q[0]),
  cleanZero(q[1]),
  cleanZero(q[2]),
  cleanZero(q[3]),
];

const lerpVec3 = (a: Vec3, b: Vec3, u: number): Vec3 => [
  a[0] + (b[0] - a[0]) * u,
  a[1] + (b[1] - a[1]) * u,
  a[2] + (b[2] - a[2]) * u,
];

interface SampledFrame {
  readonly time: number;
  readonly pose: Record<string, EvaluatedJointTransform>;
}

const applySecondaryPass = (frames: SampledFrame[], clip: ClipSpec, spec: SecondarySpec): void => {
  const chainJointIds =
    spec.targetKind === 'chain'
      ? (clip.rig.chains?.find((c) => c.id === spec.targetId)?.joints ?? [])
      : [spec.targetId];
  const joints = chainJointIds
    .map((id) => clip.rig.joints.find((j) => j.id === id))
    .filter((j): j is RigJoint => j !== undefined);
  if (joints.length === 0) return;

  const rootJoint = joints[0]!;
  const parentSamples = frames.map((frame) => {
    const world = computeWorldTransforms(clip.rig.joints, frame.pose);
    const parentWorld = rootJoint.parentId ? world.get(rootJoint.parentId) : undefined;
    return {
      time: frame.time,
      worldPos: parentWorld?.pos ?? [0, 0, 0],
      worldQuat: parentWorld?.quat ?? IDENTITY_QUAT,
    };
  });

  const jointInputs: SecondaryJointInput[] = joints.map((joint) => ({
    jointId: joint.id,
    restRotation: joint.restRotation,
    limits: joint.limits,
    targetLocalQuats: frames.map((f) => f.pose[joint.id]?.rotation ?? joint.restRotation),
  }));

  const solvedChannels = solveSecondaryChain({
    spec,
    joints: jointInputs,
    parentSamples,
    duration: clip.duration,
    loop: clip.loop === 'loop',
  });

  for (const ch of solvedChannels) {
    for (let i = 0; i < frames.length; i += 1) {
      const k = ch.keys[Math.min(ch.keys.length - 1, i)];
      if (!k) continue;
      const q = k.value as Quat;
      frames[i]!.pose[ch.jointId] = { ...frames[i]!.pose[ch.jointId]!, rotation: q };
    }
  }
};

const splitSpanIndices = (
  times: readonly number[],
  stepMarks: readonly number[],
): readonly number[] => {
  const indices = new Set<number>([0, times.length - 1]);
  for (const mark of stepMarks) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < times.length; i += 1) {
      const d = Math.abs(times[i]! - mark);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0 && bestDist <= 0.015) {
      if (best > 0) indices.add(best - 1);
      indices.add(best);
    }
  }
  return [...indices].sort((a, b) => a - b);
};

const rdpCollect = <T>(
  items: readonly { readonly time: number; readonly val: T }[],
  lo: number,
  hi: number,
  tol: number,
  errorFn: (a: T, b: T, u: number, actual: T) => number,
  out: Set<number>,
): void => {
  if (hi - lo <= 1) return;
  const start = items[lo]!;
  const end = items[hi]!;
  const span = Math.max(EPS, end.time - start.time);
  let maxErr = -1;
  let maxIdx = -1;
  for (let i = lo + 1; i < hi; i += 1) {
    const curr = items[i]!;
    const u = (curr.time - start.time) / span;
    const err = Number(errorFn(start.val, end.val, u, curr.val).toFixed(6));
    if (err > maxErr) {
      maxErr = err;
      maxIdx = i;
    }
  }
  if (maxErr > tol && maxIdx > lo && maxIdx < hi) {
    out.add(maxIdx);
    rdpCollect(items, lo, maxIdx, tol, errorFn, out);
    rdpCollect(items, maxIdx, hi, tol, errorFn, out);
  }
};

const decimateSamples = <T extends Vec3 | Quat>(
  samples: readonly { readonly time: number; readonly val: T }[],
  stepBoundaries: readonly number[],
  tolerance: number,
  errorFn: (a: T, b: T, u: number, actual: T) => number,
  cleanFn: (val: T) => T,
): readonly BakedKey[] => {
  if (samples.length === 0) return [];
  if (samples.length === 1) {
    return [
      {
        time: cleanZero(samples[0]!.time),
        value: cleanFn(samples[0]!.val),
        interpolation: 'linear',
      },
    ];
  }
  const splits = splitSpanIndices(
    samples.map((s) => s.time),
    stepBoundaries,
  );
  const stepSet = new Set(stepBoundaries.map((b) => Number(b.toFixed(4))));
  const keep = new Set<number>(splits);
  for (let s = 0; s < splits.length - 1; s += 1) {
    rdpCollect(samples, splits[s]!, splits[s + 1]!, tolerance, errorFn, keep);
  }
  return [...keep]
    .sort((a, b) => a - b)
    .map((idx) => {
      const sample = samples[idx]!;
      return {
        time: Number(cleanZero(sample.time).toFixed(6)),
        value: cleanFn(sample.val),
        interpolation: stepSet.has(Number(sample.time.toFixed(4))) ? 'step' : 'linear',
      };
    });
};

/** Quaternion-aware Ramer-Douglas-Peucker decimation preserving STEP boundaries. */
export const decimateQuatSamples = (
  samples: readonly { readonly time: number; readonly val: Quat }[],
  stepBoundaries: readonly number[],
  toleranceDeg = DEFAULT_ANGLE_TOL_DEG,
): readonly BakedKey[] =>
  decimateSamples(
    samples,
    stepBoundaries,
    toleranceDeg,
    (a, b, u, actual) => quatAngleDeg(actual, slerpQuat(a, b, u)),
    cleanQuat,
  );

/** Vec3 Ramer-Douglas-Peucker decimation preserving STEP boundaries. */
export const decimateVec3Samples = (
  samples: readonly { readonly time: number; readonly val: Vec3 }[],
  stepBoundaries: readonly number[],
  tolerance = DEFAULT_POS_TOL,
): readonly BakedKey[] =>
  decimateSamples(
    samples,
    stepBoundaries,
    tolerance,
    (a, b, u, actual) => length3(sub3(actual, lerpVec3(a, b, u))),
    cleanVec3,
  );

const dedupeAndSortCues = (cues: readonly CueEvent[]): readonly CueEvent[] => {
  const seen = new Set<string>();
  const unique: CueEvent[] = [];
  const sorted = [...cues].sort(
    (a, b) => a.time - b.time || compareText(a.kind, b.kind) || compareText(a.name, b.name),
  );
  for (const cue of sorted) {
    const key = `${cue.time.toFixed(6)}:${cue.kind}:${cue.name}:${cue.anchor ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...cue, time: Number(cleanZero(cue.time).toFixed(6)) });
  }
  return unique;
};

const sampleBaseFrames = (
  clip: ClipSpec,
  evaluator: ReturnType<typeof prepareLayerEvaluator>,
  totalSteps: number,
): SampledFrame[] => {
  const frames: SampledFrame[] = [];
  for (let i = 0; i <= totalSteps; i += 1) {
    const t = Number(((i / totalSteps) * clip.duration).toFixed(6));
    const hit = evaluateHitstop(clip.combat?.hitstops, t);
    const basePose = evaluateLayerStack(evaluator, hit.evalTime);
    const mutablePose: Record<string, EvaluatedJointTransform> = {};
    for (const j of clip.rig.joints) mutablePose[j.id] = basePose[j.id]!;
    frames.push({ time: t, pose: mutablePose });
  }
  return frames;
};

const applyCombatPass = (frames: SampledFrame[], clip: ClipSpec): void => {
  for (const frame of frames) {
    const hit = evaluateHitstop(clip.combat?.hitstops, frame.time);
    for (const j of clip.rig.joints) {
      const mod = evaluateCombatForJoint(clip.combat, j.id, frame.time);
      const curr = frame.pose[j.id]!;
      const applyShake = hit.frozen && (j.role === 'root' || j.role === 'pelvis');
      const shake: Vec3 = applyShake ? hit.shakeOffset : [0, 0, 0];
      frame.pose[j.id] = {
        position: add3(curr.position, add3(mod.positionOffset, shake)),
        rotation: mulQuat(curr.rotation, mod.rotationDelta),
        scale: mul3(curr.scale, mod.scaleMultiplier),
      };
    }
  }
};

const bakeJointChannels = (
  joint: RigJoint,
  frames: readonly SampledFrame[],
  stepMarks: readonly number[],
  posTol: number,
  angleTol: number,
): BakedChannel[] => {
  const channels: BakedChannel[] = [];
  if (joint.channels.includes('position')) {
    channels.push({
      jointId: joint.id,
      property: 'position',
      keys: decimateVec3Samples(
        frames.map((f) => ({ time: f.time, val: f.pose[joint.id]!.position })),
        stepMarks,
        posTol,
      ),
    });
  }
  if (joint.channels.includes('rotation')) {
    channels.push({
      jointId: joint.id,
      property: 'rotation',
      keys: decimateQuatSamples(
        frames.map((f) => ({ time: f.time, val: f.pose[joint.id]!.rotation })),
        stepMarks,
        angleTol,
      ),
    });
  }
  if (joint.channels.includes('scale')) {
    channels.push({
      jointId: joint.id,
      property: 'scale',
      keys: decimateVec3Samples(
        frames.map((f) => ({ time: f.time, val: f.pose[joint.id]!.scale })),
        stepMarks,
        posTol,
      ),
    });
  }
  return channels;
};

/**
 * Full 120Hz deterministic Animation pipeline:
 * Layer Stack -> IK & Foot-Lock -> RK4 Secondary Physics -> Combat Ops -> Quat RDP Bake + Cues.
 */
export const bakeClip = (clip: ClipSpec, options?: BakeClipOptions): BakedClip => {
  const hz = options?.sampleHz ?? SPRING_SUBSTEP_HZ;
  const angleTol = options?.angleToleranceDeg ?? DEFAULT_ANGLE_TOL_DEG;
  const posTol = options?.positionTolerance ?? DEFAULT_POS_TOL;
  const totalSteps = Math.max(2, Math.round(Math.max(0.05, clip.duration) * hz));
  const evaluator = prepareLayerEvaluator(clip);
  const frames = sampleBaseFrames(clip, evaluator, totalSteps);

  for (const limb of clip.rig.ikLimbs ?? []) {
    applyIkLimbPass(frames, clip, limb, evaluator.gaitContacts, evaluator.gaitFootTargets);
  }
  for (const sec of clip.secondaries ?? []) {
    applySecondaryPass(frames, clip, sec);
  }
  applyCombatPass(frames, clip);

  const stepMarks = collectCombatStepBoundaries(clip.combat);
  const sortedJoints = [...clip.rig.joints].sort((a, b) => compareText(a.id, b.id));
  const channels = sortedJoints.flatMap((j) =>
    bakeJointChannels(j, frames, stepMarks, posTol, angleTol),
  );

  return deepFreeze({
    id: clip.id,
    name: clip.name,
    duration: clip.duration,
    fps: clip.fps,
    loop: clip.loop,
    channels,
    cues: dedupeAndSortCues([...(clip.cues ?? []), ...evaluator.gaitCues]),
    sampledFrames: frames.length,
  });
};
