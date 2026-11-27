import type { ProgramExpr } from '../syntax/contract';
import type { SourceSpan } from '../../source/contract';
import type {
  AssetCurveDecl,
  AssetMotionChannel,
  AssetPropertyDecl,
  AssetQualifiedName,
} from './baseTypes';

export interface AssetKeyframeDecl {
  readonly kind: 'keyframe';
  readonly time: ProgramExpr;
  readonly value: ProgramExpr;
  readonly interpolation: 'linear' | 'step' | 'catmullrom';
  readonly curve: AssetCurveDecl;
  readonly span: SourceSpan;
}

export interface AssetTrackDecl {
  readonly kind: 'track';
  readonly target: string;
  readonly property: AssetMotionChannel;
  readonly keyframes: readonly AssetKeyframeDecl[];
  readonly span: SourceSpan;
}

export interface AssetWaveArgDecl {
  readonly name: string | null;
  readonly value: ProgramExpr;
  readonly span: SourceSpan;
}

export interface AssetWaveBindingDecl {
  readonly kind: 'wave-binding';
  readonly target: string;
  readonly property: AssetMotionChannel;
  readonly axis: 'x' | 'y' | 'z';
  readonly waveKind: string | null;
  readonly args: readonly AssetWaveArgDecl[];
  readonly scale: ProgramExpr | null;
  readonly expression: ProgramExpr | null;
  readonly span: SourceSpan;
}

export interface AssetPoseEntryDecl {
  readonly target: string;
  readonly property: AssetMotionChannel;
  readonly value: ProgramExpr;
  readonly span: SourceSpan;
}

export interface AssetPoseDecl {
  readonly kind: 'pose';
  readonly id: string;
  readonly entries: readonly AssetPoseEntryDecl[];
  readonly span: SourceSpan;
}

export interface AssetPoseKeyDecl {
  readonly kind: 'pose-key';
  readonly time: ProgramExpr;
  readonly poseId: string;
  readonly curve: AssetCurveDecl;
  readonly span: SourceSpan;
}

export interface AssetGaitDecl {
  readonly kind: string;
  readonly properties: readonly AssetPropertyDecl[];
  readonly span: SourceSpan;
}

export interface AssetMotionLayerDecl {
  readonly kind: 'layer';
  readonly id: string;
  readonly mode: 'base' | 'override' | 'additive';
  readonly properties: readonly AssetPropertyDecl[];
  readonly gait: AssetGaitDecl | null;
  readonly tracks: readonly AssetTrackDecl[];
  readonly waves: readonly AssetWaveBindingDecl[];
  readonly poseKeys: readonly AssetPoseKeyDecl[];
  readonly span: SourceSpan;
}

export interface AssetMotionIkDecl {
  readonly kind: 'motion-ik';
  readonly limb: string;
  readonly footLocks: readonly (readonly [ProgramExpr, ProgramExpr])[];
  readonly span: SourceSpan;
}

export interface AssetSecondaryDecl {
  readonly kind: 'secondary';
  readonly targetKind: 'chain' | 'joint';
  readonly targetId: string;
  readonly properties: readonly AssetPropertyDecl[];
  readonly span: SourceSpan;
}

export interface AssetCombatOpDecl {
  readonly kind: 'squash' | 'smear' | 'hitstop' | 'recoil';
  readonly target: string | null;
  readonly properties: readonly AssetPropertyDecl[];
  readonly timeRange: readonly [ProgramExpr, ProgramExpr] | null;
  readonly span: SourceSpan;
}

export interface AssetCueDecl {
  readonly kind: 'cue';
  readonly cueKind: 'sound' | 'vfx' | 'event';
  readonly time: ProgramExpr;
  readonly endTime: ProgramExpr | null;
  readonly name: string;
  readonly anchor: string | null;
  readonly payload: readonly AssetPropertyDecl[];
  readonly span: SourceSpan;
}

export interface AssetExpressionEntryDecl {
  readonly kind: 'expression-entry';
  readonly startTime: ProgramExpr;
  readonly endTime: ProgramExpr | null;
  readonly variant: string;
  readonly span: SourceSpan;
}

export interface AssetExpressionSlotTrackDecl {
  readonly kind: 'expression-track';
  readonly slot: string;
  readonly entries: readonly AssetExpressionEntryDecl[];
  readonly span: SourceSpan;
}

export interface AssetMotionDecl {
  readonly kind: 'motion';
  readonly exported: boolean;
  readonly id: string;
  readonly rig: AssetQualifiedName;
  readonly properties: readonly AssetPropertyDecl[];
  readonly tracks: readonly AssetTrackDecl[];
  readonly expressions?: readonly AssetExpressionSlotTrackDecl[];
  readonly layers: readonly AssetMotionLayerDecl[];
  readonly waves: readonly AssetWaveBindingDecl[];
  readonly poses: readonly AssetPoseDecl[];
  readonly poseKeys: readonly AssetPoseKeyDecl[];
  readonly iks: readonly AssetMotionIkDecl[];
  readonly secondaries: readonly AssetSecondaryDecl[];
  readonly combatOps: readonly AssetCombatOpDecl[];
  readonly cues: readonly AssetCueDecl[];
  readonly span: SourceSpan;
}
