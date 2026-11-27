import { ASHFOX_UNITS, docsHint, formatDidYouMean, suggestUnit } from '../../source/suggest';
import type { SourceSpan } from '../../source/contract';
import { assertWellFormedSourceText } from '../../workspace/path';
import type {
  AshfoxAssignStmt,
  AshfoxBlock,
  AshfoxExpr,
  AshfoxImportStmt,
  AshfoxNumberExpr,
  AshfoxStatement,
  AshfoxTopDecl,
  AshfoxTopKind,
  AshfoxUnit,
} from './blockAst';
import { parseAshfoxProgram } from './blockParser';

/** Hook pass-through block/statement keywords shared across asset domains. */
export const HOOK_PASS_KINDS: ReadonlySet<string> = new Set([
  'schema',
  'anchor',
  'volume',
  'cue',
  'meta',
  'zone',
  'mc_block',
]);

/** Returns true when a bare statement is a hook pass-through `mc_block` directive. */
export const isHookPassBare = (stmt: AshfoxStatement): boolean =>
  stmt.kind === 'bare' && stmt.stmtKind === 'mc_block';

export interface SyntaxIssueDetail {
  readonly code: string;
  readonly file: string;
  readonly pointer: string;
  readonly expected: string;
  readonly actual: string;
  readonly hint: string;
}

export type FailBlockSyntax = (
  file: string,
  span: SourceSpan,
  expected: string,
  actual: string,
  candidates?: readonly string[],
) => never;

/** Builds a standardized domain diagnostic detail with fuzzy suggestion and docs hint. */
export const buildSyntaxDetail = (
  code: string,
  domain: string,
  file: string,
  span: SourceSpan,
  expected: string,
  actual: string,
  candidates?: readonly string[],
): SyntaxIssueDetail => {
  const actualText = actual || 'EOF';
  const suggestion = actual && candidates ? formatDidYouMean(actual, candidates) : '';
  return {
    code,
    file,
    pointer: `line:${span.start.line}:${span.start.column}`,
    expected,
    actual: `${actualText}${suggestion}`,
    hint: docsHint(domain),
  };
};

/** Creates a domain-typed syntax failure helper backed by `formatDidYouMean` and `docsHint`. */
export const createDomainFail =
  (
    code: string,
    domain: string,
    throwError: (detail: SyntaxIssueDetail) => never,
  ): FailBlockSyntax =>
  (file, span, expected, actual, candidates) =>
    throwError(buildSyntaxDetail(code, domain, file, span, expected, actual, candidates));

/** Validates source text, parses the `ashfox 1` block AST, and enforces the allowed top kinds. */
export const parseAshfoxTop = <K extends AshfoxTopKind>(
  source: string,
  file: string,
  allowedKinds: readonly K[],
  failParse: (span: SourceSpan, message: string) => never,
  failTopKind: FailBlockSyntax,
  expectedTop = allowedKinds.join(' or '),
): AshfoxTopDecl & { readonly kind: K } => {
  assertWellFormedSourceText(source);
  const parsed = parseAshfoxProgram(source, file);
  if (parsed.diagnostics.length > 0 || parsed.file === null) {
    const first = parsed.diagnostics[0];
    return failParse(
      first?.span ?? { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
      first?.message ?? 'syntax error',
    );
  }
  const top = parsed.file.top;
  if (!allowedKinds.includes(top.kind as K)) {
    return failTopKind(file, top.span, expectedTop, top.kind);
  }
  return top as AshfoxTopDecl & { readonly kind: K };
};

/** Converts an exact rational `AshfoxNumberExpr` into a JS number. */
export const ashfoxNumberRatio = (expr: AshfoxNumberExpr): number =>
  Number(expr.numerator) / Number(expr.denominator);

export type UnitDecodeResult =
  { readonly ok: true; readonly value: number } | { readonly ok: false; readonly rawUnit: string };

/** Decodes an exact rational number literal under a domain's allowed unit set. */
export const decodeUnitNumber = (
  expr: AshfoxNumberExpr,
  allowed: ReadonlySet<AshfoxUnit> | 'any',
): UnitDecodeResult => {
  if (allowed !== 'any' && !allowed.has(expr.unit)) {
    return { ok: false, rawUnit: expr.rawUnit };
  }
  const raw = ashfoxNumberRatio(expr);
  if (expr.unit === 'millisecond' && expr.rawUnit === 'ms' && expr.denominator === 1n) {
    return { ok: true, value: raw / 1000 };
  }
  if (expr.unit === 'ratio' && expr.rawUnit === '%') {
    return { ok: true, value: raw / 100 };
  }
  return { ok: true, value: raw };
};

export type SignedNumberDecodeResult =
  | { readonly ok: true; readonly value: number }
  | {
      readonly ok: false;
      readonly reason: 'not-number' | 'bad-unit';
      readonly actual: string;
      readonly span: SourceSpan;
    };

/** Decodes a number literal or unary signed number under an allowed unit policy. */
export const decodeSignedNumber = (
  expr: AshfoxExpr,
  allowed: ReadonlySet<AshfoxUnit> | 'any',
): SignedNumberDecodeResult => {
  const isUnaryNum = expr.kind === 'unary' && expr.operand.kind === 'number';
  const numExpr = expr.kind === 'number' ? expr : isUnaryNum ? expr.operand : null;
  if (numExpr === null) {
    return { ok: false, reason: 'not-number', actual: expr.kind, span: expr.span };
  }
  const decoded = decodeUnitNumber(numExpr, allowed);
  if (!decoded.ok) {
    return { ok: false, reason: 'bad-unit', actual: decoded.rawUnit, span: numExpr.span };
  }
  const sign = expr.kind === 'unary' && expr.operator === '-' ? -1 : 1;
  return { ok: true, value: decoded.value * sign };
};

/** Decodes a plain scalar literal (`number`, signed `number`, `string`, `boolean`, `path`). */
export const ashfoxScalarExprValue = (
  expr: AshfoxExpr,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly kind: string } => {
  if (expr.kind === 'number') return { ok: true, value: ashfoxNumberRatio(expr) };
  if (expr.kind === 'unary' && expr.operand.kind === 'number') {
    const val = ashfoxNumberRatio(expr.operand);
    return { ok: true, value: expr.operator === '-' ? -val : val };
  }
  if (expr.kind === 'string' || expr.kind === 'boolean' || expr.kind === 'path') {
    return { ok: true, value: expr.value };
  }
  return { ok: false, kind: expr.kind };
};

/** Formats an expected-unit hint with a fuzzy unit suggestion when recognized. */
export const suggestUnitExpected = (
  baseExpected: string,
  rawUnit: string,
  allowed: readonly string[] = ASHFOX_UNITS,
): string => {
  const suggested = suggestUnit(rawUnit, allowed);
  return suggested ? `${baseExpected}. Did you mean "${suggested}"?` : baseExpected;
};

/** Verifies every key belongs to a closed set of allowed property names, emitting suggestions. */
export const assertClosedProps = (
  keys: Iterable<string>,
  allowed: ReadonlySet<string>,
  scopeSpan: SourceSpan,
  keySpan: (key: string) => SourceSpan,
  file: string,
  fail: FailBlockSyntax,
  expected = 'allowed attribute',
): void => {
  const candidates = [...allowed];
  for (const key of keys) {
    if (!allowed.has(key)) {
      fail(file, keySpan(key) ?? scopeSpan, expected, key, candidates);
    }
  }
};

/** Validates a closed string choice against allowed values, emitting `Did you mean` on failure. */
export const assertClosedChoice = <T extends string>(
  value: string,
  allowed: readonly T[] | ReadonlySet<T>,
  file: string,
  span: SourceSpan,
  expected: string,
  fail: FailBlockSyntax,
): T => {
  const list = Array.isArray(allowed) ? allowed : [...(allowed as ReadonlySet<T>)];
  if (list.includes(value as T)) return value as T;
  return fail(file, span, expected, value, list);
};

/** Validates that an assignment statement has a single segment and no trailing easing clause. */
export const assertSimpleAssign = (
  stmt: AshfoxAssignStmt,
  file: string,
  fail: FailBlockSyntax,
  expected = 'simple assignment',
): void => {
  if (stmt.easing !== null || stmt.segments.length !== 1) {
    fail(file, stmt.span, expected, stmt.path);
  }
};

/** Collects assignment expressions from a block, optionally skipping nested named blocks. */
export const collectBlockAssigns = (
  block: AshfoxBlock,
  file: string,
  fail: FailBlockSyntax,
  allowNamedBlocks = false,
): Map<string, AshfoxExpr> => {
  const map = new Map<string, AshfoxExpr>();
  for (const stmt of block.statements) {
    if (stmt.kind === 'assign') {
      map.set(stmt.path, stmt.value);
    } else if (allowNamedBlocks && stmt.kind === 'named-block') {
      continue;
    } else {
      fail(file, stmt.span, 'property assignment', stmt.kind);
    }
  }
  return map;
};

/** Records an import declaration while rejecting duplicate aliases in the same unit. */
export const addUniqueImport = (
  imports: { path: string; alias: string }[],
  aliases: Set<string>,
  stmt: AshfoxImportStmt,
  file: string,
  fail: FailBlockSyntax,
): void => {
  if (aliases.has(stmt.alias)) {
    fail(file, stmt.span, 'unique import alias', stmt.alias);
  }
  aliases.add(stmt.alias);
  imports.push({ path: stmt.path, alias: stmt.alias });
};
