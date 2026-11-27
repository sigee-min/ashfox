import type { Vec3 } from '../model/identity';

export type { Vec3 };

export type Quat = readonly [number, number, number, number];

export const CURVE_KINDS = [
  'linear',
  'step',
  'smooth',
  'ease_in',
  'ease_out',
  'ease_in_out',
  'cubic',
  'snap',
  'anticipate',
  'overshoot',
  'bounce',
  'elastic',
] as const;

export type CurveKind = (typeof CURVE_KINDS)[number];

export interface CurveSpec {
  readonly kind: CurveKind;
  readonly params?: readonly number[];
}

export type JointChannelKind = 'position' | 'rotation' | 'scale';

export type JointRole =
  | 'root'
  | 'pelvis'
  | 'body'
  | 'head'
  | 'arm'
  | 'leg'
  | 'wing'
  | 'tail'
  | 'cloth'
  | 'weapon'
  | 'prop';

export interface JointLimits {
  readonly pitch?: readonly [number, number];
  readonly yaw?: readonly [number, number];
  readonly roll?: readonly [number, number];
}

export interface RigJoint {
  readonly id: string;
  readonly parentId: string | null;
  readonly role: JointRole;
  readonly channels: readonly JointChannelKind[];
  readonly restPosition: Vec3;
  readonly restRotation: Quat;
  readonly restScale: Vec3;
  readonly mirror?: string;
  readonly limits?: JointLimits;
}

export interface ChainSpec {
  readonly id: string;
  readonly joints: readonly string[];
}

export interface FootLockWindow {
  readonly start: number;
  readonly end: number;
}

export interface IkLimbSpec {
  readonly id: string;
  readonly chain: readonly [string, string];
  readonly endEffectorId?: string;
  readonly pole: Vec3;
  readonly ground?: number;
  readonly mirror?: string;
  readonly footLockWindows?: readonly FootLockWindow[];
}

export interface SecondarySpec {
  readonly id: string;
  readonly targetKind: 'chain' | 'joint';
  readonly targetId: string;
  readonly stiffness: number;
  readonly damping: number;
  readonly gravity?: number;
  readonly drag?: number;
  readonly lagSeconds?: number;
}

export const WAVE_KINDS = ['breath', 'flap', 'simplex'] as const;
export type WaveKind = (typeof WAVE_KINDS)[number];

export interface WaveSpec {
  readonly kind: WaveKind;
  readonly period: number;
  readonly inhale?: number;
  readonly downRatio?: number;
  readonly freq?: number;
  readonly amp?: number;
  readonly seed?: number;
  readonly comLiftAmp?: number;
}

export const GAIT_KINDS = [
  'biped_walk',
  'biped_run',
  'biped_sneak',
  'quadruped_trot',
  'quadruped_gallop',
  'avian_glide',
  'hop',
] as const;

export type GaitKind = (typeof GAIT_KINDS)[number];

export interface GaitSpec {
  readonly kind: GaitKind;
  readonly stride?: number;
  readonly lift?: number;
  readonly bounce?: number;
  readonly hipSway?: number;
  readonly counterTwist?: number;
  readonly lean?: number;
  readonly armSwing?: number;
  readonly footstepSound?: string;
  readonly leftFootAnchor?: string;
  readonly rightFootAnchor?: string;
}

export interface SquashOp {
  readonly kind: 'squash';
  readonly jointId: string;
  readonly at: number;
  readonly duration?: number;
  readonly axis: 'x' | 'y' | 'z';
  readonly amount: number;
  readonly pivotHeight?: number;
}

export interface SmearOp {
  readonly kind: 'smear';
  readonly jointId: string;
  readonly start: number;
  readonly end: number;
  readonly stretch: number;
  readonly axis?: 'x' | 'y' | 'z';
}

export interface HitstopOp {
  readonly kind: 'hitstop';
  readonly at: number;
  readonly hold: number;
  readonly shake: number;
  readonly jointId?: string;
}

export interface RecoilOp {
  readonly kind: 'recoil';
  readonly jointId: string;
  readonly at: number;
  readonly impulseDeg: Vec3;
  readonly decay: number;
}

export interface CombatOps {
  readonly squashes?: readonly SquashOp[];
  readonly smears?: readonly SmearOp[];
  readonly hitstops?: readonly HitstopOp[];
  readonly recoils?: readonly RecoilOp[];
}

export interface TransformKeyframe {
  readonly time: number;
  readonly value: Vec3;
  readonly curve?: CurveSpec;
}

export interface JointTrack {
  readonly jointId: string;
  readonly property: JointChannelKind;
  readonly keys: readonly TransformKeyframe[];
}

export const LAYER_MODES = ['base', 'override', 'additive'] as const;
export type LayerBlendMode = (typeof LAYER_MODES)[number];

export type MirrorMode = 'antiphase' | 'sync';

export interface WaveTrackBinding {
  readonly jointId: string;
  readonly property: JointChannelKind;
  readonly axis: 'x' | 'y' | 'z';
  readonly spec: WaveSpec;
  readonly scale?: number;
}

export interface PoseKeyframe {
  readonly time: number;
  readonly poseId: string;
  readonly curve?: CurveSpec;
}

export interface LayerSpec {
  readonly id: string;
  readonly mode: LayerBlendMode;
  readonly weight?: number;
  readonly mask?: readonly string[];
  readonly mirrorMode?: MirrorMode;
  readonly tracks?: readonly JointTrack[];
  readonly gait?: GaitSpec;
  readonly waves?: readonly WaveTrackBinding[];
  readonly poseKeys?: readonly PoseKeyframe[];
}

export const CUE_KINDS = ['sound', 'vfx', 'event'] as const;
export type CueKind = (typeof CUE_KINDS)[number];

export interface CueEvent {
  readonly kind: CueKind;
  readonly time: number;
  readonly endTime?: number;
  readonly name: string;
  readonly anchor?: string;
  readonly payload?: Readonly<Record<string, string | number | boolean>>;
}

export interface JointPose {
  readonly position?: Vec3;
  readonly rotationDeg?: Vec3;
  readonly scale?: Vec3;
}

export interface MotionPose {
  readonly id: string;
  readonly joints: Readonly<Record<string, JointPose>>;
}

export interface BakedKey {
  readonly time: number;
  readonly value: Vec3 | Quat;
  readonly interpolation: 'linear' | 'step';
}

export interface BakedChannel {
  readonly jointId: string;
  readonly property: JointChannelKind;
  readonly keys: readonly BakedKey[];
}

export interface RigSpec {
  readonly joints: readonly RigJoint[];
  readonly chains?: readonly ChainSpec[];
  readonly ikLimbs?: readonly IkLimbSpec[];
}

export interface ClipSpec {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly fps: number;
  readonly loop: 'once' | 'loop';
  readonly rig: RigSpec;
  readonly layers: readonly LayerSpec[];
  readonly poses?: readonly MotionPose[];
  readonly secondaries?: readonly SecondarySpec[];
  readonly combat?: CombatOps;
  readonly cues?: readonly CueEvent[];
}

export interface BakedClip {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly fps: number;
  readonly loop: 'once' | 'loop';
  readonly channels: readonly BakedChannel[];
  readonly cues: readonly CueEvent[];
  readonly sampledFrames: number;
}

export interface MotionAuditMetric {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly maxScore: number;
  readonly value: number;
  readonly target: number;
  readonly detail: string;
}

export interface MotionAuditReport {
  readonly schemaVersion: 1;
  readonly passed: boolean;
  readonly score: number;
  readonly metrics: readonly MotionAuditMetric[];
  readonly deductions: readonly string[];
}
