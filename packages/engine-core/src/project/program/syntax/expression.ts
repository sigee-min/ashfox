import { freeze } from '../../../immutable';
import type {
  ProgramBinaryOperator,
  ProgramCallExpr,
  ProgramColorExpr,
  ProgramBooleanExpr,
  ProgramExpr,
  ProgramMemberExpr,
  ProgramNameExpr,
  ProgramNumberExpr,
  ProgramStringExpr,
  ProgramUnaryExpr,
  ProgramVectorExpr,
} from './contract';
import type { ProgramToken } from './lex';

export interface ProgramExpressionReader {
  /** Asset modules additionally allow nominal design references. */
  readonly qualifiedNames?: boolean;
  readonly current: () => ProgramToken;
  readonly take: () => ProgramToken;
  readonly check: (value: string) => boolean;
  readonly match: (value: string) => boolean;
  readonly fail: (code: string, message: string, token?: ProgramToken) => void;
  /** Optional parser-wide recursion accounting for fail-closed readers. */
  readonly enterDepth?: () => void;
  readonly leaveDepth?: () => void;
}

type Reader = ProgramExpressionReader;

const PRECEDENCE: Readonly<Partial<Record<string, number>>> = Object.freeze({
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

const UNITS: Readonly<Partial<Record<string, ProgramNumberExpr['unit']>>> = Object.freeze({
  '': 'plain',
  u: 'unit',
  px: 'texel',
  tx: 'texel',
  deg: 'degree',
  s: 'second',
  ratio: 'ratio',
  '%': 'ratio',
});

const exactDecimal = (
  text: string,
): {
  readonly numerator: bigint;
  readonly denominator: bigint;
} | null => {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(text) ?? /^\.(\d+)$/.exec(text);
  if (match === null) return null;
  const fraction = match[2] ?? (text.startsWith('.') ? match[1] : '');
  const whole = text.startsWith('.') ? '0' : (match[1] ?? '0');
  return {
    numerator: BigInt(whole + fraction),
    denominator: 10n ** BigInt(fraction.length),
  };
};

const guarded = <T>(reader: Reader, read: () => T): T => {
  reader.enterDepth?.();
  try {
    return read();
  } finally {
    reader.leaveDepth?.();
  }
};

const isAxis = (value: string): value is ProgramMemberExpr['member'] =>
  value === 'x' || value === 'y' || value === 'z';

/** Folds a dotted segment into a nominal name when the reader allows qualified names. */
const qualifiedName = (
  reader: Reader,
  result: ProgramExpr,
  segment: ProgramToken,
): ProgramNameExpr | null => {
  if (!reader.qualifiedNames) return null;
  const span = { start: result.span.start, end: segment.span.end };
  if (result.kind === 'name' && !isAxis(segment.value)) {
    return freeze({ kind: 'name', value: result.value + '.' + segment.value, span });
  }
  if (result.kind === 'member' && result.object.kind === 'name') {
    const value = result.object.value + '.' + result.member + '.' + segment.value;
    return freeze({ kind: 'name', value, span });
  }
  return null;
};

/** Applies one `.segment` to the current member chain. */
const memberSegment = (reader: Reader, result: ProgramExpr, segment: ProgramToken): ProgramExpr => {
  const name = qualifiedName(reader, result, segment);
  if (name !== null) return name;
  if (!isAxis(segment.value)) {
    reader.fail(
      'program.invalid-member',
      'Vector member access only supports .x, .y, or .z.',
      segment,
    );
    return result;
  }
  if (result.kind === 'member') {
    reader.fail('program.invalid-member', 'Vector member access cannot be chained.', segment);
    return result;
  }
  return freeze({
    kind: 'member',
    object: result,
    member: segment.value,
    span: { start: result.span.start, end: segment.span.end },
  } satisfies ProgramMemberExpr);
};

const member = (reader: Reader, object: ProgramExpr): ProgramExpr => {
  let result = object;
  while (reader.match('.')) {
    const segment = reader.current();
    if (segment.kind !== 'identifier') {
      reader.fail(
        'program.expected-identifier',
        'A vector member requires x, y, or z after the dot.',
        segment,
      );
      break;
    }
    reader.take();
    result = memberSegment(reader, result, segment);
  }
  return result;
};

/** Reads comma-separated expressions up to `close`; returns the closing (or offending) token. */
const items = (reader: Reader, values: ProgramExpr[], close: string): ProgramToken => {
  while (!reader.check(close) && reader.current().kind !== 'eof') {
    values.push(parseProgramExpression(reader));
    if (!reader.match(',')) break;
  }
  return reader.check(close) ? reader.take() : reader.current();
};

const numberLiteral = (reader: Reader, token: ProgramToken): ProgramExpr => {
  reader.take();
  const match = /^([0-9]+(?:\.[0-9]+)?|\.[0-9]+)([A-Za-z%]*)$/.exec(token.value);
  const parsed = match === null ? null : exactDecimal(match[1]!);
  const rawUnit = match?.[2] ?? '';
  const unit = UNITS[rawUnit];
  if (match === null || parsed === null) {
    reader.fail('program.invalid-number', 'Numeric literals must be finite.', token);
  } else if (unit === undefined) {
    reader.fail(
      'program.invalid-number-unit',
      'Unsupported numeric unit "' + rawUnit + '".',
      token,
    );
  }
  return freeze({
    kind: 'number',
    numerator: parsed?.numerator ?? 0n,
    denominator: parsed?.denominator ?? 1n,
    text: match?.[1] ?? '0',
    unit: unit ?? 'plain',
    rawUnit,
    span: token.span,
  } satisfies ProgramNumberExpr);
};

const textLiteral = (reader: Reader, token: ProgramToken): ProgramExpr => {
  reader.take();
  if (token.kind === 'string') {
    return freeze({
      kind: 'string',
      value: token.value,
      span: token.span,
    } satisfies ProgramStringExpr);
  }
  return freeze({ kind: 'color', value: token.value, span: token.span } satisfies ProgramColorExpr);
};

const identifier = (reader: Reader, token: ProgramToken): ProgramExpr => {
  reader.take();
  if (token.value === 'true' || token.value === 'false') {
    return freeze({
      kind: 'boolean',
      value: token.value === 'true',
      span: token.span,
    } satisfies ProgramBooleanExpr);
  }
  const name = token.value;
  if (!reader.match('(')) {
    return freeze({ kind: 'name', value: name, span: token.span } satisfies ProgramNameExpr);
  }
  const args: ProgramExpr[] = [];
  const close = items(reader, args, ')');
  if (close.value !== ')')
    reader.fail('program.expected-token', 'Expected ) to close a call.', close);
  return freeze({
    kind: 'call',
    name,
    args: freeze(args),
    span: { start: token.span.start, end: close.span.end },
  } satisfies ProgramCallExpr);
};

/** Reads a parenthesized group or tuple after the opening parenthesis. */
const group = (reader: Reader): ProgramExpr => {
  const first = parseProgramExpression(reader);
  if (!reader.match(',')) {
    if (!reader.match(')')) {
      reader.fail('program.expected-token', 'Expected ) to close a grouped expression.');
    }
    return first;
  }
  const values: ProgramExpr[] = [first];
  const close = items(reader, values, ')');
  if (close.value !== ')') reader.fail('program.expected-token', 'Expected ) to close a tuple.');
  return freeze({
    kind: 'vector',
    values: freeze(values),
    span: { start: first.span.start, end: close.span.end },
  } satisfies ProgramVectorExpr);
};

/** Reads a bracketed vector after the opening bracket. */
const list = (reader: Reader, token: ProgramToken): ProgramExpr => {
  const values: ProgramExpr[] = [];
  const close = items(reader, values, ']');
  if (close.value !== ']') {
    reader.fail('program.expected-token', 'Expected ] to close a vector.', close);
  }
  return freeze({
    kind: 'vector',
    values: freeze(values),
    span: { start: token.span.start, end: close.span.end },
  } satisfies ProgramVectorExpr);
};

/** Reads the operand before any member access, or null when no expression starts here. */
const operand = (reader: Reader, token: ProgramToken): ProgramExpr | null => {
  if (token.kind === 'number') return numberLiteral(reader, token);
  if (token.kind === 'string' || token.kind === 'color') return textLiteral(reader, token);
  if (token.kind === 'identifier') return identifier(reader, token);
  if (reader.match('(')) return group(reader);
  if (reader.match('[')) return list(reader, token);
  return null;
};

const primary = (reader: Reader): ProgramExpr => {
  const token = reader.current();
  const value = operand(reader, token);
  if (value !== null) return member(reader, value);
  reader.fail('program.expected-expression', 'Expected an expression.', token);
  reader.take();
  return freeze({
    kind: 'number',
    numerator: 0n,
    denominator: 1n,
    text: '0',
    unit: 'plain',
    rawUnit: '',
    span: token.span,
  });
};

const unary = (reader: Reader): ProgramExpr => {
  if (!reader.check('+') && !reader.check('-')) return primary(reader);
  const operator = reader.take();
  const value = guarded(reader, () => unary(reader));
  return freeze({
    kind: 'unary',
    operator: operator.value as '+' | '-',
    operand: value,
    span: { start: operator.span.start, end: value.span.end },
  } satisfies ProgramUnaryExpr);
};

const binary = (reader: Reader, minimum: number): ProgramExpr => {
  let left = unary(reader);
  while (true) {
    const value =
      reader.current().kind === 'symbol' ? PRECEDENCE[reader.current().value] : undefined;
    if (value === undefined || value < minimum) break;
    const operator = reader.take();
    const right = guarded(reader, () => binary(reader, value + 1));
    left = freeze({
      kind: 'binary',
      operator: operator.value as ProgramBinaryOperator,
      left,
      right,
      span: { start: left.span.start, end: right.span.end },
    });
  }
  return left;
};

export const parseProgramExpression = (reader: Reader): ProgramExpr =>
  guarded(reader, () => binary(reader, 0));
