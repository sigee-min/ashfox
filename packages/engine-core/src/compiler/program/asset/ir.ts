import type { SourceSpan } from '../../../project/source/contract';
import type { AssetDiagnostic, AssetMotionChannel } from '../../../project/program/asset/contract';
import type { AssetExactFrame } from './frame';
import type {
  AssetBooleanValue,
  AssetNumberValue,
  AssetValue,
  AssetVectorValue
} from './value/contract';
import type { AssetSymbolId } from './contract';

/** Compiler-private plan. Every authored expression has already been evaluated. */
export interface InstantiatedBone {
  readonly id: string;
  readonly semanticJoint: string;
  readonly parentId: string | null;
  /** Origin and axes are relative to the parent joint, or model for a root. */
  readonly parentRestFrame: AssetExactFrame;
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
  readonly span: SourceSpan;
}

export interface InstantiatedMotionChannel {
  readonly id: string;
  readonly targetBoneId: string;
  readonly property: AssetMotionChannel;
  readonly keys: readonly InstantiatedMotionKey[];
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
  readonly span: SourceSpan;
}

export type AssetBudgetDimension =
  | 'instances'
  | 'bones'
  | 'nodes'
  | 'faces'
  | 'motionKeys'
  | 'diagnostics';

export interface AssetBudgetLedger {
  readonly limits: Readonly<Record<AssetBudgetDimension, number>>;
  readonly used: Readonly<Record<AssetBudgetDimension, number>>;
}

export interface InstantiatedAssetIr {
  readonly asset: AssetSymbolId;
  readonly settings: Readonly<{
    readonly density: AssetNumberValue;
    readonly forward: 'north' | 'south' | 'east' | 'west';
  }>;
  readonly rig: AssetSymbolId;
  readonly skeleton: AssetSymbolId;
  readonly bones: readonly InstantiatedBone[];
  readonly instances: readonly InstantiatedComponentInstance[];
  readonly surfaces: readonly InstantiatedSurfaceBinding[];
  readonly connections: readonly InstantiatedSocketConnection[];
  readonly motions: readonly InstantiatedMotion[];
  readonly budget: AssetBudgetLedger;
}

export type AssetInstantiationResult =
  | Readonly<{ readonly ok: true; readonly ir: InstantiatedAssetIr }>
  | Readonly<{ readonly ok: false; readonly diagnostics: readonly AssetDiagnostic[] }>;
