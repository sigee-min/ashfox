import type { SourcePosition } from '../project/source/contract';
import type { ModelColliderSet } from '../model/collider';
import type { ModelDamageStateMeta } from '../model/hitzone';
import type { Vec2, Vec3 } from '../model/identity';
import type { BlockRotation, CardinalFacing } from '../project/structure/contract';

export const HOOKS_DOCUMENT_SCHEMA_VERSION = 1 as const;

export type HookTargetKind = 'anchor' | 'volume' | 'cue' | 'meta';

export type HookFacing = CardinalFacing | 'up' | 'down';

export type HookUnitKind =
  'module' | 'structure' | 'model' | 'sprite' | 'sound' | 'compound' | 'vfx' | 'hooks';

export type HookNumberUnit =
  | 'plain'
  | 'second'
  | 'ms'
  | 'degree'
  | 'texel'
  | 'unit'
  | 'block'
  | 'hz'
  | 'khz'
  | 'db'
  | 'lufs'
  | 'st'
  | 'cents'
  | 'percent';

export interface HookSourceSpan {
  readonly file: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface HookDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly hint?: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly token: string;
  readonly span: HookSourceSpan;
}

export type HookFieldType =
  | Readonly<{ kind: 'string' }>
  | Readonly<{ kind: 'int'; min?: number; max?: number }>
  | Readonly<{ kind: 'float'; min?: number; max?: number }>
  | Readonly<{ kind: 'bool' }>
  | Readonly<{ kind: 'union'; values: readonly string[] }>
  | Readonly<{ kind: 'vec2' }>
  | Readonly<{ kind: 'vec3' }>
  | Readonly<{ kind: 'asset' }>;

export type HookCompiledValue = string | number | boolean | Vec2 | Vec3;

export type HookAstValue =
  | Readonly<{ kind: 'string'; value: string; span: HookSourceSpan }>
  | Readonly<{ kind: 'number'; value: number; unit: HookNumberUnit; span: HookSourceSpan }>
  | Readonly<{ kind: 'bool'; value: boolean; span: HookSourceSpan }>
  | Readonly<{ kind: 'vec2'; value: Vec2; span: HookSourceSpan }>
  | Readonly<{ kind: 'vec3'; value: Vec3; span: HookSourceSpan }>
  | Readonly<{ kind: 'ref'; value: string; span: HookSourceSpan }>;

export interface HookSchemaField {
  readonly name: string;
  readonly type: HookFieldType;
  readonly optional: boolean;
  readonly unit?: HookNumberUnit;
  readonly defaultValue?: HookAstValue;
  readonly span: HookSourceSpan;
}

export interface HookSchemaDecl {
  readonly id: string;
  readonly namespace: string;
  readonly name: string;
  readonly exported: boolean;
  readonly inline: boolean;
  readonly targets: readonly HookTargetKind[];
  readonly fields: readonly HookSchemaField[];
  readonly mcBlock?: string;
  readonly span: HookSourceSpan;
}

export interface HookImportDecl {
  readonly path: string;
  readonly alias: string;
  readonly span: HookSourceSpan;
}

export type HookParentRef =
  | Readonly<{ kind: 'root' }>
  | Readonly<{ kind: 'bone'; id: string }>
  | Readonly<{ kind: 'room'; id: string }>
  | Readonly<{ kind: 'floor'; id: string }>
  | Readonly<{ kind: 'surface'; id: string }>
  | Readonly<{ kind: 'compound'; id: string }>;

export interface HookPropAssignment {
  readonly name: string;
  readonly value: HookAstValue;
  readonly span: HookSourceSpan;
}

export type HookEnclosureKind = 'enclosed' | 'semi_open' | 'open' | 'outdoor';

export interface HookEnclosure {
  readonly kind: HookEnclosureKind;
  readonly enclosed: boolean;
  readonly acousticProfile?: string;
  readonly shelterRatio?: number;
}

export interface HookAnchorDecl {
  readonly kind: 'anchor';
  readonly id: string;
  readonly schema: string;
  readonly parent?: HookParentRef;
  readonly at?: Vec3;
  readonly space: '2d' | '3d';
  readonly facing?: HookFacing;
  readonly normal?: Vec3;
  readonly rotate?: Vec3;
  readonly mcBlock?: string;
  readonly props: readonly HookPropAssignment[];
  readonly span: HookSourceSpan;
}

export interface HookVolumeDecl {
  readonly kind: 'volume';
  readonly id: string;
  readonly schema: string;
  readonly parent?: HookParentRef;
  readonly from?: Vec3;
  readonly to?: Vec3;
  readonly space: '2d' | '3d';
  readonly rotate?: Vec3;
  readonly enclosure?: HookEnclosure;
  readonly mcBlock?: string;
  readonly props: readonly HookPropAssignment[];
  readonly span: HookSourceSpan;
}

export interface HookCueDecl {
  readonly kind: 'cue';
  readonly id: string;
  readonly schema: string;
  readonly clip?: string;
  readonly at?: number;
  readonly from?: number;
  readonly to?: number;
  readonly frame?: number;
  readonly props: readonly HookPropAssignment[];
  readonly span: HookSourceSpan;
}

export interface HookMetaDecl {
  readonly kind: 'meta';
  readonly id: string;
  readonly schema: string;
  readonly target?: string;
  readonly props: readonly HookPropAssignment[];
  readonly span: HookSourceSpan;
}

export type HookZoneShape = 'rect' | 'octagon' | 'box';

export interface HookZoneDecl {
  readonly kind: 'zone';
  readonly id: string;
  readonly schema?: string;
  readonly parent?: HookParentRef;
  readonly from?: Vec3;
  readonly to?: Vec3;
  readonly enclosure: HookEnclosure;
  readonly shape?: HookZoneShape;
  readonly props: readonly HookPropAssignment[];
  readonly span: HookSourceSpan;
}

export interface HookMcBlockDecl {
  readonly kind: 'mc_block';
  readonly targetId: string;
  readonly blockState: string;
  readonly facing?: HookFacing;
  readonly span: HookSourceSpan;
}

export type HookDecl =
  HookAnchorDecl | HookVolumeDecl | HookCueDecl | HookMetaDecl | HookZoneDecl | HookMcBlockDecl;

export interface HookSourceUnit {
  readonly header: string | null;
  readonly unitKind: HookUnitKind;
  readonly id: string;
  readonly file: string;
  readonly imports: readonly HookImportDecl[];
  readonly schemas: readonly HookSchemaDecl[];
  readonly anchors: readonly HookAnchorDecl[];
  readonly volumes: readonly HookVolumeDecl[];
  readonly cues: readonly HookCueDecl[];
  readonly meta: readonly HookMetaDecl[];
  readonly zones: readonly HookZoneDecl[];
  readonly mcBlocks: readonly HookMcBlockDecl[];
}

export interface HookParseResult {
  readonly ok: boolean;
  readonly unit: HookSourceUnit;
  readonly diagnostics: readonly HookDiagnostic[];
}

export interface CompiledVolumeObb {
  readonly center: Vec3;
  readonly halfExtents: Vec3;
  readonly axes: readonly [Vec3, Vec3, Vec3];
  readonly rotation: Vec3;
}

export interface CompiledAnchor {
  readonly id: string;
  readonly schema: string;
  readonly position: Vec3;
  readonly normal: Vec3;
  readonly rotation: Vec3;
  readonly space: '2d' | '3d';
  readonly parent?: HookParentRef;
  readonly room?: string;
  readonly bone?: string;
  readonly floor?: string;
  readonly mcBlock?: string;
  readonly props: Readonly<Record<string, HookCompiledValue>>;
}

export interface CompiledVolume {
  readonly id: string;
  readonly schema: string;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly obb: CompiledVolumeObb;
  readonly space: '2d' | '3d';
  readonly parent?: HookParentRef;
  readonly room?: string;
  readonly bone?: string;
  readonly floor?: string;
  readonly enclosure?: HookEnclosure;
  readonly mcBlock?: string;
  readonly props: Readonly<Record<string, HookCompiledValue>>;
}

export interface CompiledCue {
  readonly id: string;
  readonly schema: string;
  readonly clip?: string;
  readonly at?: number;
  readonly from?: number;
  readonly to?: number;
  readonly frame?: number;
  readonly props: Readonly<Record<string, HookCompiledValue>>;
}

export interface CompiledMeta {
  readonly id: string;
  readonly schema: string;
  readonly target?: string;
  readonly props: Readonly<Record<string, HookCompiledValue>>;
}

export interface CompiledZone {
  readonly id: string;
  readonly schema?: string;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly obb: CompiledVolumeObb;
  readonly enclosure: HookEnclosure;
  readonly shape?: HookZoneShape;
  readonly parent?: HookParentRef;
  readonly props: Readonly<Record<string, HookCompiledValue>>;
}

export interface HooksDocument {
  readonly schemaVersion: typeof HOOKS_DOCUMENT_SCHEMA_VERSION;
  readonly assetId: string;
  readonly schemas: readonly HookSchemaDecl[];
  readonly anchors: readonly CompiledAnchor[];
  readonly volumes: readonly CompiledVolume[];
  readonly cues: readonly CompiledCue[];
  readonly meta: readonly CompiledMeta[];
  readonly zones: readonly CompiledZone[];
  readonly colliders?: ModelColliderSet;
  readonly damageState?: ModelDamageStateMeta;
}

export interface HookValidationOptions {
  readonly schemas?: readonly HookSchemaDecl[];
  readonly importedUnits?: Readonly<Record<string, HookSourceUnit>>;
  readonly includeStdSchemas?: boolean;
  readonly validParentIds?: Readonly<{
    readonly bones?: readonly string[];
    readonly rooms?: readonly string[];
    readonly floors?: readonly string[];
    readonly surfaces?: readonly string[];
    readonly compounds?: readonly string[];
  }>;
}

export interface HookValidationResult {
  readonly ok: boolean;
  readonly document: HooksDocument;
  readonly diagnostics: readonly HookDiagnostic[];
}

export type HookMirrorAxis = 'x' | 'y' | 'z';

export interface HookBoneTransform {
  readonly id: string;
  readonly parentId?: string;
  readonly translation: Vec3;
  readonly rotation?: Vec3;
  readonly scale?: Vec3;
}

export interface HookRoomBounds {
  readonly id: string;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly parentId?: string;
  readonly enclosure?: HookEnclosure;
}

export interface HookFloorFrame {
  readonly id: string;
  readonly y: number;
  readonly height: number;
  readonly offset?: Vec3;
  readonly parentId?: string;
}

export type HookTransformStep =
  | Readonly<{ kind: 'translate'; offset: Vec3 }>
  | Readonly<{ kind: 'rotate'; degrees: Vec3; pivot?: Vec3 }>
  | Readonly<{ kind: 'mirror'; axis: HookMirrorAxis; center: number }>
  | Readonly<{
      kind: 'compound_place';
      alias: string;
      origin: Vec3;
      rotate: BlockRotation;
      childSize?: Vec3;
      mirror?: Readonly<{ axis: HookMirrorAxis; center: number }>;
    }>;

export interface HookTransformContext {
  readonly bones?: Readonly<Record<string, HookBoneTransform>>;
  readonly rooms?: Readonly<Record<string, HookRoomBounds>>;
  readonly floors?: Readonly<Record<string, HookFloorFrame>>;
  readonly compounds?: Readonly<Record<string, readonly HookTransformStep[]>>;
  readonly postTransforms?: readonly HookTransformStep[];
}
