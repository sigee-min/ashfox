import type {
  CombatOps,
  CueEvent,
  CurveSpec,
  GaitSpec,
  JointLimits,
  SecondarySpec,
  WaveSpec,
} from '../../../animation/contract';
import type { SourceSpan } from '../../../project/source/contract';
import type { AssetQualityProfile } from '../../../model/compiled';
import type { AssetDiagnostic, AssetMotionChannel } from '../../../project/program/asset/contract';
import type { AssetExactFrame } from './frame';
import type {
  AssetBooleanValue,
  AssetNumberValue,
  AssetValue,
  AssetVectorValue,
} from './value/contract';
import type {
  AssetSymbolId,
  TypedMotionIk,
  TypedRigAnchor,
  TypedRigChain,
  TypedRigIkLimb,
} from './contract';

/** Compiler-private plan. Every authored expression has already been evaluated. */
export interface InstantiatedBone {
  readonly id: string;
  readonly semanticJoint: string;
  readonly parentId: string | null;
  /** Origin and axes are relative to the parent joint, or model for a root. */
  readonly parentRestFrame: AssetExactFrame;
  readonly role?: string | null;
  readonly channels?: readonly AssetMotionChannel[];
  readonly mirror?: string | null;
  readonly limits?: JointLimits | null;
  readonly sourcePath: string;
  readonly span: SourceSpan;
}

export interface InstantiatedGeometryProperty {
  readonly name: string;
  readonly value: AssetValue;
  readonly span: SourceSpan;
}

export interface InstantiatedGeometrySurface {
  readonly port: string;
  readonly chart: string;
  readonly surface: AssetSymbolId;
  readonly span: SourceSpan;
}

export interface InstantiatedGeometryNode {
  readonly kind: 'bone' | 'cube' | 'plane' | 'locator' | 'face';
  readonly id: string;
  /** Bound semantic bones are scopes and never duplicate skeleton transforms. */
  readonly attachmentBoneId: string | null;
  readonly properties: readonly InstantiatedGeometryProperty[];
  readonly surface: InstantiatedGeometrySurface | null;
  readonly children: readonly InstantiatedGeometryNode[];
  /** Internal flag set by mirror = x expansion so canonical lowering bakes mirrored UVs. */
  readonly uvMirrorX?: boolean;
  readonly sourcePath: string;
  readonly span: SourceSpan;
}

export interface InstantiatedSocketEndpoint {
  readonly port: string;
  readonly geometryBoneId: string;
  readonly frame: AssetExactFrame;
  readonly contract: AssetSymbolId;
  readonly sourcePath: string;
  readonly span: SourceSpan;
}

export interface InstantiatedComponentInstance {
  readonly id: string;
  readonly component: AssetSymbolId;
  /** Placement is immediately authoritative only for a rig-bound component. */
  readonly placementAuthority: 'rig' | 'socket';
  readonly placement: AssetExactFrame;
  readonly parameters: Readonly<Record<string, AssetValue>>;
  readonly socketEndpoints: readonly InstantiatedSocketEndpoint[];
  readonly geometry: readonly InstantiatedGeometryNode[];
  readonly sourcePath: string;
  readonly span: SourceSpan;
}

export interface InstantiatedSurfaceBinding {
  readonly surface: AssetSymbolId;
  readonly contract: AssetSymbolId;
  readonly material: 'opaque' | 'cutout' | 'double';
  readonly charts: readonly string[];
  readonly span: SourceSpan;
}

export interface InstantiatedSocketConnection {
  readonly id: string;
  readonly fromInstance: string;
  readonly fromPort: string;
  readonly toInstance: string;
  readonly toPort: string;
  /** Socket-anchored component bone whose transform receives parentPlacement. */
  readonly targetBoneId: string;
  /** Canonical provider bone that owns the attached component root. */
  readonly parentBoneId: string;
  /** Target placement relative to parentBoneId, preserving animation hierarchy. */
  readonly parentPlacement: AssetExactFrame;
  readonly span: SourceSpan;
}

export interface InstantiatedMotionKey {
  readonly time: AssetNumberValue;
  readonly value: AssetVectorValue;
  readonly interpolation: 'linear' | 'step' | 'catmullrom';
  readonly curve?: CurveSpec;
  readonly span: SourceSpan;
}

export interface InstantiatedMotionChannel {
  readonly id: string;
  readonly targetBoneId: string;
  readonly property: AssetMotionChannel;
  readonly keys: readonly InstantiatedMotionKey[];
  readonly span: SourceSpan;
}

export interface InstantiatedWaveBinding {
  readonly targetBoneId: string;
  readonly property: AssetMotionChannel;
  readonly axis: 'x' | 'y' | 'z';
  readonly spec: WaveSpec;
  readonly scale: number;
  readonly span: SourceSpan;
}

export interface InstantiatedPoseEntry {
  readonly targetBoneId: string;
  readonly property: AssetMotionChannel;
  readonly value: AssetVectorValue;
  readonly span: SourceSpan;
}

export interface InstantiatedPose {
  readonly id: string;
  readonly entries: readonly InstantiatedPoseEntry[];
  readonly span: SourceSpan;
}

export interface InstantiatedPoseKey {
  readonly time: AssetNumberValue;
  readonly poseId: string;
  readonly curve: CurveSpec;
  readonly span: SourceSpan;
}

export interface InstantiatedMotionLayer {
  readonly id: string;
  readonly mode: 'base' | 'override' | 'additive';
  readonly weight: number;
  readonly mask: readonly string[] | null;
  readonly mirrorMode: 'antiphase' | 'sync' | null;
  readonly gait: GaitSpec | null;
  readonly channels: readonly InstantiatedMotionChannel[];
  readonly waves: readonly InstantiatedWaveBinding[];
  readonly poseKeys: readonly InstantiatedPoseKey[];
  readonly span: SourceSpan;
}

export interface InstantiatedMotion {
  readonly symbol: AssetSymbolId;
  /** Logical source path retained for source-owned canonical diagnostics. */
  readonly sourcePath: string;
  readonly duration: AssetNumberValue;
  readonly fps: AssetNumberValue;
  readonly loop: 'once' | 'loop' | 'hold_on_last_frame';
  readonly restRelative: AssetBooleanValue;
  readonly channels: readonly InstantiatedMotionChannel[];
  readonly layers?: readonly InstantiatedMotionLayer[];
  readonly waves?: readonly InstantiatedWaveBinding[];
  readonly poses?: readonly InstantiatedPose[];
  readonly poseKeys?: readonly InstantiatedPoseKey[];
  readonly iks?: readonly TypedMotionIk[];
  readonly secondaries?: readonly SecondarySpec[];
  readonly combat?: CombatOps;
  readonly cues?: readonly CueEvent[];
  readonly span: SourceSpan;
}

export type AssetBudgetDimension =
  'instances' | 'bones' | 'nodes' | 'faces' | 'motionKeys' | 'diagnostics';

export interface AssetBudgetLedger {
  readonly limits: Readonly<Record<AssetBudgetDimension, number>>;
  readonly used: Readonly<Record<AssetBudgetDimension, number>>;
}

export interface InstantiatedAssetIr {
  readonly asset: AssetSymbolId;
  readonly settings: Readonly<{
    readonly density: AssetNumberValue;
    readonly forward: 'north' | 'south' | 'east' | 'west';
    readonly profile?: AssetQualityProfile | null;
  }>;
  readonly rig: AssetSymbolId;
  readonly skeleton: AssetSymbolId;
  readonly bones: readonly InstantiatedBone[];
  readonly chains?: Readonly<Record<string, TypedRigChain>>;
  readonly ikLimbs?: Readonly<Record<string, TypedRigIkLimb>>;
  readonly anchors?: Readonly<Record<string, TypedRigAnchor>>;
  readonly instances: readonly InstantiatedComponentInstance[];
  readonly surfaces: readonly InstantiatedSurfaceBinding[];
  readonly connections: readonly InstantiatedSocketConnection[];
  readonly motions: readonly InstantiatedMotion[];
  readonly budget: AssetBudgetLedger;
}

export type AssetInstantiationResult =
  | Readonly<{ readonly ok: true; readonly ir: InstantiatedAssetIr }>
  | Readonly<{ readonly ok: false; readonly diagnostics: readonly AssetDiagnostic[] }>;
