import type { SourceSpan } from '../../source/contract';

/**
 * The source-level scalar vocabulary shared by asset programs.  These types
 * deliberately contain no model, component, or runtime concepts.
 */
export type ProgramUnit = 'plain' | 'unit' | 'texel' | 'degree' | 'second' | 'ratio';

export interface ProgramExprBase {
  readonly span: SourceSpan;
}

export interface ProgramNumberExpr extends ProgramExprBase {
  readonly kind: 'number';
  /** Exact source value. Floating point exists only at target lowering. */
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly text: string;
  readonly unit: ProgramUnit;
  readonly rawUnit: string;
}

export interface ProgramStringExpr extends ProgramExprBase {
  readonly kind: 'string';
  readonly value: string;
}

export interface ProgramBooleanExpr extends ProgramExprBase {
  readonly kind: 'boolean';
  readonly value: boolean;
}

export interface ProgramColorExpr extends ProgramExprBase {
  readonly kind: 'color';
  readonly value: string;
}

export interface ProgramNameExpr extends ProgramExprBase {
  readonly kind: 'name';
  readonly value: string;
}

export interface ProgramUnaryExpr extends ProgramExprBase {
  readonly kind: 'unary';
  readonly operator: '+' | '-';
  readonly operand: ProgramExpr;
}

export type ProgramBinaryOperator =
  '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=';

export interface ProgramBinaryExpr extends ProgramExprBase {
  readonly kind: 'binary';
  readonly operator: ProgramBinaryOperator;
  readonly left: ProgramExpr;
  readonly right: ProgramExpr;
}

export interface ProgramVectorExpr extends ProgramExprBase {
  readonly kind: 'vector';
  readonly values: readonly ProgramExpr[];
}

export interface ProgramCallExpr extends ProgramExprBase {
  readonly kind: 'call';
  readonly name: string;
  readonly args: readonly ProgramExpr[];
}

/** Member access is intentionally closed to the three vector components. */
export interface ProgramMemberExpr extends ProgramExprBase {
  readonly kind: 'member';
  readonly object: ProgramExpr;
  readonly member: 'x' | 'y' | 'z';
}

export type ProgramExpr =
  | ProgramNumberExpr
  | ProgramStringExpr
  | ProgramBooleanExpr
  | ProgramColorExpr
  | ProgramNameExpr
  | ProgramUnaryExpr
  | ProgramBinaryExpr
  | ProgramVectorExpr
  | ProgramCallExpr
  | ProgramMemberExpr;

export interface ProgramProperty {
  readonly kind: 'property';
  readonly name: string;
  readonly value: ProgramExpr;
  readonly span: SourceSpan;
}

/** Deterministic source-level procedural chart pattern. */
export interface ProgramTexturePattern {
  readonly kind: 'pattern';
  readonly algorithm: 'blotch';
  readonly properties: readonly ProgramProperty[];
  readonly span: SourceSpan;
}

/** Export-stable voxel face tone policy for box charts. */
export interface ProgramTextureTone {
  readonly kind: 'tone';
  readonly mode: 'voxel';
  readonly span: SourceSpan;
}

export interface ProgramTextureStampDecl {
  readonly kind: 'stamp-decl';
  readonly id: string;
  readonly properties: readonly ProgramProperty[];
  readonly span: SourceSpan;
}

export interface ProgramTextureStampUse {
  readonly kind: 'stamp';
  readonly id: string;
  readonly properties: readonly ProgramProperty[];
  readonly span: SourceSpan;
}

export interface ProgramTextureCoverage {
  readonly kind: 'coverage';
  readonly bits: string;
  readonly span: SourceSpan;
}

export interface ProgramTextureChartFace {
  readonly kind: 'face';
  readonly direction: 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
  readonly statements: readonly ProgramChartStatement[];
  readonly span: SourceSpan;
}

export type ProgramChartStatement =
  | ProgramProperty
  | ProgramTexturePattern
  | ProgramTextureStampUse
  | ProgramTextureChartFace
  | ProgramTextureCoverage;

export interface ProgramTextureChart {
  readonly kind: 'chart';
  readonly id: string;
  readonly layout: 'box' | 'flat';
  readonly statements: readonly ProgramChartStatement[];
  readonly span: SourceSpan;
}

export interface ProgramTexturePalette {
  readonly kind: 'palette';
  readonly properties: readonly ProgramProperty[];
  readonly span: SourceSpan;
}

/** Texture-wide deterministic within-ramp microvariation pass. */
export interface ProgramTextureGrain {
  readonly kind: 'grain';
  readonly algorithm: 'clustered';
  readonly seed: ProgramProperty | null;
  readonly span: SourceSpan;
}

export interface ProgramTextureDecl {
  readonly kind: 'texture';
  readonly id: string;
  readonly statements: readonly ProgramTextureStatement[];
  readonly span: SourceSpan;
}

export type ProgramTextureStatement =
  | ProgramProperty
  | ProgramTextureChart
  | ProgramTexturePalette
  | ProgramTextureGrain
  | ProgramTextureTone
  | ProgramTextureStampDecl;
