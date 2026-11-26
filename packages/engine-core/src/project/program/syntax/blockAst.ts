import type { SourceDiagnostic, SourceSpan } from '../../source/contract';
import type { ProgramBinaryOperator } from './contract';

export const ASHFOX_GRAMMAR = 'ashfox 1' as const;

export const ASHFOX_TOP_KINDS = ['module', 'model', 'sprite', 'sound', 'structure', 'vfx'] as const;

export type AshfoxTopKind = (typeof ASHFOX_TOP_KINDS)[number];

export type AshfoxUnit =
  | 'plain'
  | 'second'
  | 'millisecond'
  | 'degree'
  | 'unit'
  | 'texel'
  | 'block'
  | 'hertz'
  | 'decibel'
  | 'lufs'
  | 'semitone'
  | 'cent'
  | 'ratio';

export interface AshfoxDiagnostic extends SourceDiagnostic {
  readonly path: string;
}

export interface AshfoxEasing {
  readonly kind: 'easing';
  readonly name: string;
  readonly args: readonly AshfoxExpr[];
  readonly span: SourceSpan;
}

export interface AshfoxNumberExpr {
  readonly kind: 'number';
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly text: string;
  readonly unit: AshfoxUnit;
  readonly rawUnit: string;
  readonly span: SourceSpan;
}

export interface AshfoxStringExpr {
  readonly kind: 'string';
  readonly value: string;
  readonly span: SourceSpan;
}

export interface AshfoxColorExpr {
  readonly kind: 'color';
  readonly value: string;
  readonly span: SourceSpan;
}

export interface AshfoxBoolExpr {
  readonly kind: 'boolean';
  readonly value: boolean;
  readonly span: SourceSpan;
}

export interface AshfoxPathExpr {
  readonly kind: 'path';
  readonly segments: readonly string[];
  readonly value: string;
  readonly span: SourceSpan;
}

export interface AshfoxUnaryExpr {
  readonly kind: 'unary';
  readonly operator: '+' | '-';
  readonly operand: AshfoxExpr;
  readonly span: SourceSpan;
}

export interface AshfoxBinaryExpr {
  readonly kind: 'binary';
  readonly operator: ProgramBinaryOperator;
  readonly left: AshfoxExpr;
  readonly right: AshfoxExpr;
  readonly span: SourceSpan;
}

export interface AshfoxRangeExpr {
  readonly kind: 'range';
  readonly min: AshfoxExpr;
  readonly max: AshfoxExpr;
  readonly span: SourceSpan;
}

export interface AshfoxTransitionStep {
  readonly value: AshfoxExpr;
  readonly easing: AshfoxEasing | null;
  readonly span: SourceSpan;
}

export interface AshfoxTransitionExpr {
  readonly kind: 'transition';
  readonly steps: readonly AshfoxTransitionStep[];
  readonly span: SourceSpan;
}

export interface AshfoxCallExpr {
  readonly kind: 'call';
  readonly callee: string;
  readonly args: readonly AshfoxExpr[];
  readonly span: SourceSpan;
}

export interface AshfoxMemberExpr {
  readonly kind: 'member';
  readonly object: AshfoxExpr;
  readonly member: string;
  readonly span: SourceSpan;
}

export interface AshfoxTupleExpr {
  readonly kind: 'tuple';
  readonly elements: readonly AshfoxExpr[];
  readonly span: SourceSpan;
}

export interface AshfoxListExpr {
  readonly kind: 'list';
  readonly elements: readonly AshfoxExpr[];
  readonly span: SourceSpan;
}

export interface AshfoxMapEntry {
  readonly key: string;
  readonly value: AshfoxExpr;
  readonly span: SourceSpan;
}

export interface AshfoxInlineMapExpr {
  readonly kind: 'map';
  readonly entries: readonly AshfoxMapEntry[];
  readonly span: SourceSpan;
}

export type AshfoxExpr =
  | AshfoxNumberExpr
  | AshfoxStringExpr
  | AshfoxColorExpr
  | AshfoxBoolExpr
  | AshfoxPathExpr
  | AshfoxUnaryExpr
  | AshfoxBinaryExpr
  | AshfoxRangeExpr
  | AshfoxTransitionExpr
  | AshfoxCallExpr
  | AshfoxMemberExpr
  | AshfoxTupleExpr
  | AshfoxListExpr
  | AshfoxInlineMapExpr;

export interface AshfoxImportStmt {
  readonly kind: 'import';
  readonly path: string;
  readonly alias: string;
  readonly pathSpan: SourceSpan;
  readonly span: SourceSpan;
}

export interface AshfoxExportDecl {
  readonly kind: 'export';
  readonly declaration: AshfoxNamedBlock;
  readonly span: SourceSpan;
}

export interface AshfoxNamedBlock {
  readonly kind: 'named-block';
  readonly blockKind: string;
  readonly qualifier: string | null;
  readonly name: string | null;
  readonly typeRef: string | null;
  readonly implementsRef: string | null;
  readonly forRef: string | null;
  readonly block: AshfoxBlock;
  readonly span: SourceSpan;
}

export interface AshfoxAssignStmt {
  readonly kind: 'assign';
  readonly path: string;
  readonly segments: readonly string[];
  readonly value: AshfoxExpr;
  readonly easing: AshfoxEasing | null;
  readonly span: SourceSpan;
}

export type AshfoxBareItem =
  | { readonly kind: 'expr'; readonly value: AshfoxExpr }
  | { readonly kind: 'symbol'; readonly value: '=' | ':'; readonly span: SourceSpan };

export interface AshfoxBareStmt {
  readonly kind: 'bare';
  readonly stmtKind: string;
  readonly items: readonly AshfoxBareItem[];
  readonly block: AshfoxBlock | null;
  readonly span: SourceSpan;
}

export type AshfoxStatement =
  AshfoxImportStmt | AshfoxExportDecl | AshfoxNamedBlock | AshfoxAssignStmt | AshfoxBareStmt;

export interface AshfoxBlock {
  readonly kind: 'block';
  readonly statements: readonly AshfoxStatement[];
  readonly span: SourceSpan;
}

export interface AshfoxTopDecl {
  readonly kind: AshfoxTopKind;
  readonly name: string;
  readonly block: AshfoxBlock;
  readonly span: SourceSpan;
}

export interface AshfoxFile {
  readonly grammar: typeof ASHFOX_GRAMMAR;
  readonly top: AshfoxTopDecl;
  readonly span: SourceSpan;
}

export interface AshfoxParseResult {
  readonly path: string;
  readonly source: string;
  readonly grammar: typeof ASHFOX_GRAMMAR;
  readonly file: AshfoxFile | null;
  readonly diagnostics: readonly AshfoxParseDiagnostic[];
}

export type AshfoxParseDiagnostic = AshfoxDiagnostic;
