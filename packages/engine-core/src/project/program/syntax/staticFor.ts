import type { SourceDiagnostic, SourceSpan } from '../../source/contract';
import type { ProgramToken } from './lex';
import {
  MAX_STATIC_FOR_DEPTH,
  MAX_STATIC_FOR_ITERS,
  MAX_STATIC_FOR_TOKENS,
  evalStaticIntBound,
  scalarToTokens,
  staticForError,
  tryFoldLoopExpression,
} from './staticForExpr';

export interface StaticForExpandResult {
  readonly tokens: readonly ProgramToken[];
  readonly diagnostics: readonly SourceDiagnostic[];
}

const VALID_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INTERP_RE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
const STRING_INTERP_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const isStatementStart = (prev: ProgramToken | undefined): boolean =>
  prev === undefined ||
  (prev.kind === 'symbol' && (prev.value === '{' || prev.value === '}' || prev.value === ';'));

const canSubstituteBareVar = (
  tokens: readonly ProgramToken[],
  index: number,
  env: ReadonlyMap<string, number>,
): number | undefined => {
  const token = tokens[index]!;
  if (token.kind !== 'identifier') return undefined;
  const value = env.get(token.value);
  if (value === undefined) return undefined;
  const prev = tokens[index - 1];
  const next = tokens[index + 1];
  if (prev?.kind === 'symbol' && prev.value === '.') return undefined;
  if (next?.kind === 'symbol' && (next.value === '=' || next.value === ':' || next.value === '(')) {
    return undefined;
  }
  return value;
};

const interpolateIdentifier = (
  token: ProgramToken,
  env: ReadonlyMap<string, number>,
  diagnostics: SourceDiagnostic[],
): ProgramToken => {
  let failed = false;
  const replaced = token.value.replace(INTERP_RE, (full, braced?: string, bare?: string) => {
    const key = braced ?? bare ?? '';
    const bound = env.get(key);
    if (bound === undefined) {
      diagnostics.push(
        staticForError(
          'program.static-for-unbound-interpolation',
          `Unbound identifier interpolation "${full}".`,
          token.span,
        ),
      );
      failed = true;
      return full;
    }
    if (bound < 0) {
      diagnostics.push(
        staticForError(
          'program.static-for-negative-interpolation',
          `Identifier interpolation "${full}" resolved to negative value ${bound}.`,
          token.span,
        ),
      );
      failed = true;
      return full;
    }
    return String(bound);
  });
  if (failed) return token;
  if (!VALID_IDENT_RE.test(replaced)) {
    diagnostics.push(
      staticForError(
        'program.static-for-invalid-identifier',
        `Interpolated identifier "${replaced}" is not a valid identifier.`,
        token.span,
      ),
    );
    return token;
  }
  return Object.freeze({ kind: 'identifier', value: replaced, span: token.span });
};

const interpolateString = (token: ProgramToken, env: ReadonlyMap<string, number>): ProgramToken => {
  if (!token.value.includes('${') || env.size === 0) return token;
  const replaced = token.value.replace(STRING_INTERP_RE, (full, key: string) => {
    const bound = env.get(key);
    return bound === undefined ? full : String(bound);
  });
  return replaced === token.value
    ? token
    : Object.freeze({ kind: 'string', value: replaced, span: token.span });
};

const substituteTokens = (
  tokens: readonly ProgramToken[],
  env: ReadonlyMap<string, number>,
  touched: WeakSet<ProgramToken>,
  diagnostics: SourceDiagnostic[],
): ProgramToken[] => {
  const out: ProgramToken[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok.kind === 'identifier' && tok.value.includes('$')) {
      out.push(interpolateIdentifier(tok, env, diagnostics));
      continue;
    }
    if (tok.kind === 'string') {
      out.push(interpolateString(tok, env));
      continue;
    }
    const bareVal = canSubstituteBareVar(tokens, i, env);
    if (bareVal !== undefined)
      out.push(...scalarToTokens({ value: bareVal, unit: '', isInt: true }, tok.span, touched));
    else out.push(tok);
  }
  return out;
};

const foldSubstitutedTokens = (
  tokens: readonly ProgramToken[],
  env: ReadonlyMap<string, number>,
  touched: WeakSet<ProgramToken>,
  diagnostics: SourceDiagnostic[],
): ProgramToken[] => {
  const folded: ProgramToken[] = [];
  let i = 0;
  while (i < tokens.length) {
    const outcome = tryFoldLoopExpression(tokens, i, env, touched, diagnostics);
    if (outcome) {
      folded.push(...scalarToTokens(outcome.scalar, tokens[i]!.span, touched));
      i = outcome.nextIndex;
      continue;
    }
    folded.push(tokens[i]!);
    i += 1;
  }
  return folded;
};

const findLoopBodyEnd = (
  tokens: readonly ProgramToken[],
  openBraceIndex: number,
): number | null => {
  let depth = 0;
  for (let i = openBraceIndex; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok.kind === 'symbol' && tok.value === '{') depth += 1;
    else if (tok.kind === 'symbol' && tok.value === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
};

interface ParsedForLoop {
  readonly variable: string;
  readonly varSpan: SourceSpan;
  readonly start: number;
  readonly end: number;
  readonly body: readonly ProgramToken[];
  readonly afterLoopIndex: number;
}

const validateLoopBinding = (
  tokens: readonly ProgramToken[],
  forIndex: number,
  env: ReadonlyMap<string, number>,
  diagnostics: SourceDiagnostic[],
): ProgramToken | null => {
  const forTok = tokens[forIndex]!;
  const varTok = tokens[forIndex + 1];
  const inTok = tokens[forIndex + 2];
  if (!varTok || varTok.kind !== 'identifier' || !VALID_IDENT_RE.test(varTok.value)) {
    diagnostics.push(
      staticForError(
        'program.static-for-syntax',
        'Expected loop variable name after for.',
        forTok.span,
      ),
    );
    return null;
  }
  if (!inTok || inTok.kind !== 'identifier' || inTok.value !== 'in') {
    diagnostics.push(
      staticForError(
        'program.static-for-syntax',
        'Expected "in" after loop variable.',
        varTok.span,
      ),
    );
    return null;
  }
  if (env.has(varTok.value)) {
    diagnostics.push(
      staticForError(
        'program.static-for-shadowing',
        `Loop variable "${varTok.value}" shadows an enclosing loop variable.`,
        varTok.span,
      ),
    );
    return null;
  }
  return varTok;
};

const parseStaticForHeader = (
  tokens: readonly ProgramToken[],
  forIndex: number,
  env: ReadonlyMap<string, number>,
  diagnostics: SourceDiagnostic[],
): ParsedForLoop | null => {
  const varTok = validateLoopBinding(tokens, forIndex, env, diagnostics);
  if (!varTok) return null;
  const startRes = evalStaticIntBound(tokens, forIndex + 3, env, diagnostics);
  if (!startRes) return null;
  const dots = tokens[startRes.nextIndex];
  if (!dots || dots.kind !== 'symbol' || dots.value !== '..') {
    diagnostics.push(
      staticForError(
        'program.static-for-syntax',
        'Expected ".." range separator in static for loop.',
        dots?.span ?? varTok.span,
      ),
    );
    return null;
  }
  const endRes = evalStaticIntBound(tokens, startRes.nextIndex + 1, env, diagnostics);
  if (!endRes) return null;
  const openBrace = tokens[endRes.nextIndex];
  if (!openBrace || openBrace.kind !== 'symbol' || openBrace.value !== '{') {
    diagnostics.push(
      staticForError(
        'program.static-for-syntax',
        'Expected "{" to begin static for loop body.',
        openBrace?.span ?? varTok.span,
      ),
    );
    return null;
  }
  const closeBrace = findLoopBodyEnd(tokens, endRes.nextIndex);
  if (closeBrace === null) {
    diagnostics.push(
      staticForError(
        'program.static-for-unclosed',
        'Static for loop body must close with "}".',
        openBrace.span,
      ),
    );
    return null;
  }
  return {
    variable: varTok.value,
    varSpan: varTok.span,
    start: startRes.value,
    end: endRes.value,
    body: tokens.slice(endRes.nextIndex + 1, closeBrace),
    afterLoopIndex: closeBrace + 1,
  };
};

const runLoopIteration = (
  parsed: ParsedForLoop,
  val: number,
  env: ReadonlyMap<string, number>,
  depth: number,
  out: ProgramToken[],
  diagnostics: SourceDiagnostic[],
): boolean => {
  const nextEnv = new Map(env);
  nextEnv.set(parsed.variable, val);
  const stepOut: ProgramToken[] = [];
  if (!expandSlice(parsed.body, nextEnv, depth + 1, stepOut, diagnostics)) return false;
  const touched = new WeakSet<ProgramToken>();
  const substituted = substituteTokens(stepOut, nextEnv, touched, diagnostics);
  const folded = foldSubstitutedTokens(substituted, nextEnv, touched, diagnostics);
  if (out.length + folded.length > MAX_STATIC_FOR_TOKENS) {
    diagnostics.push(
      staticForError(
        'program.static-for-token-budget',
        `Static for expansion exceeds maximum budget of ${MAX_STATIC_FOR_TOKENS} tokens.`,
        parsed.varSpan,
      ),
    );
    return false;
  }
  out.push(...folded);
  return true;
};

const expandForLoop = (
  tokens: readonly ProgramToken[],
  forIndex: number,
  env: ReadonlyMap<string, number>,
  depth: number,
  out: ProgramToken[],
  diagnostics: SourceDiagnostic[],
): number | null => {
  const tok = tokens[forIndex]!;
  if (depth >= MAX_STATIC_FOR_DEPTH) {
    diagnostics.push(
      staticForError(
        'program.static-for-depth-budget',
        `Static for nesting depth exceeds maximum of ${MAX_STATIC_FOR_DEPTH}.`,
        tok.span,
      ),
    );
    return null;
  }
  const parsed = parseStaticForHeader(tokens, forIndex, env, diagnostics);
  if (!parsed) return null;
  if (parsed.end < parsed.start) {
    diagnostics.push(
      staticForError(
        'program.static-for-range',
        `Static for range ${parsed.start}..${parsed.end} cannot have end < start.`,
        parsed.varSpan,
      ),
    );
    return null;
  }
  if (parsed.end - parsed.start > MAX_STATIC_FOR_ITERS) {
    diagnostics.push(
      staticForError(
        'program.static-for-iter-budget',
        `Static for iteration count ${parsed.end - parsed.start} exceeds maximum of ${MAX_STATIC_FOR_ITERS}.`,
        parsed.varSpan,
      ),
    );
    return null;
  }
  const count = parsed.end - parsed.start;
  for (let offset = 0; offset < count; offset += 1) {
    if (!runLoopIteration(parsed, parsed.start + offset, env, depth, out, diagnostics)) return null;
  }
  return parsed.afterLoopIndex;
};

const stepNonLoopToken = (
  tokens: readonly ProgramToken[],
  index: number,
  env: ReadonlyMap<string, number>,
  depth: number,
  out: ProgramToken[],
  diagnostics: SourceDiagnostic[],
): number => {
  const tok = tokens[index]!;
  if (tok.kind === 'identifier' && tok.value.includes('$') && depth === 0) {
    interpolateIdentifier(tok, env, diagnostics);
  }
  if (depth === 0 && tok.value === '(') {
    const outcome = tryFoldLoopExpression(tokens, index, env, new WeakSet(), diagnostics);
    if (outcome) {
      out.push(...scalarToTokens(outcome.scalar, tok.span));
      return outcome.nextIndex;
    }
  }
  out.push(tok);
  return index + 1;
};

const expandSlice = (
  tokens: readonly ProgramToken[],
  env: ReadonlyMap<string, number>,
  depth: number,
  out: ProgramToken[],
  diagnostics: SourceDiagnostic[],
): boolean => {
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok.kind === 'identifier' && tok.value === 'for' && isStatementStart(tokens[i - 1])) {
      const nextIndex = expandForLoop(tokens, i, env, depth, out, diagnostics);
      if (nextIndex === null) return false;
      i = nextIndex;
      continue;
    }
    i = stepNonLoopToken(tokens, i, env, depth, out, diagnostics);
  }
  return true;
};

/** Deterministically unrolls static `for i in start..end { ... }` loops and folds expressions. */
export const expandStaticForTokens = (tokens: readonly ProgramToken[]): StaticForExpandResult => {
  const diagnostics: SourceDiagnostic[] = [];
  const hasEof = tokens[tokens.length - 1]?.kind === 'eof';
  const body = hasEof ? tokens.slice(0, -1) : tokens;
  const expanded: ProgramToken[] = [];
  expandSlice(body, new Map(), 0, expanded, diagnostics);
  if (hasEof) expanded.push(tokens[tokens.length - 1]!);
  return Object.freeze({
    tokens: Object.freeze(expanded),
    diagnostics: Object.freeze(diagnostics),
  });
};
