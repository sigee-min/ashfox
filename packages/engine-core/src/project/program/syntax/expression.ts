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
  ProgramVectorExpr
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

const freeze = <T>(value: T): T => Object.freeze(value);

const exactDecimal = (text: string): {
  readonly numerator: bigint;
  readonly denominator: bigint;
} | null => {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(text) ??
    /^\.(\d+)$/.exec(text);
  if (match === null) return null;
  const fraction = match[2] ?? (text.startsWith('.') ? match[1] : '');
  const whole = text.startsWith('.') ? '0' : match[1] ?? '0';
  return {
    numerator: BigInt(whole + fraction),
    denominator: 10n ** BigInt(fraction.length)
  };
};

const parseProgramExpressionInner = (
  reader: ProgramExpressionReader
): ProgramExpr => {
  const guarded = <T>(read: () => T): T => {
    reader.enterDepth?.();
    try {
      return read();
    } finally {
      reader.leaveDepth?.();
    }
  };
  const binary = (minimum: number): ProgramExpr => {
    let left = unary();
    const precedence: Readonly<Record<string, number>> = {
      '==': 1, '!=': 1, '<': 2, '<=': 2, '>': 2, '>=': 2,
      '+': 3, '-': 3, '*': 4, '/': 4, '%': 4
    };
    while (true) {
      const value = reader.current().kind === 'symbol'
        ? precedence[reader.current().value]
        : undefined;
      if (value === undefined || value < minimum) break;
      const operator = reader.take();
      const right = guarded(() => binary(value + 1));
      left = freeze({
        kind: 'binary',
        operator: operator.value as ProgramBinaryOperator,
        left,
        right,
        span: { start: left.span.start, end: right.span.end }
      });
    }
    return left;
  };

  const primary = (): ProgramExpr => {
    const token = reader.current();
    const member = (object: ProgramExpr): ProgramExpr => {
      let result = object;
      while (reader.match('.')) {
        const segment = reader.current();
        if (segment.kind !== 'identifier') {
          reader.fail('program.expected-identifier',
            'A vector member requires x, y, or z after the dot.', segment);
          break;
        }
        reader.take();
        if (reader.qualifiedNames && result.kind === 'name' &&
          segment.value !== 'x' && segment.value !== 'y' && segment.value !== 'z') {
          result = freeze({ kind: 'name', value: result.value + '.' + segment.value,
            span: { start: result.span.start, end: segment.span.end } });
          continue;
        }
        if (reader.qualifiedNames && result.kind === 'member' && result.object.kind === 'name') {
          result = freeze({ kind: 'name', value: result.object.value + '.' + result.member + '.' + segment.value,
            span: { start: result.span.start, end: segment.span.end } });
          continue;
        }
        if (segment.value !== 'x' && segment.value !== 'y' && segment.value !== 'z') {
          reader.fail('program.invalid-member',
            'Vector member access only supports .x, .y, or .z.', segment);
          continue;
        }
        if (result.kind === 'member') {
          reader.fail('program.invalid-member',
            'Vector member access cannot be chained.', segment);
          continue;
        }
        result = freeze({
          kind: 'member', object: result,
          member: segment.value as ProgramMemberExpr['member'],
          span: { start: result.span.start, end: segment.span.end }
        } satisfies ProgramMemberExpr);
      }
      return result;
    };
    if (token.kind === 'number') {
      reader.take();
      const match = /^([0-9]+(?:\.[0-9]+)?|\.[0-9]+)([A-Za-z%]*)$/.exec(token.value);
      const parsed = match === null ? null : exactDecimal(match[1]!);
      const rawUnit = match?.[2] ?? '';
      const units: Readonly<Record<string, ProgramNumberExpr['unit']>> = {
        '': 'plain', u: 'unit', px: 'texel', tx: 'texel', deg: 'degree',
        s: 'second', ratio: 'ratio', '%': 'ratio'
      };
      const unit = units[rawUnit];
      if (match === null || parsed === null) reader.fail(
        'program.invalid-number', 'Numeric literals must be finite.', token);
      else if (unit === undefined) reader.fail('program.invalid-number-unit',
        'Unsupported numeric unit "' + rawUnit + '".', token);
      return member(freeze({
        kind: 'number',
        numerator: parsed?.numerator ?? 0n,
        denominator: parsed?.denominator ?? 1n,
        text: match?.[1] ?? '0',
        unit: unit ?? 'plain',
        rawUnit,
        span: token.span
      } satisfies ProgramNumberExpr));
    }
    if (token.kind === 'string') {
      reader.take();
      return member(freeze({
        kind: 'string', value: token.value, span: token.span
      } satisfies ProgramStringExpr));
    }
    if (token.kind === 'color') {
      reader.take();
      return member(freeze({
        kind: 'color', value: token.value, span: token.span
      } satisfies ProgramColorExpr));
    }
    if (token.kind === 'identifier') {
      reader.take();
      if (token.value === 'true' || token.value === 'false') return member(freeze({
        kind: 'boolean', value: token.value === 'true', span: token.span
      } satisfies ProgramBooleanExpr));
      const name = token.value;
      let result: ProgramExpr = freeze({
        kind: 'name', value: name, span: token.span
      } satisfies ProgramNameExpr);
      if (reader.match('(')) {
        const args: ProgramExpr[] = [];
        while (!reader.check(')') && reader.current().kind !== 'eof') {
          args.push(parseProgramExpression(reader));
          if (!reader.match(',')) break;
        }
        const close = reader.check(')') ? reader.take() : reader.current();
        if (close.value !== ')') reader.fail('program.expected-token',
          'Expected ) to close a call.', close);
        result = freeze({
          kind: 'call', name, args: freeze(args),
          span: { start: token.span.start, end: close.span.end }
        } satisfies ProgramCallExpr);
      }
      return member(result);
    }
    if (reader.match('(')) {
      const first = parseProgramExpression(reader);
      if (!reader.match(',')) {
        if (!reader.match(')')) reader.fail('program.expected-token',
          'Expected ) to close a grouped expression.');
        return member(first);
      }
      const values: ProgramExpr[] = [first];
      while (!reader.check(')') && reader.current().kind !== 'eof') {
        values.push(parseProgramExpression(reader));
        if (!reader.match(',')) break;
      }
      const close = reader.check(')') ? reader.take() : reader.current();
      if (close.value !== ')') reader.fail('program.expected-token',
        'Expected ) to close a tuple.');
      return member(freeze({
        kind: 'vector', values: freeze(values),
        span: { start: first.span.start, end: close.span.end }
      } satisfies ProgramVectorExpr));
    }
    if (reader.match('[')) {
      const values: ProgramExpr[] = [];
      while (!reader.check(']') && reader.current().kind !== 'eof') {
        values.push(parseProgramExpression(reader));
        if (!reader.match(',')) break;
      }
      const close = reader.check(']') ? reader.take() : reader.current();
      if (close.value !== ']') reader.fail('program.expected-token',
        'Expected ] to close a vector.', close);
      return member(freeze({
        kind: 'vector', values: freeze(values),
        span: { start: token.span.start, end: close.span.end }
      } satisfies ProgramVectorExpr));
    }
    reader.fail('program.expected-expression', 'Expected an expression.', token);
    reader.take();
    return freeze({
      kind: 'number', numerator: 0n, denominator: 1n, text: '0',
      unit: 'plain', rawUnit: '', span: token.span
    });
  };

  const unary = (): ProgramExpr => {
    if (reader.check('+') || reader.check('-')) {
      const operator = reader.take();
      const operand = guarded(unary);
      return freeze({
        kind: 'unary', operator: operator.value as '+' | '-', operand,
        span: { start: operator.span.start, end: operand.span.end }
      } satisfies ProgramUnaryExpr);
    }
    return primary();
  };

  return binary(0);
};

export const parseProgramExpression = (
  reader: ProgramExpressionReader
): ProgramExpr => {
  reader.enterDepth?.();
  try {
    return parseProgramExpressionInner(reader);
  } finally {
    reader.leaveDepth?.();
  }
};
