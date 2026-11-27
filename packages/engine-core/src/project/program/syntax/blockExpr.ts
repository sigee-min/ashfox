import { freeze } from '../../../immutable';
import { docsHint, suggestUnit } from '../../source/suggest';
import type {
  AshfoxBoolExpr,
  AshfoxCallExpr,
  AshfoxColorExpr,
  AshfoxEasing,
  AshfoxExpr,
  AshfoxInlineMapExpr,
  AshfoxListExpr,
  AshfoxMapEntry,
  AshfoxMemberExpr,
  AshfoxNumberExpr,
  AshfoxPathExpr,
  AshfoxRangeExpr,
  AshfoxStringExpr,
  AshfoxTransitionExpr,
  AshfoxTransitionStep,
  AshfoxTupleExpr,
  AshfoxUnaryExpr,
  AshfoxUnit,
} from './blockAst';
import {
  atEnd,
  checkSym,
  currentTok,
  enterDepth,
  expectIdent,
  expectSym,
  failAt,
  joinSpan,
  leaveDepth,
  matchSym,
  peekTok,
  takeTok,
  validateSnakeKey,
  type BlockParserState,
} from './blockCursor';
import type { ProgramBinaryOperator } from './contract';

const UNITS: Readonly<Partial<Record<string, AshfoxUnit>>> = freeze({
  '': 'plain',
  s: 'second',
  ms: 'millisecond',
  deg: 'degree',
  u: 'unit',
  px: 'texel',
  b: 'block',
  hz: 'hertz',
  db: 'decibel',
  lufs: 'lufs',
  st: 'semitone',
  cents: 'cent',
  '%': 'ratio',
});

const PRECEDENCE: Readonly<Partial<Record<string, number>>> = freeze({
  '==': 1,
  '!=': 1,
  '<': 2,
  '<=': 2,
  '>': 2,
  '>=': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '%': 4,
});

const exactDecimal = (
  text: string,
): { readonly numerator: bigint; readonly denominator: bigint } | null => {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(text) ?? /^\.(\d+)$/.exec(text);
  if (match === null) return null;
  const fraction = match[2] ?? (text.startsWith('.') ? match[1]! : '');
  const whole = text.startsWith('.') ? '0' : (match[1] ?? '0');
  return {
    numerator: BigInt(whole + fraction),
    denominator: 10n ** BigInt(fraction.length),
  };
};

const parseNumberExpr = (s: BlockParserState): AshfoxNumberExpr => {
  const tok = takeTok(s);
  const match = /^([0-9]+(?:\.[0-9]+)?|\.[0-9]+)([A-Za-z%]*)$/.exec(tok.value);
  const parsed = match === null ? null : exactDecimal(match[1]!);
  const rawUnit = match?.[2] ?? '';
  const unit = UNITS[rawUnit];
  if (match === null || parsed === null) {
    failAt(s, 'program.invalid-number', 'Numeric literals must be finite.', tok);
  } else if (unit === undefined) {
    const suggested = suggestUnit(rawUnit, Object.keys(UNITS).filter(Boolean));
    failAt(
      s,
      'program.invalid-number-unit',
      `Unsupported numeric unit "${rawUnit}".${suggested ? ` Did you mean "${suggested}"?` : ''}`,
      tok,
      docsHint('model'),
    );
  }
  return freeze({
    kind: 'number',
    numerator: parsed?.numerator ?? 0n,
    denominator: parsed?.denominator ?? 1n,
    text: match?.[1] ?? '0',
    unit: unit ?? 'plain',
    rawUnit,
    span: tok.span,
  });
};

const parseCommaList = (s: BlockParserState, close: string): readonly AshfoxExpr[] => {
  const items: AshfoxExpr[] = [];
  while (!checkSym(s, close) && !atEnd(s)) {
    items.push(parseBlockExpr(s));
    if (!matchSym(s, ',')) break;
  }
  return freeze(items);
};

const parseIdentOrCall = (s: BlockParserState): AshfoxExpr => {
  const first = takeTok(s);
  if (first.value === 'true' || first.value === 'false') {
    return freeze({
      kind: 'boolean',
      value: first.value === 'true',
      span: first.span,
    } satisfies AshfoxBoolExpr);
  }
  const segments = [first.value];
  let endSpan = first.span;
  while (checkSym(s, '.') && peekTok(s).kind === 'identifier') {
    takeTok(s);
    const next = takeTok(s);
    segments.push(next.value);
    endSpan = next.span;
  }
  const full = segments.join('.');
  if (!matchSym(s, '(')) {
    return freeze({
      kind: 'path',
      segments: freeze(segments),
      value: full,
      span: joinSpan(first.span, endSpan),
    } satisfies AshfoxPathExpr);
  }
  const args = parseCommaList(s, ')');
  const close = expectSym(s, ')', 'Expected ) to close a call.');
  return freeze({
    kind: 'call',
    callee: full,
    args,
    span: joinSpan(first.span, close.span),
  } satisfies AshfoxCallExpr);
};

const parseTupleOrGroup = (s: BlockParserState): AshfoxExpr => {
  const open = takeTok(s);
  if (checkSym(s, ')')) {
    const close = takeTok(s);
    return freeze({
      kind: 'tuple',
      elements: freeze([]),
      span: joinSpan(open.span, close.span),
    } satisfies AshfoxTupleExpr);
  }
  const first = parseBlockExpr(s);
  if (!matchSym(s, ',')) {
    expectSym(s, ')', 'Expected ) to close a grouped expression.');
    return first;
  }
  const rest = parseCommaList(s, ')');
  const close = expectSym(s, ')', 'Expected ) to close a tuple.');
  return freeze({
    kind: 'tuple',
    elements: freeze([first, ...rest]),
    span: joinSpan(open.span, close.span),
  } satisfies AshfoxTupleExpr);
};

const parseListExpr = (s: BlockParserState): AshfoxListExpr => {
  const open = takeTok(s);
  const elements = parseCommaList(s, ']');
  const close = expectSym(s, ']', 'Expected ] to close a list.');
  return freeze({
    kind: 'list',
    elements,
    span: joinSpan(open.span, close.span),
  });
};

const parseInlineMap = (s: BlockParserState): AshfoxInlineMapExpr => {
  const open = takeTok(s);
  enterDepth(s, open);
  const entries: AshfoxMapEntry[] = [];
  try {
    while (!checkSym(s, '}') && !atEnd(s)) {
      const key = expectIdent(s, 'Expected snake_case key in inline map.');
      validateSnakeKey(s, key);
      expectSym(s, '=', 'Expected = in inline map entry.');
      const value = parseBlockExpr(s);
      if (!matchSym(s, ';') && !checkSym(s, '}')) matchSym(s, ',');
      entries.push(freeze({ key: key.value, value, span: joinSpan(key.span, value.span) }));
    }
    const close = expectSym(s, '}', 'Expected } to close inline map.');
    return freeze({ kind: 'map', entries: freeze(entries), span: joinSpan(open.span, close.span) });
  } finally {
    leaveDepth(s);
  }
};

const parseAtom = (s: BlockParserState): AshfoxExpr => {
  const tok = currentTok(s);
  if (tok.kind === 'number') return parseNumberExpr(s);
  if (tok.kind === 'string') {
    takeTok(s);
    return freeze({ kind: 'string', value: tok.value, span: tok.span } satisfies AshfoxStringExpr);
  }
  if (tok.kind === 'color') {
    takeTok(s);
    return freeze({ kind: 'color', value: tok.value, span: tok.span } satisfies AshfoxColorExpr);
  }
  if (tok.kind === 'identifier') return parseIdentOrCall(s);
  if (checkSym(s, '(')) return parseTupleOrGroup(s);
  if (checkSym(s, '[')) return parseListExpr(s);
  if (checkSym(s, '{')) return parseInlineMap(s);
  failAt(s, 'program.expected-expression', 'Expected an expression.', tok);
  takeTok(s);
  return freeze({
    kind: 'number',
    numerator: 0n,
    denominator: 1n,
    text: '0',
    unit: 'plain',
    rawUnit: '',
    span: tok.span,
  });
};

const parsePostfix = (s: BlockParserState): AshfoxExpr => {
  let result = parseAtom(s);
  while (checkSym(s, '.') && peekTok(s).kind === 'identifier') {
    takeTok(s);
    const member = takeTok(s);
    result = freeze({
      kind: 'member',
      object: result,
      member: member.value,
      span: joinSpan(result.span, member.span),
    } satisfies AshfoxMemberExpr);
  }
  return result;
};

const parseUnary = (s: BlockParserState): AshfoxExpr => {
  if (!checkSym(s, '+') && !checkSym(s, '-')) return parsePostfix(s);
  const op = takeTok(s);
  enterDepth(s, op);
  try {
    const operand = parseUnary(s);
    return freeze({
      kind: 'unary',
      operator: op.value as '+' | '-',
      operand,
      span: joinSpan(op.span, operand.span),
    } satisfies AshfoxUnaryExpr);
  } finally {
    leaveDepth(s);
  }
};

const parseBinary = (s: BlockParserState, minimum: number): AshfoxExpr => {
  let left = parseUnary(s);
  while (currentTok(s).kind === 'symbol') {
    const prec = PRECEDENCE[currentTok(s).value];
    if (prec === undefined || prec < minimum) break;
    const op = takeTok(s);
    enterDepth(s, op);
    try {
      const right = parseBinary(s, prec + 1);
      left = freeze({
        kind: 'binary',
        operator: op.value as ProgramBinaryOperator,
        left,
        right,
        span: joinSpan(left.span, right.span),
      });
    } finally {
      leaveDepth(s);
    }
  }
  return left;
};

const parseRangeExpr = (s: BlockParserState): AshfoxExpr => {
  const min = parseBinary(s, 0);
  if (!matchSym(s, '..')) return min;
  const max = parseBinary(s, 0);
  return freeze({
    kind: 'range',
    min,
    max,
    span: joinSpan(min.span, max.span),
  } satisfies AshfoxRangeExpr);
};

export const parseOptionalEasing = (s: BlockParserState): AshfoxEasing | null => {
  if (currentTok(s).kind !== 'identifier') return null;
  const name = takeTok(s);
  validateSnakeKey(s, name);
  if (!matchSym(s, '(')) {
    return freeze({ kind: 'easing', name: name.value, args: freeze([]), span: name.span });
  }
  const args = parseCommaList(s, ')');
  const close = expectSym(s, ')', 'Expected ) to close easing arguments.');
  return freeze({ kind: 'easing', name: name.value, args, span: joinSpan(name.span, close.span) });
};

export const parseBlockExpr = (s: BlockParserState): AshfoxExpr => {
  enterDepth(s);
  try {
    const first = parseRangeExpr(s);
    if (!checkSym(s, '->')) return first;
    const steps: AshfoxTransitionStep[] = [
      freeze({ value: first, easing: null, span: first.span }),
    ];
    while (matchSym(s, '->')) {
      const value = parseRangeExpr(s);
      const easing = parseOptionalEasing(s);
      const endSpan = easing?.span ?? value.span;
      steps.push(freeze({ value, easing, span: joinSpan(value.span, endSpan) }));
    }
    const last = steps[steps.length - 1]!;
    return freeze({
      kind: 'transition',
      steps: freeze(steps),
      span: joinSpan(first.span, last.span),
    } satisfies AshfoxTransitionExpr);
  } finally {
    leaveDepth(s);
  }
};
