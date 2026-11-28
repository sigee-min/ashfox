import type {
  CueEvent,
  FootLockWindow,
  GaitKind,
  GaitSpec,
  JointTrack,
  TransformKeyframe,
  Vec3,
} from './contract';

const TAU = Math.PI * 2;

interface GaitPreset {
  readonly stride: number;
  readonly lift: number;
  readonly bounce: number;
  readonly hipSway: number;
  readonly counterTwist: number;
  readonly lean: number;
  readonly armSwing: number;
  readonly stanceDuty: number;
  readonly quadruped: boolean;
  readonly hop: boolean;
  readonly avian: boolean;
}

const GAIT_PRESETS: Readonly<Record<GaitKind, GaitPreset>> = {
  biped_walk: {
    stride: 7,
    lift: 2.2,
    bounce: 0.7,
    hipSway: 4.5,
    counterTwist: 9,
    lean: 4,
    armSwing: 24,
    stanceDuty: 0.56,
    quadruped: false,
    hop: false,
    avian: false,
  },
  biped_run: {
    stride: 10.5,
    lift: 3.4,
    bounce: 1.4,
    hipSway: 6,
    counterTwist: 14,
    lean: 12,
    armSwing: 44,
    stanceDuty: 0.42,
    quadruped: false,
    hop: false,
    avian: false,
  },
  biped_sneak: {
    stride: 5,
    lift: 1.6,
    bounce: 0.35,
    hipSway: 3.5,
    counterTwist: 6,
    lean: 18,
    armSwing: 14,
    stanceDuty: 0.65,
    quadruped: false,
    hop: false,
    avian: false,
  },
  quadruped_trot: {
    stride: 8.5,
    lift: 2.6,
    bounce: 0.9,
    hipSway: 3.5,
    counterTwist: 7,
    lean: 4,
    armSwing: 28,
    stanceDuty: 0.52,
    quadruped: true,
    hop: false,
    avian: false,
  },
  quadruped_gallop: {
    stride: 12,
    lift: 4.0,
    bounce: 1.8,
    hipSway: 2.5,
    counterTwist: 5,
    lean: 10,
    armSwing: 46,
    stanceDuty: 0.36,
    quadruped: true,
    hop: false,
    avian: false,
  },
  avian_glide: {
    stride: 2,
    lift: 1.0,
    bounce: 1.1,
    hipSway: 2.5,
    counterTwist: 3,
    lean: 8,
    armSwing: 22,
    stanceDuty: 0,
    quadruped: false,
    hop: false,
    avian: true,
  },
  hop: {
    stride: 8,
    lift: 4.5,
    bounce: 2.4,
    hipSway: 1.5,
    counterTwist: 3,
    lean: 10,
    armSwing: 26,
    stanceDuty: 0.38,
    quadruped: false,
    hop: true,
    avian: false,
  },
};

export interface FootTargetSample {
  readonly time: number;
  readonly offset: Vec3;
  readonly grounded: boolean;
}

export interface GaitSynthesis {
  readonly tracks: readonly JointTrack[];
  readonly footContacts: Readonly<Record<string, readonly FootLockWindow[]>>;
  readonly footTargets: Readonly<Record<string, readonly FootTargetSample[]>>;
  readonly cues: readonly CueEvent[];
}

const resolveGaitParams = (spec: GaitSpec): GaitPreset => {
  const base = GAIT_PRESETS[spec.kind];
  return {
    ...base,
    stride: spec.stride ?? base.stride,
    lift: spec.lift ?? base.lift,
    bounce: spec.bounce ?? base.bounce,
    hipSway: spec.hipSway ?? base.hipSway,
    counterTwist: spec.counterTwist ?? base.counterTwist,
    lean: spec.lean ?? base.lean,
    armSwing: spec.armSwing ?? base.armSwing,
  };
};

const evaluateFootOffset = (
  phase: number,
  duty: number,
  stride: number,
  lift: number,
): { readonly offset: Vec3; readonly grounded: boolean } => {
  const p = ((phase % 1) + 1) % 1;
  const halfStride = 0.5 * stride;
  if (duty > 0 && p < duty) {
    const u = p / duty;
    const z = -halfStride + u * stride;
    return { offset: [0, 0, z], grounded: true };
  }
  const swingSpan = Math.max(0.05, 1 - duty);
  const u = (p - duty) / swingSpan;
  const z = halfStride - u * stride;
  const y = Math.sin(Math.PI * u) * lift;
  return { offset: [0, y, z], grounded: false };
};

const legAnglesDeg = (
  phase: number,
  swingDeg: number,
  liftRatio: number,
): readonly [number, number] => {
  const a = TAU * phase;
  const thighX = Math.sin(a) * swingDeg;
  const kneeBend = Math.max(0, -Math.cos(a)) * swingDeg * 0.9 * liftRatio;
  return [thighX, kneeBend];
};

const buildTrack = (
  jointId: string,
  property: JointTrack['property'],
  keys: readonly TransformKeyframe[],
): JointTrack => ({ jointId, property, keys });

const sampleGaitFrame = (
  p: GaitPreset,
  u: number,
): {
  readonly pelvisPos: Vec3;
  readonly pelvisRot: Vec3;
  readonly torsoRot: Vec3;
  readonly legL: readonly [number, number];
  readonly legR: readonly [number, number];
  readonly armL: readonly [number, number];
  readonly armR: readonly [number, number];
} => {
  const a = TAU * u;
  const bounceY = p.avian
    ? Math.sin(a) * p.bounce
    : p.hop
      ? Math.max(-0.4 * p.bounce, Math.sin(a) * p.bounce)
      : -Math.cos(2 * a) * p.bounce;
  const swayX = Math.sin(a) * (p.hipSway * 0.08);
  const pelvisPos: Vec3 = [swayX, bounceY, 0];
  const pelvisYaw = Math.cos(a) * (p.counterTwist * 0.45);
  const pelvisRoll = Math.sin(a) * p.hipSway;
  const pelvisRot: Vec3 = [-p.lean * 0.25, pelvisYaw, pelvisRoll];
  const torsoRot: Vec3 = [-p.lean * 0.75, -Math.cos(a) * p.counterTwist, -pelvisRoll * 0.5];

  const swingScale = Math.min(48, p.stride * 3.4);
  const liftScale = Math.max(0.6, p.lift / 2.5);
  const rightPhase = p.hop || p.avian ? u : (u + 0.5) % 1;
  const legL = legAnglesDeg(u, swingScale, liftScale);
  const legR = legAnglesDeg(rightPhase, swingScale, liftScale);
  const armPhaseL = p.quadruped ? (u + 0.35) % 1 : rightPhase;
  const armPhaseR = p.quadruped ? (u + 0.85) % 1 : u;
  const armL = p.avian
    ? ([0, 0, Math.sin(a) * p.armSwing] as const)
    : ([Math.sin(TAU * armPhaseL) * p.armSwing, 0, 0] as const);
  const armR = p.avian
    ? ([0, 0, -Math.sin(a) * p.armSwing] as const)
    : ([Math.sin(TAU * armPhaseR) * p.armSwing, 0, 0] as const);
  return {
    pelvisPos,
    pelvisRot,
    torsoRot,
    legL,
    legR,
    armL: [armL[0], armL[2]],
    armR: [armR[0], armR[2]],
  };
};

const createContactWindows = (duty: number, offset: number): readonly FootLockWindow[] => {
  if (duty <= 0) return [];
  const start = offset % 1;
  const end = start + duty;
  if (end <= 1) return [{ start, end }];
  return [
    { start, end: 1 },
    { start: 0, end: end - 1 },
  ];
};

const buildFootstepCues = (
  spec: GaitSpec,
  p: GaitPreset,
  duration: number,
): readonly CueEvent[] => {
  if (p.avian) return [];
  const sound = spec.footstepSound ?? 'footstep_default';
  const leftAnchor = spec.leftFootAnchor ?? 'foot_l';
  const rightAnchor = spec.rightFootAnchor ?? 'foot_r';
  if (p.hop) {
    return [{ kind: 'sound', time: 0, name: sound, anchor: leftAnchor }];
  }
  return [
    { kind: 'sound', time: 0, name: sound, anchor: leftAnchor },
    { kind: 'sound', time: Number((duration * 0.5).toFixed(4)), name: sound, anchor: rightAnchor },
  ];
};

const buildGaitBuffers = (
  p: GaitPreset,
  safeDur: number,
  steps: number,
): {
  readonly tracks: readonly JointTrack[];
  readonly leftTargets: readonly FootTargetSample[];
  readonly rightTargets: readonly FootTargetSample[];
} => {
  const pelvisPosKeys: TransformKeyframe[] = [];
  const pelvisRotKeys: TransformKeyframe[] = [];
  const torsoRotKeys: TransformKeyframe[] = [];
  const thighLKeys: TransformKeyframe[] = [];
  const shinLKeys: TransformKeyframe[] = [];
  const thighRKeys: TransformKeyframe[] = [];
  const shinRKeys: TransformKeyframe[] = [];
  const shoulderLKeys: TransformKeyframe[] = [];
  const shoulderRKeys: TransformKeyframe[] = [];
  const leftTargets: FootTargetSample[] = [];
  const rightTargets: FootTargetSample[] = [];
  const curve = { kind: 'linear' } as const;

  for (let i = 0; i <= steps; i += 1) {
    const u = i === steps ? 0 : i / steps;
    const t = Number(((i / steps) * safeDur).toFixed(6));
    const frame = sampleGaitFrame(p, u);
    pelvisPosKeys.push({ time: t, value: frame.pelvisPos, curve });
    pelvisRotKeys.push({ time: t, value: frame.pelvisRot, curve });
    torsoRotKeys.push({ time: t, value: frame.torsoRot, curve });
    thighLKeys.push({ time: t, value: [frame.legL[0], 0, 0], curve });
    shinLKeys.push({ time: t, value: [frame.legL[1], 0, 0], curve });
    thighRKeys.push({ time: t, value: [frame.legR[0], 0, 0], curve });
    shinRKeys.push({ time: t, value: [frame.legR[1], 0, 0], curve });
    shoulderLKeys.push({ time: t, value: [frame.armL[0], 0, frame.armL[1]], curve });
    shoulderRKeys.push({ time: t, value: [frame.armR[0], 0, frame.armR[1]], curve });

    const leftFoot = evaluateFootOffset(u, p.stanceDuty, p.stride, p.lift);
    const rightPhase = p.hop || p.avian ? u : (u + 0.5) % 1;
    const rightFoot = evaluateFootOffset(rightPhase, p.stanceDuty, p.stride, p.lift);
    leftTargets.push({ time: t, offset: leftFoot.offset, grounded: leftFoot.grounded });
    rightTargets.push({ time: t, offset: rightFoot.offset, grounded: rightFoot.grounded });
  }

  return {
    tracks: [
      buildTrack('pelvis', 'position', pelvisPosKeys),
      buildTrack('pelvis', 'rotation', pelvisRotKeys),
      buildTrack('torso', 'rotation', torsoRotKeys),
      buildTrack('thigh_l', 'rotation', thighLKeys),
      buildTrack('shin_l', 'rotation', shinLKeys),
      buildTrack('thigh_r', 'rotation', thighRKeys),
      buildTrack('shin_r', 'rotation', shinRKeys),
      buildTrack('shoulder_l', 'rotation', shoulderLKeys),
      buildTrack('shoulder_r', 'rotation', shoulderRKeys),
    ],
    leftTargets,
    rightTargets,
  };
};

/** Compile procedural locomotion into multi-joint tracks, foot targets, contacts, and cues. */
export const compileGait = (spec: GaitSpec, duration: number, fps = 30): GaitSynthesis => {
  const p = resolveGaitParams(spec);
  const safeDur = Math.max(0.1, duration);
  const steps = Math.max(12, Math.round(safeDur * Math.max(12, fps)));
  const buffers = buildGaitBuffers(p, safeDur, steps);
  return {
    tracks: buffers.tracks,
    footContacts: {
      left_leg: createContactWindows(p.stanceDuty, 0),
      right_leg: createContactWindows(p.stanceDuty, p.hop || p.avian ? 0 : 0.5),
    },
    footTargets: {
      left_leg: buffers.leftTargets,
      right_leg: buffers.rightTargets,
    },
    cues: buildFootstepCues(spec, p, safeDur),
  };
};
