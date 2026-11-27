import { add3, mul3 } from '../math/vec3';
import type {
  ClipSpec,
  CueEvent,
  FootLockWindow,
  JointPose,
  JointTrack,
  LayerSpec,
  MotionPose,
  PoseKeyframe,
  Quat,
  RigJoint,
  Vec3,
  WaveTrackBinding,
} from './contract';
import { evaluateCurve, sampleVec3Keys } from './curves';
import { compileGait, type FootTargetSample } from './gait';
import {
  IDENTITY_QUAT,
  composeJointQuat,
  mirrorQuatAcrossX,
  mulQuat,
  quatFromEulerXyzDeg,
  scaleQuatPower,
  sampleQuatKeys,
  slerpQuat,
} from './quat';
import { evaluateWave } from './wave';

export interface EvaluatedJointTransform {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
}

export interface PreparedLayer {
  readonly spec: LayerSpec;
  readonly tracksByKey: ReadonlyMap<string, JointTrack>;
  readonly maskSet: ReadonlySet<string> | null;
}

export interface PreparedClipEvaluator {
  readonly clip: ClipSpec;
  readonly jointsById: ReadonlyMap<string, RigJoint>;
  readonly posesById: ReadonlyMap<string, MotionPose>;
  readonly layers: readonly PreparedLayer[];
  readonly gaitContacts: Readonly<Record<string, readonly FootLockWindow[]>>;
  readonly gaitFootTargets: Readonly<Record<string, readonly FootTargetSample[]>>;
  readonly gaitCues: readonly CueEvent[];
}

const trackKey = (jointId: string, prop: JointTrack['property']): string => `${jointId}:${prop}`;

const buildTrackMap = (tracks: readonly JointTrack[]): Map<string, JointTrack> => {
  const map = new Map<string, JointTrack>();
  for (const t of tracks) {
    map.set(trackKey(t.jointId, t.property), t);
  }
  return map;
};

/** Pre-compile gait tracks, pose lookup, and layer track indexes once for fast 120Hz sampling. */
export const prepareLayerEvaluator = (clip: ClipSpec): PreparedClipEvaluator => {
  const jointsById = new Map(clip.rig.joints.map((j) => [j.id, j]));
  const posesById = new Map((clip.poses ?? []).map((p) => [p.id, p]));
  let gaitContacts: Readonly<Record<string, readonly FootLockWindow[]>> = {};
  let gaitFootTargets: Readonly<Record<string, readonly FootTargetSample[]>> = {};
  const gaitCues: CueEvent[] = [];

  const layers: PreparedLayer[] = clip.layers.map((layer) => {
    const map = buildTrackMap(layer.tracks ?? []);
    if (layer.gait) {
      const gait = compileGait(layer.gait, clip.duration, clip.fps);
      for (const t of gait.tracks) {
        const key = trackKey(t.jointId, t.property);
        if (!map.has(key)) map.set(key, t);
      }
      gaitContacts = { ...gaitContacts, ...gait.footContacts };
      gaitFootTargets = { ...gaitFootTargets, ...gait.footTargets };
      gaitCues.push(...gait.cues);
    }
    return {
      spec: layer,
      tracksByKey: map,
      maskSet: layer.mask ? new Set(layer.mask) : null,
    };
  });

  return {
    clip,
    jointsById,
    posesById,
    layers,
    gaitContacts,
    gaitFootTargets,
    gaitCues,
  };
};

const sampleJointPose = (
  poseKeys: readonly PoseKeyframe[],
  posesById: ReadonlyMap<string, MotionPose>,
  jointId: string,
  time: number,
  loop: boolean,
  duration: number,
): JointPose | null => {
  if (poseKeys.length === 0) return null;
  const sorted = [...poseKeys].sort((a, b) => a.time - b.time);
  const posKeys = sorted
    .map((pk) => {
      const val = posesById.get(pk.poseId)?.joints[jointId]?.position;
      return val ? { time: pk.time, value: val, curve: pk.curve } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const rotKeys = sorted
    .map((pk) => {
      const val = posesById.get(pk.poseId)?.joints[jointId]?.rotationDeg;
      return val ? { time: pk.time, quat: quatFromEulerXyzDeg(val), curve: pk.curve } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const scaleKeys = sorted
    .map((pk) => {
      const val = posesById.get(pk.poseId)?.joints[jointId]?.scale;
      return val ? { time: pk.time, value: val, curve: pk.curve } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (posKeys.length === 0 && rotKeys.length === 0 && scaleKeys.length === 0) return null;
  return {
    position:
      posKeys.length > 0 ? sampleVec3Keys(posKeys, time, [0, 0, 0], { loop, duration }) : undefined,
    rotationDeg: undefined,
    scale:
      scaleKeys.length > 0
        ? sampleVec3Keys(scaleKeys, time, [1, 1, 1], { loop, duration })
        : undefined,
  };
};

const samplePoseRotation = (
  poseKeys: readonly PoseKeyframe[],
  posesById: ReadonlyMap<string, MotionPose>,
  jointId: string,
  time: number,
  loop: boolean,
  duration: number,
): Quat | null => {
  if (poseKeys.length === 0) return null;
  const sorted = [...poseKeys].sort((a, b) => a.time - b.time);
  const rotKeys = sorted
    .map((pk) => {
      const val = posesById.get(pk.poseId)?.joints[jointId]?.rotationDeg;
      return val ? { time: pk.time, quat: quatFromEulerXyzDeg(val), curve: pk.curve } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (rotKeys.length === 0) return null;
  return sampleQuatKeys(rotKeys, time, evaluateCurve, loop, duration);
};

const sampleWaveVec = (
  waves: readonly WaveTrackBinding[] | undefined,
  jointId: string,
  prop: JointTrack['property'],
  time: number,
  duration: number,
): { readonly vec: Vec3; readonly hasWave: boolean; readonly comLift: number } => {
  if (!waves) return { vec: [0, 0, 0], hasWave: false, comLift: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  let hasWave = false;
  let comLift = 0;
  for (const w of waves) {
    const sample = evaluateWave(w.spec, time, duration);
    if (
      (jointId === 'pelvis' || jointId === 'root') &&
      prop === 'position' &&
      w.spec.kind === 'flap'
    ) {
      comLift += sample.comLift;
    }
    if (w.jointId !== jointId || w.property !== prop) continue;
    hasWave = true;
    const val = sample.value * (w.scale ?? 1);
    if (w.axis === 'x') x += val;
    else if (w.axis === 'y') y += val;
    else z += val;
  }
  return { vec: [x, y, z], hasWave, comLift };
};

const mirrorTime = (layer: LayerSpec, time: number, duration: number, loop: boolean): number => {
  if (layer.mirrorMode !== 'antiphase') return time;
  const shifted = time + 0.5 * duration;
  if (loop && duration > 1e-6) return shifted % duration;
  return Math.min(duration, shifted);
};

const sampleLayerTracks = (
  layer: PreparedLayer,
  joint: RigJoint,
  time: number,
  dur: number,
  loop: boolean,
): { position: Vec3; rotation: Quat; scale: Vec3 } => {
  const hasOwn =
    layer.tracksByKey.has(trackKey(joint.id, 'position')) ||
    layer.tracksByKey.has(trackKey(joint.id, 'rotation')) ||
    layer.tracksByKey.has(trackKey(joint.id, 'scale'));
  const useMirror = !hasOwn && Boolean(joint.mirror);
  const srcId = useMirror ? joint.mirror! : joint.id;
  const evalTime = useMirror ? mirrorTime(layer.spec, time, dur, loop) : time;

  const srcPos = layer.tracksByKey.get(trackKey(srcId, 'position'));
  const srcRot = layer.tracksByKey.get(trackKey(srcId, 'rotation'));
  const srcScale = layer.tracksByKey.get(trackKey(srcId, 'scale'));
  const rawPos: Vec3 = srcPos
    ? sampleVec3Keys(srcPos.keys, evalTime, [0, 0, 0], { loop, duration: dur })
    : [0, 0, 0];
  const rawRot: Quat = srcRot
    ? sampleQuatKeys(
        srcRot.keys.map((k) => ({
          time: k.time,
          quat: quatFromEulerXyzDeg(k.value),
          curve: k.curve,
        })),
        evalTime,
        evaluateCurve,
        loop,
        dur,
      )
    : IDENTITY_QUAT;
  const scl: Vec3 = srcScale
    ? sampleVec3Keys(srcScale.keys, evalTime, [1, 1, 1], { loop, duration: dur })
    : [1, 1, 1];

  return {
    position: useMirror ? [-rawPos[0], rawPos[1], rawPos[2]] : rawPos,
    rotation: useMirror ? mirrorQuatAcrossX(rawRot) : rawRot,
    scale: scl,
  };
};

const applyLayerWaves = (
  waves: readonly WaveTrackBinding[] | undefined,
  jointId: string,
  time: number,
  dur: number,
  acc: { position: Vec3; rotation: Quat; scale: Vec3 },
): { readonly position: Vec3; readonly rotation: Quat; readonly scale: Vec3 } => {
  const posWave = sampleWaveVec(waves, jointId, 'position', time, dur);
  const rotWave = sampleWaveVec(waves, jointId, 'rotation', time, dur);
  const sclWave = sampleWaveVec(waves, jointId, 'scale', time, dur);
  const position = add3(acc.position, [
    posWave.vec[0],
    posWave.vec[1] + posWave.comLift,
    posWave.vec[2],
  ]);
  const rotation = rotWave.hasWave
    ? mulQuat(acc.rotation, quatFromEulerXyzDeg(rotWave.vec))
    : acc.rotation;
  const scale = sclWave.hasWave
    ? mul3(acc.scale, [1 + sclWave.vec[0], 1 + sclWave.vec[1], 1 + sclWave.vec[2]])
    : acc.scale;
  return { position, rotation, scale };
};

const sampleLayerJointRaw = (
  ctx: PreparedClipEvaluator,
  layer: PreparedLayer,
  joint: RigJoint,
  time: number,
): { readonly position: Vec3; readonly rotation: Quat; readonly scale: Vec3 } => {
  const loop = ctx.clip.loop === 'loop';
  const dur = ctx.clip.duration;
  const acc = sampleLayerTracks(layer, joint, time, dur, loop);

  if (layer.spec.poseKeys) {
    const poseVec = sampleJointPose(layer.spec.poseKeys, ctx.posesById, joint.id, time, loop, dur);
    const poseRot = samplePoseRotation(
      layer.spec.poseKeys,
      ctx.posesById,
      joint.id,
      time,
      loop,
      dur,
    );
    if (poseVec?.position) acc.position = add3(acc.position, poseVec.position);
    if (poseVec?.scale) acc.scale = mul3(acc.scale, poseVec.scale);
    if (poseRot) acc.rotation = mulQuat(acc.rotation, poseRot);
  }
  return applyLayerWaves(layer.spec.waves, joint.id, time, dur, acc);
};

/** Evaluate the full layer stack (`base`, masked `override`, `additive`) for all joints at `time`. */
export const evaluateLayerStack = (
  ctx: PreparedClipEvaluator,
  time: number,
): Readonly<Record<string, EvaluatedJointTransform>> => {
  const result: Record<string, EvaluatedJointTransform> = {};
  for (const joint of ctx.clip.rig.joints) {
    let basePos: Vec3 = [0, 0, 0];
    let baseRot: Quat = IDENTITY_QUAT;
    let baseScale: Vec3 = [1, 1, 1];
    let addPos: Vec3 = [0, 0, 0];
    let addRot: Quat = IDENTITY_QUAT;
    let addScale: Vec3 = [1, 1, 1];

    for (const layer of ctx.layers) {
      if (layer.maskSet && !layer.maskSet.has(joint.id)) continue;
      const weight = Math.max(0, Math.min(1, layer.spec.weight ?? 1));
      const sampled = sampleLayerJointRaw(ctx, layer, joint, time);
      if (layer.spec.mode === 'base') {
        basePos = sampled.position;
        baseRot = sampled.rotation;
        baseScale = sampled.scale;
      } else if (layer.spec.mode === 'override') {
        basePos = [
          basePos[0] + (sampled.position[0] - basePos[0]) * weight,
          basePos[1] + (sampled.position[1] - basePos[1]) * weight,
          basePos[2] + (sampled.position[2] - basePos[2]) * weight,
        ];
        baseRot = slerpQuat(baseRot, sampled.rotation, weight);
        baseScale = [
          baseScale[0] + (sampled.scale[0] - baseScale[0]) * weight,
          baseScale[1] + (sampled.scale[1] - baseScale[1]) * weight,
          baseScale[2] + (sampled.scale[2] - baseScale[2]) * weight,
        ];
      } else {
        addPos = add3(addPos, [
          sampled.position[0] * weight,
          sampled.position[1] * weight,
          sampled.position[2] * weight,
        ]);
        addRot = mulQuat(addRot, scaleQuatPower(sampled.rotation, weight));
        addScale = mul3(addScale, [
          1 + (sampled.scale[0] - 1) * weight,
          1 + (sampled.scale[1] - 1) * weight,
          1 + (sampled.scale[2] - 1) * weight,
        ]);
      }
    }

    result[joint.id] = {
      position: add3(joint.restPosition, add3(basePos, addPos)),
      rotation: composeJointQuat(joint.restRotation, baseRot, undefined, 0, addRot),
      scale: mul3(joint.restScale, mul3(baseScale, addScale)),
    };
  }
  return result;
};
