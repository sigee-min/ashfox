import type { ProgramExpr } from '../syntax/contract';
import type { SourceDiagnostic, SourceSpan } from '../../source/contract';

/** The asset language keeps the versioned header while using a package-aware
 * source unit.  These declarations are compiler input only; they are not a
 * runtime or persistence contract. */
export const ASHFOX_ASSET_GRAMMAR = 'ashfox 1' as const;

interface AssetSourceRef {
  readonly path: string;
  readonly span: SourceSpan;
}

export interface AssetDiagnostic extends SourceDiagnostic {
  readonly path: string;
}

export interface AssetQualifiedName {
  readonly kind: 'qualified-name';
  readonly segments: readonly string[];
  readonly span: SourceSpan;
}

export type AssetValueType =
  | 'unit'
  | 'texel'
  | 'degree'
  | 'second'
  | 'ratio'
  | 'bool'
  | 'color'
  | 'vec2<unit>'
  | 'vec3<unit>'
  | 'vec3<degree>'
  | 'vec3<ratio>'
  | 'vec2<texel>'
  | 'texel_rect'
  | 'integer';
export type AssetMotionChannel = 'position' | 'rotation' | 'scale';

export type AssetCurveName =
  | 'linear'
  | 'step'
  | 'catmullrom'
  | 'smooth'
  | 'ease_in'
  | 'ease_out'
  | 'ease_in_out'
  | 'cubic'
  | 'snap'
  | 'anticipate'
  | 'overshoot'
  | 'bounce'
  | 'elastic';

export interface AssetCurveDecl {
  readonly kind: 'curve';
  readonly name: AssetCurveName;
  readonly args: readonly ProgramExpr[];
  readonly span: SourceSpan;
}

export interface AssetImportDecl {
  readonly kind: 'import';
  readonly path: string;
  readonly alias: string;
  readonly ref: AssetSourceRef;
  readonly span: SourceSpan;
}

export interface AssetFrameDecl {
  readonly kind: 'frame';
  readonly properties: readonly AssetPropertyDecl[];
  readonly span: SourceSpan;
}

export interface AssetPropertyDecl {
  readonly kind: 'property';
  readonly name: string;
  readonly value: ProgramExpr;
  readonly span: SourceSpan;
}
