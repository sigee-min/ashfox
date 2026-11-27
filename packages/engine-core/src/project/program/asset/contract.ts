import type { ProgramExpr, ProgramTextureDecl } from '../syntax/contract';
import type { SourceSpan } from '../../source/contract';
import type { AssetQualityProfile } from '../../../model/compiled';
import type { RawDeclaredOutput, RawDeclaredPreview } from '../../directory/declarations';
import type {
  ASHFOX_ASSET_GRAMMAR,
  AssetDiagnostic,
  AssetFrameDecl,
  AssetImportDecl,
  AssetMotionChannel,
  AssetPropertyDecl,
  AssetQualifiedName,
  AssetValueType,
} from './baseTypes';
export * from './baseTypes';

export interface AssetJointLimitsDecl {
  readonly kind: 'limits';
  readonly pitch: readonly [ProgramExpr, ProgramExpr] | null;
  readonly yaw: readonly [ProgramExpr, ProgramExpr] | null;
  readonly roll: readonly [ProgramExpr, ProgramExpr] | null;
  readonly span: SourceSpan;
}

export interface AssetJointDecl {
  readonly kind: 'joint';
  readonly id: string;
  readonly parent: AssetQualifiedName | null;
  readonly role: string | null;
  readonly frame: AssetFrameDecl | null;
  readonly channels: readonly AssetMotionChannel[];
  readonly mirror: AssetQualifiedName | null;
  readonly limits: AssetJointLimitsDecl | null;
  readonly span: SourceSpan;
}

export interface AssetChainDecl {
  readonly kind: 'chain';
  readonly id: string;
  readonly joints: readonly AssetQualifiedName[];
  readonly span: SourceSpan;
}

export interface AssetIkLimbDecl {
  readonly kind: 'ik-limb';
  readonly id: string;
  readonly chain: readonly [AssetQualifiedName, AssetQualifiedName];
  readonly endEffector: AssetQualifiedName | null;
  readonly pole: ProgramExpr | null;
  readonly ground: ProgramExpr | null;
  readonly mirror: AssetQualifiedName | null;
  readonly span: SourceSpan;
}

export interface AssetAnchorDecl {
  readonly kind: 'anchor';
  readonly id: string;
  readonly joint: AssetQualifiedName;
  readonly offset: ProgramExpr | null;
  readonly span: SourceSpan;
}

export interface AssetSocketContractDecl {
  readonly kind: 'socket-contract';
  readonly exported: boolean;
  readonly id: string;
  readonly handedness: 'right' | 'left';
  readonly frame: AssetFrameDecl | null;
  readonly span: SourceSpan;
}

export interface AssetSocketDecl {
  readonly kind: 'socket';
  readonly id: string;
  readonly contract: AssetQualifiedName;
  readonly joint: AssetQualifiedName;
  readonly capacity: 'one' | 'many';
  readonly frame: AssetFrameDecl | null;
  readonly span: SourceSpan;
}

export interface AssetRigContractDecl {
  readonly kind: 'rig-contract';
  readonly exported: boolean;
  readonly id: string;
  readonly handedness: 'right' | 'left';
  readonly frame: AssetFrameDecl | null;
  readonly joints: readonly AssetJointDecl[];
  readonly sockets: readonly AssetSocketDecl[];
  readonly chains: readonly AssetChainDecl[];
  readonly ikLimbs: readonly AssetIkLimbDecl[];
  readonly anchors: readonly AssetAnchorDecl[];
  readonly span: SourceSpan;
}

export interface AssetBindDecl {
  readonly kind: 'bind';
  readonly joint: string;
  readonly parentOrigin: ProgramExpr | null;
  readonly frame: AssetFrameDecl | null;
  readonly span: SourceSpan;
}

export interface AssetSkeletonDecl {
  readonly kind: 'skeleton';
  readonly exported: boolean;
  readonly id: string;
  readonly implements: AssetQualifiedName;
  readonly binds: readonly AssetBindDecl[];
  readonly span: SourceSpan;
}

export interface AssetComponentJointBind {
  readonly kind: 'component-joint-bind';
  readonly geometryBone: string;
  readonly rigJoint: AssetQualifiedName;
  readonly span: SourceSpan;
}

export interface AssetComponentSocketBind {
  readonly kind: 'component-socket-bind';
  readonly port: string;
  readonly geometryBone: string;
  readonly frame: AssetFrameDecl | null;
  readonly span: SourceSpan;
}

export interface AssetComponentParamDecl {
  readonly kind: 'component-param';
  readonly id: string;
  readonly type: AssetValueType;
  readonly defaultValue?: ProgramExpr | null;
  readonly span: SourceSpan;
}

export interface AssetSlotDecl {
  readonly kind: 'slot';
  readonly id: string;
  readonly type: AssetValueType;
  readonly value: ProgramExpr | null;
  readonly span: SourceSpan;
}

export interface AssetSurfaceContractDecl {
  readonly kind: 'surface-contract';
  readonly exported: boolean;
  readonly id: string;
  readonly atlas: AssetAtlasDecl | null;
  readonly charts: readonly AssetChartAbiDecl[];
  readonly material: 'opaque' | 'cutout' | 'double' | null;
  readonly slots: readonly AssetSlotDecl[];
  readonly span: SourceSpan;
}

export interface AssetSurfaceDecl {
  readonly kind: 'surface';
  readonly exported: boolean;
  readonly id: string;
  readonly contract: AssetQualifiedName;
  readonly texture: ProgramTextureDecl | null;
  readonly material: 'opaque' | 'cutout' | 'double' | null;
  readonly materialProperties?: readonly AssetPropertyDecl[];
  readonly slots: readonly AssetSlotDecl[];
  readonly span: SourceSpan;
}

export interface AssetAtlasDecl {
  readonly kind: 'atlas';
  readonly width: ProgramExpr | null;
  readonly height: ProgramExpr | null;
  readonly span: SourceSpan;
}

export interface AssetChartAbiDecl {
  readonly kind: 'chart-abi';
  readonly id: string;
  readonly layout: 'box' | 'flat';
  readonly width: ProgramExpr | null;
  readonly height: ProgramExpr | null;
  readonly coverage: 'opaque' | 'binary' | 'optional' | null;
  readonly span: SourceSpan;
}

export interface AssetGeometryProperty {
  readonly kind: 'geometry-property';
  readonly name: string;
  readonly value: ProgramExpr;
  readonly span: SourceSpan;
}

export interface AssetGeometrySurfaceBind {
  readonly kind: 'geometry-surface-bind';
  readonly surfacePort: string;
  readonly chart: string;
  readonly span: SourceSpan;
}

export interface AssetGeometryBlock {
  readonly kind: 'geometry-block';
  readonly keyword:
    | 'bone'
    | 'cube'
    | 'plane'
    | 'taper'
    | 'wedge'
    | 'cylinder'
    | 'expression_slot'
    | 'locator'
    | 'face';
  readonly id: string;
  readonly statements: readonly AssetGeometryStatement[];
  readonly span: SourceSpan;
}

export type AssetGeometryStatement =
  AssetGeometryProperty | AssetGeometrySurfaceBind | AssetGeometryBlock;

export interface AssetGeometryPayload {
  readonly kind: 'geometry';
  readonly statements: readonly AssetGeometryStatement[];
  readonly span: SourceSpan;
}

export interface AssetPortDecl {
  readonly kind: 'port';
  readonly direction: 'requires' | 'provides';
  readonly domain: 'rig' | 'surface' | 'socket';
  readonly id: string;
  readonly type: AssetQualifiedName;
  readonly capacity: 'one' | 'many' | null;
  readonly span: SourceSpan;
}

export interface AssetComponentDecl {
  readonly kind: 'component';
  readonly exported: boolean;
  readonly id: string;
  readonly parameters: readonly AssetComponentParamDecl[];
  readonly ports: readonly AssetPortDecl[];
  readonly jointBindings: readonly AssetComponentJointBind[];
  readonly socketBindings: readonly AssetComponentSocketBind[];
  readonly geometry: AssetGeometryPayload;
  readonly span: SourceSpan;
}

import type { AssetMotionDecl } from './motionDecls';
export * from './motionDecls';

export interface AssetAssemblyUse {
  readonly kind: 'use';
  readonly component: AssetQualifiedName;
  readonly id: string;
  readonly parameterSets: readonly AssetParamSetDecl[];
  readonly portBindings: readonly AssetPortBindingDecl[];
  readonly span: SourceSpan;
}

export interface AssetParamSetDecl {
  readonly kind: 'param-set';
  readonly id: string;
  readonly value: ProgramExpr;
  readonly span: SourceSpan;
}

export interface AssetPortBindingDecl {
  readonly kind: 'port-binding';
  readonly port: string;
  readonly target: AssetQualifiedName;
  readonly span: SourceSpan;
}

export interface AssetAssemblyConnect {
  readonly kind: 'connect';
  readonly from: AssetQualifiedName;
  readonly to: AssetQualifiedName;
  readonly span: SourceSpan;
}

export interface AssetSettingsDecl {
  readonly kind: 'settings';
  readonly density: ProgramExpr | null;
  readonly forward: 'north' | 'south' | 'east' | 'west' | null;
  readonly profile: AssetQualityProfile | null;
  readonly span: SourceSpan;
}

export interface AssetVariantDecl {
  readonly kind: 'variant';
  readonly id: string;
  readonly properties: readonly AssetPropertyDecl[];
  readonly span: SourceSpan;
}

export interface AssetAssemblyDecl {
  readonly kind: 'asset';
  readonly exported: boolean;
  readonly id: string;
  readonly settings: AssetSettingsDecl | null;
  /** The concrete skeleton implementation selected for this assembly. */
  readonly skeleton: AssetQualifiedName | null;
  readonly motions: readonly AssetQualifiedName[];
  readonly uses: readonly AssetAssemblyUse[];
  readonly connections: readonly AssetAssemblyConnect[];
  readonly variants?: readonly AssetVariantDecl[];
  readonly span: SourceSpan;
}

export interface AssetDesignField {
  readonly id: string;
  readonly type: AssetValueType;
  readonly value: ProgramExpr;
  readonly span: SourceSpan;
}

export interface AssetDesignCheck {
  readonly id: string;
  readonly value: ProgramExpr;
  readonly span: SourceSpan;
}

export interface AssetDesignDecl {
  readonly kind: 'design';
  readonly exported: boolean;
  readonly id: string;
  readonly fields: readonly AssetDesignField[];
  readonly checks: readonly AssetDesignCheck[];
  readonly span: SourceSpan;
}

export type AssetDeclaration =
  | AssetDesignDecl
  | AssetSocketContractDecl
  | AssetRigContractDecl
  | AssetSkeletonDecl
  | AssetSurfaceContractDecl
  | AssetSurfaceDecl
  | AssetComponentDecl
  | AssetMotionDecl
  | AssetAssemblyDecl;

export interface AssetModuleUnit {
  readonly kind: 'module';
  readonly id: string;
  readonly imports: readonly AssetImportDecl[];
  readonly declarations: readonly AssetDeclaration[];
  readonly span: SourceSpan;
}

export interface AssetRootUnit {
  readonly kind: 'asset';
  readonly id: string;
  readonly imports: readonly AssetImportDecl[];
  readonly declarations: readonly AssetDeclaration[];
  readonly outputs: readonly RawDeclaredOutput[];
  readonly previews: readonly RawDeclaredPreview[];
  readonly span: SourceSpan;
}

export type AssetSourceUnit = AssetModuleUnit | AssetRootUnit;

export interface AssetSourceParseResult {
  readonly path: string;
  readonly source: string;
  readonly grammar: typeof ASHFOX_ASSET_GRAMMAR;
  readonly unit: AssetSourceUnit | null;
  readonly diagnostics: readonly AssetDiagnostic[];
}
