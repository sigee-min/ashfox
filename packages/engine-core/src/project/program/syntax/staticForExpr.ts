import type { SourceDiagnostic, SourceSpan } from '../../source/contract';
import { ALLOWED_NUMBER_UNITS, type ProgramToken } from './lex';

export const MAX_STATIC_FOR_ITERS = 128;
export const MAX_STATIC_FOR_DEPTH = 3;
export const MAX_STATIC_FOR_TOKENS = 64_000;

export interface StaticScalar {
  readonly value: number;
  readonly unit: string;
  readonly isInt: boolean;
}

export interface EvalOutcome {
  readonly scalar: StaticScalar;
  readonly nextIndex: number;
  readonly touched: boolean;
}

interface EvalContext {
  readonly tokens: readonly ProgramToken[];
  readonly env: ReadonlyMap<string, number>;
  readonly touched: WeakSet<ProgramToken>;
  readonly diagnostics: SourceDiagnostic[];
  readonly strict: boolean;
}

const NUMBER_RE = /^(-?(?:\d+(?:\.\d*)?|\.\d+))([A-Za-z%]*)$/;
const EXPR_STOP = new Set([',', ';', '}', ']', '..', ')', '==', '!=', '<', '<=', '>', '>=']);

export const staticForError = (
  code: string,
  message: string,
  span: SourceSpan,
  hint?: string,
): SourceDiagnostic =>
  Object.freeze({ severity: 'error', code, message, span, ...(hint ? { hint } : {}) });

export const parseNumericToken = (raw: string): StaticScalar | null => {
  const match = NUMBER_RE.exec(raw);
  if (!match) return null;
  const numStr = match[1]!;
  const unit = match[2] ?? '';
  if (!ALLOWED_NUMBER_UNITS.has(unit)) return null;
  const value = Number(numStr);
  if (!Number.isFinite(value)) return null;
  return { value, unit, isInt: !numStr.includes('.') && Number.isInteger(value) };
};

export const formatScalarNumber = (scalar: StaticScalar): string => {
  const clean = Object.is(scalar.value, -0) ? 0 : scalar.value;
  if (scalar.isInt && Number.isInteger(clean)) return String(clean);
  return String(Number(clean.toFixed(9)));
};

export const scalarToTokens = (
  scalar: StaticScalar,
  span: SourceSpan,
  touchedSet?: WeakSet<ProgramToken>,
): ProgramToken[] => {
  const clean = Object.is(scalar.value, -0) ? 0 : scalar.value;
  const absText = formatScalarNumber({ ...scalar, value: Math.abs(clean) }) + scalar.unit;
  const numToken: ProgramToken = Object.freeze({ kind: 'number', value: absText, span });
  if (touchedSet) touchedSet.add(numToken);
  if (clean >= 0) return [numToken];
  const minusToken: ProgramToken = Object.freeze({ kind: 'symbol', value: '-', span });
  if (touchedSet) touchedSet.add(minusToken);
  return [minusToken, numToken];
};

export const isAdjacentUnitToken = (
  closeParen: ProgramToken,
  candidate: ProgramToken | undefined,
): string | null => {
  if (!candidate || candidate.span.start.offset !== closeParen.span.end.offset) return null;
  if (candidate.kind === 'symbol' && candidate.value === '%') return '%';
  if (
    candidate.kind === 'identifier' &&
    candidate.value !== '' &&
    ALLOWED_NUMBER_UNITS.has(candidate.value)
  ) {
    return candidate.value;
  }
  return null;
};

const unitDiag = (ctx: EvalContext, code: string, msg: string, span: SourceSpan): null => {
  if (ctx.strict) ctx.diagnostics.push(staticForError(code, msg, span));
  return null;
};

const combineAddSubUnit = (
  l: string,
  r: string,
  span: SourceSpan,
  ctx: EvalContext,
): string | null =>
  l === r
    ? l
    : unitDiag(ctx, 'program.static-for-unit', 'Arithmetic operands must share a unit.', span);

const combineMulUnit = (l: string, r: string, span: SourceSpan, ctx: EvalContext): string | null =>
  l === '' || r === ''
    ? l || r
    : unitDiag(
        ctx,
        'program.static-for-unit',
        'Multiplication supports at most one unit operand.',
        span,
      );

const combineDivUnit = (l: string, r: string, span: SourceSpan, ctx: EvalContext): string | null =>
  r === ''
    ? l
    : l === r
      ? ''
      : unitDiag(
          ctx,
          'program.static-for-unit',
          'Division requires a plain divisor or matching units.',
          span,
        );

const combineUnits = (
  op: string,
  left: StaticScalar,
  right: StaticScalar,
  span: SourceSpan,
  ctx: EvalContext,
): string | null => {
  if (op === '+' || op === '-') return combineAddSubUnit(left.unit, right.unit, span, ctx);
  if (op === '*') return combineMulUnit(left.unit, right.unit, span, ctx);
  if (op === '/') return combineDivUnit(left.unit, right.unit, span, ctx);
  return left.unit === '' && right.unit === ''
    ? ''
    : unitDiag(ctx, 'program.static-for-unit', 'Remainder requires plain integer operands.', span);
};

const computeOp = (op: string, l: number, r: number, isInt: boolean): number => {
  if (op === '+') return l + r;
  if (op === '-') return l - r;
  if (op === '*') return l * r;
  if (op === '/') return isInt ? Math.trunc(l / r) : l / r;
  return l % r;
};

const applyBinary = (
  op: string,
  left: StaticScalar,
  right: StaticScalar,
  span: SourceSpan,
  ctx: EvalContext,
): StaticScalar | null => {
  const unit = combineUnits(op, left, right, span, ctx);
  if (unit === null) return null;
  if ((op === '/' || op === '%') && right.value === 0) {
    return unitDiag(
      ctx,
      'program.static-for-div-zero',
      'Division by zero in static for expression.',
      span,
    );
  }
  const bothInt = left.isInt && right.isInt;
  const value = computeOp(op, left.value, right.value, bothInt);
  if (!Number.isFinite(value)) {
    return unitDiag(
      ctx,
      'program.static-for-overflow',
      'Static expression exceeds numeric bounds.',
      span,
    );
  }
  const isInt = op === '/' ? bothInt || Number.isInteger(value) : bothInt;
  return { value, unit, isInt };
};

const attachUnitSuffix = (
  scalar: StaticScalar,
  unit: string,
  span: SourceSpan,
  ctx: EvalContext,
): StaticScalar | null => {
  if (scalar.unit === '' || scalar.unit === unit) return { ...scalar, unit };
  return unitDiag(
    ctx,
    'program.static-for-unit',
    `Expression unit "${scalar.unit}" conflicts with suffix "${unit}".`,
    span,
  );
};

const parseIdentPrimary = (
  ctx: EvalContext,
  index: number,
  token: ProgramToken,
): EvalOutcome | null => {
  if (ctx.tokens[index + 1]?.value === '(') return null;
  const bound = ctx.env.get(token.value);
  if (bound !== undefined) {
    return { scalar: { value: bound, unit: '', isInt: true }, nextIndex: index + 1, touched: true };
  }
  return unitDiag(
    ctx,
    'program.static-for-non-constant',
    `Static for expression must be constant; found "${token.value}".`,
    token.span,
  );
};

const parseParenPrimary = (ctx: EvalContext, index: number): EvalOutcome | null => {
  const inner = parseAdditive(ctx, index + 1);
  if (!inner) return null;
  const close = ctx.tokens[inner.nextIndex];
  if (!close || close.kind !== 'symbol' || close.value !== ')') return null;
  const unit = isAdjacentUnitToken(close, ctx.tokens[inner.nextIndex + 1]);
  if (unit === null)
    return { scalar: inner.scalar, nextIndex: inner.nextIndex + 1, touched: inner.touched };
  const suffixed = attachUnitSuffix(inner.scalar, unit, close.span, ctx);
  return suffixed ? { scalar: suffixed, nextIndex: inner.nextIndex + 2, touched: true } : null;
};

const parsePrimary = (ctx: EvalContext, index: number): EvalOutcome | null => {
  const token = ctx.tokens[index];
  if (!token || token.kind === 'eof') return null;
  if (token.kind === 'number') {
    const scalar = parseNumericToken(token.value);
    return scalar ? { scalar, nextIndex: index + 1, touched: ctx.touched.has(token) } : null;
  }
  if (token.kind === 'identifier') return parseIdentPrimary(ctx, index, token);
  if (token.kind === 'symbol' && token.value === '(') return parseParenPrimary(ctx, index);
  return null;
};

const parseUnary = (ctx: EvalContext, index: number): EvalOutcome | null => {
  const token = ctx.tokens[index];
  if (token?.kind === 'symbol' && (token.value === '+' || token.value === '-')) {
    const inner = parseUnary(ctx, index + 1);
    if (!inner) return null;
    const value = token.value === '-' ? -inner.scalar.value : inner.scalar.value;
    return {
      scalar: { ...inner.scalar, value },
      nextIndex: inner.nextIndex,
      touched: inner.touched,
    };
  }
  return parsePrimary(ctx, index);
};

const parseMultiplicative = (ctx: EvalContext, index: number): EvalOutcome | null => {
  let acc = parseUnary(ctx, index);
  if (!acc) return null;
  while (acc.nextIndex < ctx.tokens.length) {
    const opTok = ctx.tokens[acc.nextIndex];
    if (!opTok || opTok.kind !== 'symbol' || !['*', '/', '%'].includes(opTok.value)) break;
    const rhs = parseUnary(ctx, acc.nextIndex + 1);
    if (!rhs) return null;
    const combined = applyBinary(opTok.value, acc.scalar, rhs.scalar, opTok.span, ctx);
    if (!combined) return null;
    acc = { scalar: combined, nextIndex: rhs.nextIndex, touched: acc.touched || rhs.touched };
  }
  return acc;
};

const parseAdditive = (ctx: EvalContext, index: number): EvalOutcome | null => {
  let acc = parseMultiplicative(ctx, index);
  if (!acc) return null;
  while (acc.nextIndex < ctx.tokens.length) {
    const opTok = ctx.tokens[acc.nextIndex];
    if (!opTok || opTok.kind !== 'symbol' || (opTok.value !== '+' && opTok.value !== '-')) break;
    const rhs = parseMultiplicative(ctx, acc.nextIndex + 1);
    if (!rhs) return null;
    const combined = applyBinary(opTok.value, acc.scalar, rhs.scalar, opTok.span, ctx);
    if (!combined) return null;
    acc = { scalar: combined, nextIndex: rhs.nextIndex, touched: acc.touched || rhs.touched };
  }
  return acc;
};

export const evalStaticIntBound = (
  tokens: readonly ProgramToken[],
  start: number,
  env: ReadonlyMap<string, number>,
  diagnostics: SourceDiagnostic[],
): { readonly value: number; readonly nextIndex: number } | null => {
  const ctx: EvalContext = { tokens, env, touched: new WeakSet(), diagnostics, strict: true };
  const result = parseAdditive(ctx, start);
  if (!result) return null;
  const span = tokens[start]?.span ?? tokens[tokens.length - 1]!.span;
  if (result.scalar.unit !== '' || !result.scalar.isInt || !Number.isInteger(result.scalar.value)) {
    diagnostics.push(
      staticForError(
        'program.static-for-non-integer-bound',
        'Static for loop bounds must evaluate to plain integers without units.',
        span,
      ),
    );
    return null;
  }
  return { value: result.scalar.value, nextIndex: result.nextIndex };
};

export const tryFoldLoopExpression = (
  tokens: readonly ProgramToken[],
  start: number,
  env: ReadonlyMap<string, number>,
  touched: WeakSet<ProgramToken>,
  diagnostics: SourceDiagnostic[],
): EvalOutcome | null => {
  const first = tokens[start];
  const prev = tokens[start - 1];
  if (!first || (first.value === '(' && prev?.kind === 'identifier')) return null;
  const ctx: EvalContext = { tokens, env, touched, diagnostics, strict: false };
  const outcome = parseAdditive(ctx, start);
  if (!outcome) {
    if (first.value === '(' && env.size > 0 && findUnitSuffixParenClose(tokens, start) !== null) {
      parseAdditive({ tokens, env, touched, diagnostics, strict: true }, start);
    }
    return null;
  }
  if (!outcome.touched) return null;
  const next = tokens[outcome.nextIndex];
  if (next && !EXPR_STOP.has(next.value) && next.kind !== 'eof' && !isStatementBoundaryNext(next)) {
    return null;
  }
  return outcome;
};

const isStatementBoundaryNext = (token: ProgramToken): boolean =>
  token.kind === 'identifier' || token.value === '{' || token.value === '->';

const findUnitSuffixParenClose = (
  tokens: readonly ProgramToken[],
  openIdx: number,
): number | null => {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i += 1) {
    const val = tokens[i]!.value;
    if (val === '(') depth += 1;
    else if (val === ')') {
      depth -= 1;
      if (depth === 0) return isAdjacentUnitToken(tokens[i]!, tokens[i + 1]) ? i : null;
    } else if (val === ',' || val === ';' || val === '{' || val === '}') return null;
  }
  return null;
};
