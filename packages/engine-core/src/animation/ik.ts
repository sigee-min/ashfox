import { add3, dot3, length3, normalize3, scale3, sub3 } from '../math/vec3';
import type { ClipSpec, FootLockWindow, IkLimbSpec, Quat, RigJoint, Vec3 } from './contract';
import {
  IDENTITY_QUAT,
  conjugateQuat,
  mulQuat,
  quatBetweenVectors,
  rotateVec3ByQuat,
} from './quat';

const EPS = 1e-6;

export interface TwoBoneIkInput {
  readonly rootPos: Vec3;
  readonly targetPos: Vec3;
  readonly poleDir: Vec3;
  readonly upperLen: number;
  readonly lowerLen: number;
  readonly restUpperDir?: Vec3;
  readonly restLowerDir?: Vec3;
  readonly softScale?: number;
}

export interface TwoBoneIkResult {
  readonly midPos: Vec3;
  readonly endPos: Vec3;
  readonly upperDir: Vec3;
  readonly lowerDir: Vec3;
  readonly upperDeltaQuat: Quat;
  readonly lowerDeltaQuat: Quat;
  readonly softClamped: boolean;
}

const clampCos = (v: number): number => Math.max(-1, Math.min(1, v));

const computeEffectiveReach = (
  dist: number,
  upperLen: number,
  lowerLen: number,
  softScale: number,
): { readonly reach: number; readonly clamped: boolean } => {
  const minReach = Math.abs(upperLen - lowerLen) + 1e-4;
  const maxReach = upperLen + lowerLen - 1e-4;
  const softDist = maxReach * Math.min(0.995, Math.max(0.85, softScale));
  if (dist <= minReach) return { reach: minReach, clamped: true };
  if (dist <= softDist) return { reach: dist, clamped: false };
  const margin = Math.max(1e-4, maxReach - softDist);
  const soft = softDist + margin * (1 - Math.exp(-(dist - softDist) / margin));
  return { reach: Math.min(maxReach, soft), clamped: true };
};

const orthogonalPole = (dir: Vec3, poleDir: Vec3): Vec3 => {
  const proj = dot3(poleDir, dir);
  const perp = sub3(poleDir, scale3(dir, proj));
  if (length3(perp) > 1e-4) return normalize3(perp);
  const fallback: Vec3 = Math.abs(dir[2]) < 0.9 ? [0, 0, -1] : [1, 0, 0];
  const fbPerp = sub3(fallback, scale3(dir, dot3(fallback, dir)));
  return normalize3(fbPerp);
};

/**
 * Deterministic 2-bone analytical Law-of-Cosines IK with pole projection and Soft-IK clamp.
 */
export const solveTwoBoneIk = (input: TwoBoneIkInput): TwoBoneIkResult => {
  const uLen = Math.max(1e-4, input.upperLen);
  const lLen = Math.max(1e-4, input.lowerLen);
  const delta = sub3(input.targetPos, input.rootPos);
  const dist = length3(delta);
  const aimDir =
    dist > EPS ? scale3(delta, 1 / dist) : normalize3(input.restUpperDir ?? [0, -1, 0]);
  const { reach, clamped } = computeEffectiveReach(dist, uLen, lLen, input.softScale ?? 0.97);

  const cosAlpha = clampCos((uLen * uLen + reach * reach - lLen * lLen) / (2 * uLen * reach));
  const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));
  const pole = orthogonalPole(aimDir, input.poleDir);

  const midPos = add3(
    input.rootPos,
    add3(scale3(aimDir, uLen * cosAlpha), scale3(pole, uLen * sinAlpha)),
  );
  const endPos = add3(input.rootPos, scale3(aimDir, reach));

  const upperDir = normalize3(sub3(midPos, input.rootPos));
  const lowerDir = normalize3(sub3(endPos, midPos));
  const restUpper = normalize3(input.restUpperDir ?? [0, -1, 0]);
  const restLower = normalize3(input.restLowerDir ?? [0, -1, 0]);
  const upperDeltaQuat = quatBetweenVectors(restUpper, upperDir);
  const lowerDeltaQuat = quatBetweenVectors(restLower, lowerDir);

  return {
    midPos,
    endPos,
    upperDir,
    lowerDir,
    upperDeltaQuat: upperDeltaQuat ?? IDENTITY_QUAT,
    lowerDeltaQuat: lowerDeltaQuat ?? IDENTITY_QUAT,
    softClamped: clamped,
  };
};

export interface FootLockSampleInput {
  readonly time: number;
  readonly phase: number;
  readonly hipWorldPos: Vec3;
  readonly desiredFootWorldPos: Vec3;
}

export interface FootLockInput {
  readonly samples: readonly FootLockSampleInput[];
  readonly windows: readonly FootLockWindow[];
  readonly groundY: number;
  readonly poleDir: Vec3;
  readonly upperLen: number;
  readonly lowerLen: number;
  readonly restUpperDir?: Vec3;
  readonly restLowerDir?: Vec3;
  readonly blendMargin?: number;
}

export interface FootLockFrameResult {
  readonly time: number;
  readonly footWorldPos: Vec3;
  readonly grounded: boolean;
  readonly ik: TwoBoneIkResult;
}

const windowWeight = (phase: number, window: FootLockWindow, margin: number): number => {
  if (phase < window.start || phase > window.end) return 0;
  const span = window.end - window.start;
  if (span <= EPS) return 1;
  const m = Math.min(margin, 0.25 * span);
  if (m <= EPS) return 1;
  if (phase < window.start + m) return (phase - window.start) / m;
  if (phase > window.end - m) return (window.end - phase) / m;
  return 1;
};

const activeWindowWeight = (
  phase: number,
  windows: readonly FootLockWindow[],
  margin: number,
): { readonly windowIndex: number; readonly weight: number } => {
  let bestIdx = -1;
  let bestWeight = 0;
  for (let i = 0; i < windows.length; i += 1) {
    const w = windowWeight(phase, windows[i]!, margin);
    if (w > bestWeight) {
      bestWeight = w;
      bestIdx = i;
    }
  }
  return { windowIndex: bestIdx, weight: bestWeight };
};

/**
 * Pin stance feet to `y = groundY` and plant XZ during `foot_lock` windows, solving 2-bone IK.
 */
export const solveFootLock = (input: FootLockInput): readonly FootLockFrameResult[] => {
  const margin = input.blendMargin ?? 0.04;
  const windowAnchors = new Map<number, Vec3>();
  for (let i = 0; i < input.samples.length; i += 1) {
    const sample = input.samples[i]!;
    const active = activeWindowWeight(sample.phase, input.windows, margin);
    if (active.windowIndex >= 0 && !windowAnchors.has(active.windowIndex)) {
      windowAnchors.set(active.windowIndex, [
        sample.desiredFootWorldPos[0],
        input.groundY,
        sample.desiredFootWorldPos[2],
      ]);
    }
  }

  return input.samples.map((sample) => {
    const active = activeWindowWeight(sample.phase, input.windows, margin);
    const desiredClamped: Vec3 = [
      sample.desiredFootWorldPos[0],
      Math.max(input.groundY, sample.desiredFootWorldPos[1]),
      sample.desiredFootWorldPos[2],
    ];
    let target = desiredClamped;
    if (active.windowIndex >= 0 && active.weight > 0) {
      const anchor = windowAnchors.get(active.windowIndex) ?? desiredClamped;
      const w = active.weight;
      target = [
        desiredClamped[0] + (anchor[0] - desiredClamped[0]) * w,
        desiredClamped[1] + (input.groundY - desiredClamped[1]) * w,
        desiredClamped[2] + (anchor[2] - desiredClamped[2]) * w,
      ];
    }
    const ik = solveTwoBoneIk({
      rootPos: sample.hipWorldPos,
      targetPos: target,
      poleDir: input.poleDir,
      upperLen: input.upperLen,
      lowerLen: input.lowerLen,
      restUpperDir: input.restUpperDir,
      restLowerDir: input.restLowerDir,
    });
    return {
      time: sample.time,
      footWorldPos: [ik.endPos[0], Math.max(input.groundY, ik.endPos[1]), ik.endPos[2]],
      grounded: active.weight > 0.5 || target[1] <= input.groundY + 0.05,
      ik,
    };
  });
};

export interface IkSampledFrame {
  readonly time: number;
  readonly pose: Record<
    string,
    { readonly position: Vec3; readonly rotation: Quat; readonly scale: Vec3 }
  >;
}

export const computeWorldTransforms = (
  joints: readonly RigJoint[],
  localPose: Readonly<Record<string, { readonly position: Vec3; readonly rotation: Quat }>>,
): Map<string, { readonly pos: Vec3; readonly quat: Quat }> => {
  const world = new Map<string, { readonly pos: Vec3; readonly quat: Quat }>();
  const resolve = (
    id: string,
    visiting: Set<string>,
  ): { readonly pos: Vec3; readonly quat: Quat } => {
    const cached = world.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return { pos: [0, 0, 0], quat: IDENTITY_QUAT };
    const joint = joints.find((j) => j.id === id);
    const local = localPose[id];
    if (!joint || !local) return { pos: [0, 0, 0], quat: IDENTITY_QUAT };
    if (!joint.parentId) {
      const val = { pos: local.position, quat: local.rotation };
      world.set(id, val);
      return val;
    }
    visiting.add(id);
    const parent = resolve(joint.parentId, visiting);
    visiting.delete(id);
    const val = {
      pos: add3(parent.pos, rotateVec3ByQuat(local.position, parent.quat)),
      quat: mulQuat(parent.quat, local.rotation),
    };
    world.set(id, val);
    return val;
  };
  for (const j of joints) resolve(j.id, new Set());
  return world;
};

const buildIkSamples = (
  frames: readonly IkSampledFrame[],
  clip: ClipSpec,
  upperJoint: RigJoint,
  limb: IkLimbSpec,
  upperLen: number,
  lowerLen: number,
  targets: readonly { readonly time: number; readonly offset: Vec3 }[] | undefined,
) =>
  frames.map((frame, i) => {
    const world = computeWorldTransforms(clip.rig.joints, frame.pose);
    const hipPos = world.get(upperJoint.id)?.pos ?? [0, upperLen + lowerLen, 0];
    const parentWorldQuat = upperJoint.parentId
      ? (world.get(upperJoint.parentId)?.quat ?? IDENTITY_QUAT)
      : IDENTITY_QUAT;
    const tIdx = targets
      ? Math.min(
          targets.length - 1,
          Math.round((i / Math.max(1, frames.length - 1)) * (targets.length - 1)),
        )
      : 0;
    const sample = targets?.[tIdx];
    const desiredFoot: Vec3 = sample
      ? [
          hipPos[0] + sample.offset[0],
          (limb.ground ?? 0) + sample.offset[1],
          hipPos[2] + sample.offset[2],
        ]
      : [
          hipPos[0],
          Math.max(limb.ground ?? 0, hipPos[1] - (upperLen + lowerLen) * 0.92),
          hipPos[2],
        ];
    return {
      time: frame.time,
      phase: clip.duration > EPS ? frame.time / clip.duration : 0,
      hipWorldPos: hipPos,
      desiredFootWorldPos: desiredFoot,
      parentWorldQuat,
    };
  });

const writeIkFrame = (
  frame: IkSampledFrame,
  upperJoint: RigJoint,
  lowerJoint: RigJoint,
  parentWorldQuat: Quat,
  upperDir: Vec3,
  lowerDir: Vec3,
  localUpperAxis: Vec3,
  localLowerAxis: Vec3,
): void => {
  const upperRestWorld = mulQuat(parentWorldQuat, upperJoint.restRotation);
  const restUpperDir = rotateVec3ByQuat(localUpperAxis, upperRestWorld);
  const upperWorldQuat = mulQuat(quatBetweenVectors(restUpperDir, upperDir), upperRestWorld);
  const lowerRestWorld = mulQuat(upperWorldQuat, lowerJoint.restRotation);
  const restLowerDir = rotateVec3ByQuat(localLowerAxis, lowerRestWorld);
  const lowerWorldQuat = mulQuat(quatBetweenVectors(restLowerDir, lowerDir), lowerRestWorld);
  frame.pose[upperJoint.id] = {
    ...frame.pose[upperJoint.id]!,
    rotation: mulQuat(conjugateQuat(parentWorldQuat), upperWorldQuat),
  };
  frame.pose[lowerJoint.id] = {
    ...frame.pose[lowerJoint.id]!,
    rotation: mulQuat(conjugateQuat(upperWorldQuat), lowerWorldQuat),
  };
};

const resolveLimbAxes = (clip: ClipSpec, limb: IkLimbSpec) => {
  const upperJoint = clip.rig.joints.find((j) => j.id === limb.chain[0]);
  const lowerJoint = clip.rig.joints.find((j) => j.id === limb.chain[1]);
  if (!upperJoint || !lowerJoint) return null;
  const endJoint = limb.endEffectorId
    ? clip.rig.joints.find((j) => j.id === limb.endEffectorId)
    : undefined;
  const upperLen = Math.max(0.5, length3(lowerJoint.restPosition));
  const hasEnd = endJoint !== undefined && length3(endJoint.restPosition) > EPS;
  const lowerLen = Math.max(0.5, hasEnd ? length3(endJoint.restPosition) : upperLen);
  const localUpperAxis: Vec3 =
    length3(lowerJoint.restPosition) > EPS ? normalize3(lowerJoint.restPosition) : [0, -1, 0];
  const localLowerAxis: Vec3 = hasEnd ? normalize3(endJoint.restPosition) : localUpperAxis;
  return { upperJoint, lowerJoint, upperLen, lowerLen, localUpperAxis, localLowerAxis };
};

type ResolvedLimbGeo = NonNullable<ReturnType<typeof resolveLimbAxes>>;
type IkSampleList = ReturnType<typeof buildIkSamples>;

const applyFreeIkFrames = (
  frames: IkSampledFrame[],
  samples: IkSampleList,
  poleDir: Vec3,
  geo: ResolvedLimbGeo,
): void => {
  for (let i = 0; i < frames.length; i += 1) {
    const s = samples[i]!;
    const ik = solveTwoBoneIk({
      rootPos: s.hipWorldPos,
      targetPos: s.desiredFootWorldPos,
      poleDir,
      upperLen: geo.upperLen,
      lowerLen: geo.lowerLen,
    });
    writeIkFrame(
      frames[i]!,
      geo.upperJoint,
      geo.lowerJoint,
      s.parentWorldQuat,
      ik.upperDir,
      ik.lowerDir,
      geo.localUpperAxis,
      geo.localLowerAxis,
    );
  }
};

export const applyIkLimbPass = (
  frames: IkSampledFrame[],
  clip: ClipSpec,
  limb: IkLimbSpec,
  gaitContacts: Readonly<
    Record<string, readonly { readonly start: number; readonly end: number }[]>
  >,
  gaitTargets: Readonly<
    Record<string, readonly { readonly time: number; readonly offset: Vec3 }[]>
  >,
): void => {
  const geo = resolveLimbAxes(clip, limb);
  if (!geo) return;
  const windows = limb.footLockWindows ?? gaitContacts[limb.id] ?? [];
  const samples = buildIkSamples(
    frames,
    clip,
    geo.upperJoint,
    limb,
    geo.upperLen,
    geo.lowerLen,
    gaitTargets[limb.id],
  );
  if (windows.length === 0) {
    applyFreeIkFrames(frames, samples, limb.pole, geo);
    return;
  }
  const solved = solveFootLock({
    samples,
    windows,
    groundY: limb.ground ?? 0,
    poleDir: limb.pole,
    upperLen: geo.upperLen,
    lowerLen: geo.lowerLen,
  });
  for (let i = 0; i < frames.length; i += 1) {
    writeIkFrame(
      frames[i]!,
      geo.upperJoint,
      geo.lowerJoint,
      samples[i]!.parentWorldQuat,
      solved[i]!.ik.upperDir,
      solved[i]!.ik.lowerDir,
      geo.localUpperAxis,
      geo.localLowerAxis,
    );
  }
};
