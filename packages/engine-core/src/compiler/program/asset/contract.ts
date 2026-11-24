import type { ProgramTextureDecl } from '../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../project/source/contract';
import type {
  AssetDeclaration,
  AssetDiagnostic,
  AssetMotionChannel,
  AssetPortDecl,
  AssetValueType,
} from '../../../project/program/asset/contract';
import type {
  AssetBooleanValue,
  AssetExpectedType,
  AssetNumberValue,
  AssetTypedExpression,
  AssetValue,
  AssetVectorValue,
} from './value/contract';
import type { AssetExactFrame } from './frame';

export type { AssetExactFrame, AssetSignedAxis } from './frame';

export type AssetSymbolKind = AssetDeclaration['kind'];

export interface AssetSymbolId {
  readonly modulePath: string;
  readonly name: string;
  readonly kind: AssetSymbolKind;
  readonly key: string;
}

export type AssetTypedNumberValue<T extends AssetValueType> = AssetNumberValue & {
  readonly type: T;
};
export type AssetTypedVectorValue<T extends AssetValueType> = AssetVectorValue & {
  readonly type: T;
};
export type AssetUnitVectorValue = AssetTypedVectorValue<'vec3<unit>'>;
export type AssetDegreeVectorValue = AssetTypedVectorValue<'vec3<degree>'>;
export type AssetRatioVectorValue = AssetTypedVectorValue<'vec3<ratio>'>;
export type AssetIntegerValue = AssetTypedNumberValue<'integer'>;
export type AssetTexelValue = AssetTypedNumberValue<'texel'>;

/** HIR frame is the exact affine frame shared with frame composition. */
export type TypedFrame = AssetExactFrame;

export interface TypedJoint {
  readonly id: string;
  readonly parent: string | null;
  readonly role: string | null;
  readonly frame: TypedFrame;
  readonly channels: readonly AssetMotionChannel[];
  readonly mirror: string | null;
  readonly span: SourceSpan;
}

export interface TypedSocketContract {
  readonly symbol: AssetSymbolId;
  readonly handedness: 'right' | 'left';
  readonly frame: TypedFrame;
  readonly span: SourceSpan;
}

export interface TypedRigSocket {
  readonly contract: AssetSymbolId;
  readonly joint: string;
  readonly capacity: 'one' | 'many';
  readonly frame: TypedFrame;
  readonly span: SourceSpan;
}

export interface TypedRigContract {
  readonly symbol: AssetSymbolId;
  readonly frame: TypedFrame;
  readonly handedness: 'right' | 'left';
  readonly joints: Readonly<Record<string, TypedJoint>>;
  readonly sockets: Readonly<Record<string, TypedRigSocket>>;
  readonly span: SourceSpan;
}

export interface TypedSkeleton {
  readonly symbol: AssetSymbolId;
  readonly rig: AssetSymbolId;
  readonly binds: Readonly<Record<string, TypedFrame>>;
  readonly span: SourceSpan;
}

export interface TypedAtlasSize {
  readonly width: AssetTexelValue;
  readonly height: AssetTexelValue;
  readonly span: SourceSpan;
}

export interface TypedChartAbi {
  readonly id: string;
  readonly layout: 'box' | 'flat';
  readonly width: AssetTexelValue | null;
  readonly height: AssetTexelValue | null;
  readonly coverage: 'opaque' | 'binary' | 'optional';
  readonly span: SourceSpan;
}

export interface TypedSurfaceContract {
  readonly symbol: AssetSymbolId;
  readonly atlas: TypedAtlasSize | null;
  readonly charts: Readonly<Record<string, TypedChartAbi>>;
  readonly material: 'opaque' | 'cutout' | 'double';
  readonly slots: Readonly<Record<string, AssetValueType>>;
  readonly span: SourceSpan;
}

/** The only source-shaped payload permitted to remain in typed HIR. */
export interface AssetUnloweredTextureSource {
  readonly kind: 'unlowered-texture-source';
  readonly payload: ProgramTextureDecl;
  readonly span: SourceSpan;
}

export interface TypedSurface {
  readonly symbol: AssetSymbolId;
  readonly contract: AssetSymbolId;
  readonly textureSource: AssetUnloweredTextureSource | null;
  readonly material: 'opaque' | 'cutout' | 'double';
  readonly slots: Readonly<Record<string, AssetValue>>;
  readonly span: SourceSpan;
}

export interface TypedPort {
  readonly direction: AssetPortDecl['direction'];
  readonly domain: AssetPortDecl['domain'];
  readonly id: string;
  readonly type: AssetSymbolId;
  readonly capacity: 'one' | 'many' | null;
  readonly span: SourceSpan;
}

export interface TypedJointBinding {
  readonly geometryBone: string;
  readonly rigJoint: string;
  readonly span: SourceSpan;
}

export interface TypedSocketBinding {
  readonly port: string;
  readonly geometryBone: string;
  readonly frame: TypedFrame;
  readonly span: SourceSpan;
}

export interface TypedGeometryProperty {
  readonly kind: 'typed-geometry-property';
  readonly name: string;
  readonly type: AssetExpectedType;
  readonly expression: AssetTypedExpression;
  readonly span: SourceSpan;
}

export interface TypedGeometrySurfaceBind {
  readonly kind: 'typed-geometry-surface-bind';
  readonly surfacePort: string;
  readonly chart: string;
  readonly span: SourceSpan;
}

export interface TypedGeometryMirrorBind {
  readonly kind: 'typed-geometry-mirror';
  readonly targetId: string;
  readonly span: SourceSpan;
}

export interface TypedGeometryBlock {
  readonly kind: 'typed-geometry-block';
  readonly keyword: 'bone' | 'cube' | 'plane' | 'locator' | 'face';
  readonly id: string;
  readonly statements: readonly TypedGeometryStatement[];
  readonly span: SourceSpan;
}

export type TypedGeometryStatement =
  TypedGeometryProperty | TypedGeometrySurfaceBind | TypedGeometryMirrorBind | TypedGeometryBlock;

export interface TypedGeometryPayload {
  readonly kind: 'typed-geometry';
  readonly statements: readonly TypedGeometryStatement[];
  readonly span: SourceSpan;
}

export interface TypedComponent {
  readonly symbol: AssetSymbolId;
  readonly parameters: Readonly<Record<string, AssetValueType>>;
  readonly ports: readonly TypedPort[];
  readonly jointBindings: readonly TypedJointBinding[];
  readonly socketBindings: readonly TypedSocketBinding[];
  readonly geometry: TypedGeometryPayload;
  readonly span: SourceSpan;
}

export interface TypedAssetUse {
  readonly component: AssetSymbolId;
  readonly id: string;
  readonly parameters: Readonly<Record<string, AssetValue>>;
  readonly portBindings: Readonly<Record<string, AssetSymbolId>>;
  readonly span: SourceSpan;
}

export interface TypedMotionKey {
  readonly time: AssetTypedNumberValue<'second'>;
  readonly value: AssetDegreeVectorValue | AssetRatioVectorValue;
  readonly interpolation: 'linear' | 'step' | 'catmullrom';
  readonly span: SourceSpan;
}

export interface TypedMotionTrack {
  readonly target: string;
  readonly property: AssetMotionChannel;
  readonly keyframes: readonly TypedMotionKey[];
  readonly span: SourceSpan;
}

export interface TypedMotion {
  readonly symbol: AssetSymbolId;
  readonly rig: AssetSymbolId;
  readonly duration: AssetTypedNumberValue<'second'>;
  readonly fps: AssetIntegerValue;
  readonly loop: 'once' | 'loop' | 'hold_on_last_frame';
  readonly restRelative: AssetBooleanValue;
  readonly tracks: readonly TypedMotionTrack[];
  readonly span: SourceSpan;
}

export interface TypedAssemblyConnection {
  readonly fromInstance: string;
  readonly fromPort: string;
  readonly toInstance: string;
  readonly toPort: string;
  readonly span: SourceSpan;
}

export interface TypedAssetAssembly {
  readonly symbol: AssetSymbolId;
  readonly settings: Readonly<{
    readonly density: AssetIntegerValue;
    readonly forward: 'north' | 'south' | 'east' | 'west' | null;
  }>;
  readonly skeleton: AssetSymbolId;
  readonly motions: readonly AssetSymbolId[];
  readonly uses: readonly TypedAssetUse[];
  readonly connections: readonly TypedAssemblyConnection[];
  readonly span: SourceSpan;
}

export interface TypedAssetModule {
  readonly path: string;
  readonly id: string;
  readonly imports: Readonly<Record<string, string>>;
  readonly exports: Readonly<Record<string, AssetSymbolId>>;
  readonly declarations: readonly AssetSymbolId[];
}

export interface TypedAssetHir {
  readonly rootPath: string;
  readonly modules: Readonly<Record<string, TypedAssetModule>>;
  readonly symbols: Readonly<Record<string, AssetSymbolId>>;
  readonly socketContracts: Readonly<Record<string, TypedSocketContract>>;
  readonly rigs: Readonly<Record<string, TypedRigContract>>;
  readonly skeletons: Readonly<Record<string, TypedSkeleton>>;
  readonly surfaceContracts: Readonly<Record<string, TypedSurfaceContract>>;
  readonly surfaces: Readonly<Record<string, TypedSurface>>;
  readonly components: Readonly<Record<string, TypedComponent>>;
  readonly motions: Readonly<Record<string, TypedMotion>>;
  readonly assets: Readonly<Record<string, TypedAssetAssembly>>;
}

export type AssetHirResult =
  | Readonly<{ readonly ok: true; readonly hir: TypedAssetHir }>
  | Readonly<{ readonly ok: false; readonly diagnostics: readonly AssetDiagnostic[] }>;
