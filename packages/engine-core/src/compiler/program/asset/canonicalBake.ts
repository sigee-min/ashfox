import { compareText } from '../../../stableOrder';
import { deepFreeze, freeze } from '../../../immutable';
import { bakeClip } from '../../../animation/bake';
import {
  conjugateQuat,
  mulQuat,
  normalizeQuat,
  quatAngleDeg,
  quatFromEulerXyzDeg,
  IDENTITY_QUAT,
} from '../../../animation/quat';
import type {
  BakedChannel,
  BakedKey,
  ClipSpec,
  JointChannelKind,
  JointRole,
  JointTrack,
  LayerSpec,
  PoseKeyframe,
  Quat,
  RigJoint,
  RigSpec,
  TransformKeyframe as BakeKey,
  Vec3,
  WaveTrackBinding,
} from '../../../animation/contract';
import type {
  AnimationClip,
  AnimationLoopMode,
  MotionCue,
  TransformChannel,
  TransformKeyframe,
} from '../../../model/motion';
import type { BoneNode } from '../../../model/scene';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import {
  canonicalNumber,
  hashId,
  NUMBER_BOUNDARY,
  registerId,
  vector,
  type Location,
} from './canonicalSupport';
import type {
  InstantiatedAssetIr,
  InstantiatedMotion,
  InstantiatedMotionChannel,
  InstantiatedPoseKey,
  InstantiatedWaveBinding,
} from './ir';

const RAD_TO_DEG = 180 / Math.PI;
const VALID_ROLES = new Set<JointRole>([
  'root',
  'pelvis',
  'body',
  'head',
  'arm',
  'leg',
  'wing',
  'tail',
  'cloth',
  'weapon',
  'prop',
]);

const quatToEulerDeg = (q: Quat): readonly [number, number, number] => {
  const [x, y, z, w] = normalizeQuat(q);
  const sinY = Math.max(-1, Math.min(1, 2 * (w * y + x * z)));
  const ry = Math.asin(sinY);
  let rx = 0;
  let rz = 0;
  if (Math.abs(sinY) < 0.99999) {
    rx = Math.atan2(2 * (w * x - y * z), 1 - 2 * (x * x + y * y));
    rz = Math.atan2(2 * (w * z - x * y), 1 - 2 * (y * y + z * z));
  } else {
    rx = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + z * z));
  }
  const clean = (v: number): number => {
    const deg = v * RAD_TO_DEG;
    return Math.abs(deg) < 1e-6 ? 0 : Number(deg.toFixed(4));
  };
  return [clean(rx), clean(ry), clean(rz)];
};

const toVec3 = (
  val: InstantiatedMotionChannel['keys'][number]['value'],
  unit: 'unit' | 'degree' | 'ratio',
  loc: Location,
  diagnostics: AssetDiagnostic[],
): Vec3 => {
  const nums = val.values.map(
    (c) => canonicalNumber(c, unit, NUMBER_BOUNDARY, loc, diagnostics) ?? 0,
  );
  return [nums[0]!, nums[1]!, nums[2]!];
};

const toTracks = (
  channels: readonly InstantiatedMotionChannel[],
  loc: Location,
  diagnostics: AssetDiagnostic[],
): JointTrack[] =>
  channels.map((ch) => {
    const unit =
      ch.property === 'position' ? 'unit' : ch.property === 'rotation' ? 'degree' : 'ratio';
    const keys: BakeKey[] = ch.keys.map((k) => ({
      time: canonicalNumber(k.time, 'second', NUMBER_BOUNDARY, loc, diagnostics) ?? 0,
      value: toVec3(k.value, unit, loc, diagnostics),
      curve: k.curve ?? {
        kind:
          k.interpolation === 'step'
            ? 'step'
            : k.interpolation === 'catmullrom'
              ? 'smooth'
              : 'linear',
      },
    }));
    return { jointId: ch.targetBoneId, property: ch.property, keys };
  });

const toWaves = (waves: readonly InstantiatedWaveBinding[]): WaveTrackBinding[] =>
  waves.map((w) => ({
    jointId: w.targetBoneId,
    property: w.property,
    axis: w.axis,
    spec: w.spec,
    scale: w.scale,
  }));

const toPoseKeys = (
  poseKeys: readonly InstantiatedPoseKey[],
  loc: Location,
  diagnostics: AssetDiagnostic[],
): PoseKeyframe[] =>
  poseKeys.map((pk) => ({
    time: canonicalNumber(pk.time, 'second', NUMBER_BOUNDARY, loc, diagnostics) ?? 0,
    poseId: pk.poseId,
    curve: pk.curve,
  }));

const buildJointSpec = (
  bone: InstantiatedAssetIr['bones'][number],
  nodeById: Map<string, BoneNode>,
  semanticToId: ReadonlyMap<string, string>,
): RigJoint => {
  const nodeId = semanticToId.get(bone.semanticJoint);
  const node = nodeId ? nodeById.get(nodeId) : undefined;
  const parentNode = node?.parentId ? nodeById.get(node.parentId) : undefined;
  const p = node?.transform.pivot ?? [0, 0, 0];
  const pp = parentNode?.transform.pivot ?? [0, 0, 0];
  const role: JointRole =
    bone.role && VALID_ROLES.has(bone.role as JointRole) ? (bone.role as JointRole) : 'body';
  return {
    id: bone.semanticJoint,
    parentId: bone.parentId,
    role,
    channels: bone.channels && bone.channels.length > 0 ? bone.channels : ['rotation', 'scale'],
    restPosition: [p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]],
    restRotation: quatFromEulerXyzDeg(node?.transform.rotation ?? [0, 0, 0]),
    restScale: node?.transform.scale ?? [1, 1, 1],
    ...(bone.mirror ? { mirror: bone.mirror } : {}),
    ...(bone.limits ? { limits: bone.limits } : {}),
  };
};

const buildRigSpec = (
  ir: InstantiatedAssetIr,
  bones: readonly BoneNode[],
  semanticToId: ReadonlyMap<string, string>,
  motion: InstantiatedMotion,
): RigSpec => {
  const nodeById = new Map(bones.map((b) => [b.id as string, b]));
  const footLockMap = new Map((motion.iks ?? []).map((ik) => [ik.limb, [...ik.footLocks]]));
  return {
    joints: ir.bones.map((bone) => buildJointSpec(bone, nodeById, semanticToId)),
    chains: Object.values(ir.chains ?? {}).map((c) => ({ id: c.id, joints: c.joints })),
    ikLimbs: Object.values(ir.ikLimbs ?? {}).map((ik) => ({
      id: ik.id,
      chain: ik.chain,
      ...(ik.endEffector ? { endEffectorId: ik.endEffector } : {}),
      pole: ik.pole,
      ...(ik.ground !== null ? { ground: ik.ground } : {}),
      ...(ik.mirror ? { mirror: ik.mirror } : {}),
      ...(footLockMap.has(ik.id) ? { footLockWindows: footLockMap.get(ik.id)! } : {}),
    })),
  };
};

const hasChannelDeviation = (baked: BakedChannel, joint: RigJoint): boolean => {
  if (baked.property === 'rotation') {
    const invRest = conjugateQuat(joint.restRotation);
    return baked.keys.some(
      (k) => quatAngleDeg(IDENTITY_QUAT, mulQuat(invRest, k.value as Quat)) > 0.01,
    );
  }
  const rest = baked.property === 'position' ? joint.restPosition : joint.restScale;
  return baked.keys.some((k) => {
    const v = k.value as Vec3;
    return Math.hypot(v[0] - rest[0], v[1] - rest[1], v[2] - rest[2]) > 0.002;
  });
};

const round6 = (n: number): number => (Math.abs(n) < 1e-6 ? 0 : Number(n.toFixed(6)));

const lowerBakedKey = (
  keyId: string,
  property: BakedChannel['property'],
  k: BakedKey,
  joint: RigJoint,
  invRest: Quat,
  interpolation: 'step' | 'linear',
): TransformKeyframe => {
  const timeSeconds = round6(k.time);
  if (property === 'rotation') {
    const relQuat = normalizeQuat(mulQuat(invRest, k.value as Quat));
    const euler = quatToEulerDeg(relQuat);
    return freeze({
      id: keyId,
      timeSeconds,
      value: vector(euler[0], euler[1], euler[2]),
      quaternion: freeze([
        round6(relQuat[0]),
        round6(relQuat[1]),
        round6(relQuat[2]),
        round6(relQuat[3]),
      ] as const),
      interpolation,
    });
  }
  const v = k.value as Vec3;
  if (property === 'position') {
    return freeze({
      id: keyId,
      timeSeconds,
      value: vector(
        round6(v[0] - joint.restPosition[0]),
        round6(v[1] - joint.restPosition[1]),
        round6(v[2] - joint.restPosition[2]),
      ),
      interpolation,
    });
  }
  const safeDiv = (a: number, b: number) => Math.max(1e-4, Math.abs(b) > 1e-6 ? a / b : a);
  return freeze({
    id: keyId,
    timeSeconds,
    value: vector(
      round6(safeDiv(v[0], joint.restScale[0])),
      round6(safeDiv(v[1], joint.restScale[1])),
      round6(safeDiv(v[2], joint.restScale[2])),
    ),
    interpolation,
  });
};

const lowerBakedChannel = (
  baked: BakedChannel,
  joint: RigJoint,
  symbolKey: string,
  semanticToId: ReadonlyMap<string, string>,
  seenIds: Map<string, string>,
  location: Location,
  diagnostics: AssetDiagnostic[],
): TransformChannel | null => {
  const targetId = semanticToId.get(baked.jointId);
  if (targetId === undefined || baked.keys.length === 0) return null;
  const channelOwner = `${symbolKey}\u0000${baked.jointId}\u0000${baked.property}`;
  const channelId = hashId('channel', channelOwner);
  if (!registerId(seenIds, channelId, channelOwner, location, 'channel', diagnostics)) return null;
  const interpolation = baked.keys.every((k) => k.interpolation === 'step')
    ? ('step' as const)
    : ('linear' as const);
  const invRest = conjugateQuat(joint.restRotation);
  const keys: TransformKeyframe[] = [];
  for (let i = 0; i < baked.keys.length; i += 1) {
    const k = baked.keys[i]!;
    if (i > 0 && k.time <= baked.keys[i - 1]!.time) continue;
    const keyOwner = `${channelOwner}\u0000${i}`;
    const keyId = hashId('key', keyOwner);
    if (registerId(seenIds, keyId, keyOwner, location, 'key', diagnostics)) {
      keys.push(lowerBakedKey(keyId, baked.property, k, joint, invRest, interpolation));
    }
  }
  if (keys.length === 0) return null;
  return freeze({
    id: channelId,
    targetNodeId: targetId,
    property: baked.property as JointChannelKind,
    ...(baked.property === 'rotation' ? { rotationSpace: 'bone' as const } : {}),
    keys: freeze(keys),
  });
};

export const shouldUseMotionBake = (motion: InstantiatedMotion): boolean => {
  if (
    (motion.layers?.length ?? 0) > 0 ||
    (motion.waves?.length ?? 0) > 0 ||
    (motion.poseKeys?.length ?? 0) > 0 ||
    (motion.iks?.length ?? 0) > 0 ||
    (motion.secondaries?.length ?? 0) > 0 ||
    (motion.combat?.squashes?.length ?? 0) > 0 ||
    (motion.combat?.smears?.length ?? 0) > 0 ||
    (motion.combat?.hitstops?.length ?? 0) > 0 ||
    (motion.combat?.recoils?.length ?? 0) > 0
  ) {
    return true;
  }
  return motion.channels.some(
    (ch) =>
      ch.property === 'position' ||
      ch.keys.some(
        (k) => k.curve !== undefined && k.curve.kind !== 'linear' && k.curve.kind !== 'step',
      ),
  );
};

const buildBakeLayers = (
  motion: InstantiatedMotion,
  location: Location,
  diagnostics: AssetDiagnostic[],
): LayerSpec[] => {
  const layers: LayerSpec[] = [];
  const motionWaves = motion.waves ?? [];
  const motionPoseKeys = motion.poseKeys ?? [];
  if (motion.channels.length > 0 || motionWaves.length > 0 || motionPoseKeys.length > 0) {
    layers.push({
      id: 'base',
      mode: 'base',
      tracks: toTracks(motion.channels, location, diagnostics),
      waves: toWaves(motionWaves),
      poseKeys: toPoseKeys(motionPoseKeys, location, diagnostics),
    });
  }
  for (const layer of motion.layers ?? []) {
    layers.push({
      id: layer.id,
      mode: layer.mode,
      weight: layer.weight,
      ...(layer.mask ? { mask: layer.mask } : {}),
      ...(layer.mirrorMode ? { mirrorMode: layer.mirrorMode } : {}),
      ...(layer.gait ? { gait: layer.gait } : {}),
      tracks: toTracks(layer.channels, location, diagnostics),
      waves: toWaves(layer.waves),
      poseKeys: toPoseKeys(layer.poseKeys, location, diagnostics),
    });
  }
  return layers;
};

const buildBakePoses = (
  motion: InstantiatedMotion,
  location: Location,
  diagnostics: AssetDiagnostic[],
) =>
  (motion.poses ?? []).map((p) => {
    const joints: Record<string, { position?: Vec3; rotationDeg?: Vec3; scale?: Vec3 }> = {};
    for (const e of p.entries) {
      const curr = (joints[e.targetBoneId] ??= {});
      const unitType =
        e.property === 'position' ? 'unit' : e.property === 'rotation' ? 'degree' : 'ratio';
      curr[e.property === 'rotation' ? 'rotationDeg' : e.property] = toVec3(
        e.value,
        unitType,
        location,
        diagnostics,
      );
    }
    return { id: p.id, joints };
  });

const collectBakedChannels = (
  baked: ReturnType<typeof bakeClip>,
  rigSpec: ReturnType<typeof buildRigSpec>,
  motion: InstantiatedMotion,
  semanticToId: ReadonlyMap<string, string>,
  seenIds: Map<string, string>,
  location: Location,
  diagnostics: AssetDiagnostic[],
): TransformChannel[] => {
  const jointById = new Map(rigSpec.joints.map((j) => [j.id, j]));
  const authored = new Set(motion.channels.map((c) => `${c.targetBoneId}:${c.property}`));
  const channels = baked.channels.flatMap((ch) => {
    const joint = jointById.get(ch.jointId);
    if (
      !joint ||
      (!authored.has(`${ch.jointId}:${ch.property}`) && !hasChannelDeviation(ch, joint))
    )
      return [];
    const lowered = lowerBakedChannel(
      ch,
      joint,
      motion.symbol.key,
      semanticToId,
      seenIds,
      location,
      diagnostics,
    );
    return lowered ? [lowered] : [];
  });
  return channels.sort((a, b) => compareText(a.id, b.id));
};

export const bakeInstantiatedMotion = (
  ir: InstantiatedAssetIr,
  bones: readonly BoneNode[],
  motion: InstantiatedMotion,
  clipId: string,
  duration: number,
  fps: number,
  loop: AnimationLoopMode,
  semanticToId: ReadonlyMap<string, string>,
  seenIds: Map<string, string>,
  diagnostics: AssetDiagnostic[],
): AnimationClip | null => {
  const location: Location = { path: motion.sourcePath, span: motion.span };
  const rigSpec = buildRigSpec(ir, bones, semanticToId, motion);
  const clipSpec: ClipSpec = {
    id: clipId,
    name: motion.symbol.name,
    duration,
    fps,
    loop: loop === 'loop' ? 'loop' : 'once',
    rig: rigSpec,
    layers: buildBakeLayers(motion, location, diagnostics),
    poses: buildBakePoses(motion, location, diagnostics),
    secondaries: motion.secondaries ?? [],
    combat: motion.combat ?? {},
    cues: motion.cues ?? [],
  };
  const baked = bakeClip(clipSpec);
  const channels = collectBakedChannels(
    baked,
    rigSpec,
    motion,
    semanticToId,
    seenIds,
    location,
    diagnostics,
  );
  const cues: readonly MotionCue[] = baked.cues.map((c) => freeze({ ...c }));
  return freeze({
    id: clipId,
    name: motion.symbol.name,
    durationSeconds: duration,
    fps,
    loop,
    channels: deepFreeze(Object.fromEntries(channels.map((c) => [c.id, c]))),
    triggers: deepFreeze({}),
    ...(cues.length > 0 ? { cues: freeze(cues) } : {}),
  });
};
