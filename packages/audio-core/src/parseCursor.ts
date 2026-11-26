import { SoundError } from './validate';

const SNAKE_KEY_RE = /^[a-z][a-z0-9_]*$/;
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const MS_UNIT_KEYS = new Set(['grain_ms', 'pre_delay', 'pre_delay_ms']);
const LOG_CURVE_KEYS = new Set(['pitch', 'cutoff', 'highpass', 'lowpass', 'formants']);
const REF_LIST_KEYS = new Set(['voices', 'sequences']);
const EASINGS = new Set(['linear', 'smooth', 'ease_in', 'ease_out', 'ease_in_out', 'step']);

const UNIT_SCALE: Readonly<Record<string, number>> = {
  s: 1,
  ms: 0.001,
  hz: 1,
  khz: 1000,
  db: 1,
  lufs: 1,
  cents: 1,
  st: 100,
};

export class SoundCursor {
  offset = 0;
  private count = 0;
  readonly spans = new Map<string, number>();

  constructor(
    readonly source: string,
    readonly file: string,
  ) {}

  fail(message: string): never {
    const lines = this.source.slice(0, this.offset).split('\n');
    throw new Error(
      `${this.file}:${lines.length}:${lines[lines.length - 1].length + 1}: ${message}`,
    );
  }

  space(): void {
    while (true) {
      const rest = this.source.slice(this.offset);
      const ws = /^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/.exec(rest);
      if (!ws) return;
      this.offset += ws[0].length;
    }
  }

  peek(): string {
    this.space();
    return this.source[this.offset] ?? '';
  }

  peekTwo(): string {
    this.space();
    return this.source.slice(this.offset, this.offset + 2);
  }

  take(text: string): void {
    this.space();
    if (!this.source.startsWith(text, this.offset)) this.fail(`expected ${text}`);
    this.offset += text.length;
    if (++this.count > 16000) this.fail('token budget exceeded');
  }

  name(): string {
    this.space();
    const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(this.source.slice(this.offset));
    if (!match) return this.fail('expected identifier');
    this.take(match[0]);
    return match[0];
  }

  keyName(): string {
    const id = this.name();
    if (!SNAKE_KEY_RE.test(id)) this.fail(`expected snake_case key, got ${id}`);
    return id;
  }

  stringLiteral(): string {
    this.space();
    const rest = this.source.slice(this.offset);
    const matched = /^"(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/.exec(rest);
    if (!matched) return this.fail('expected string literal');
    this.take(matched[0]);
    return JSON.parse(matched[0]) as string;
  }

  dotted(): string {
    let result = this.name();
    while (this.peek() === '.') {
      if (this.source.slice(this.offset, this.offset + 2) === '..') break;
      this.take('.');
      result += '.' + this.name();
    }
    return result;
  }

  report(error: unknown): never {
    if (error instanceof SoundError) {
      let path = error.path;
      while (!this.spans.has(path) && path.includes('.')) {
        path = path.slice(0, path.lastIndexOf('.'));
      }
      this.offset = this.spans.get(path) ?? 0;
    }
    return this.fail(error instanceof Error ? error.message : 'invalid sound');
  }
}

const scaleNumber = (raw: number, unit: string, key: string, cursor: SoundCursor): number => {
  if (unit === '') return raw;
  if (unit === '%') return raw / 100;
  if (unit === 's' && MS_UNIT_KEYS.has(key)) return raw * 1000;
  if (unit === 'ms' && MS_UNIT_KEYS.has(key)) return raw;
  const factor = UNIT_SCALE[unit];
  if (factor === undefined) cursor.fail(`unsupported unit ${unit}`);
  return raw * factor;
};

export const parseNumberLiteral = (cursor: SoundCursor, key: string): number => {
  cursor.space();
  const rest = cursor.source.slice(cursor.offset);
  const m = NUMBER_RE.exec(rest);
  if (!m) cursor.fail('expected number');
  cursor.offset += m[0].length;
  const after = cursor.source.slice(cursor.offset);
  let unit = '';
  if (after.startsWith('%')) {
    cursor.offset += 1;
    unit = '%';
  } else {
    const u = /^[a-zA-Z]+/.exec(after);
    if (u) {
      cursor.offset += u[0].length;
      unit = u[0];
    }
  }
  return scaleNumber(Number(m[0]), unit, key, cursor);
};

const parseVariantCall = (cursor: SoundCursor, id: string): Record<string, unknown> => {
  cursor.take('(');
  const seed = parseNumberLiteral(cursor, 'seed');
  cursor.take(')');
  return { id, seed };
};

const parsePointTuple = (cursor: SoundCursor, key: string): Record<string, number> => {
  cursor.take('(');
  const at = parseNumberLiteral(cursor, 'at');
  cursor.take(',');
  const value = parseNumberLiteral(cursor, key);
  cursor.take(')');
  return { at, value };
};

const readWordAtom = (cursor: SoundCursor, key: string, allowRef: boolean): unknown => {
  const word = cursor.dotted();
  if (word === 'true' || word === 'false') return word === 'true';
  if (key === 'variants' && cursor.peek() === '(') return parseVariantCall(cursor, word);
  return allowRef || (key === 'voice' && word.includes('.')) ? { $ref: word } : word;
};

export const parseAtom = (cursor: SoundCursor, key: string, allowRef: boolean): unknown => {
  const next = cursor.peek();
  if (next === '(') return parsePointTuple(cursor, key);
  if (next === '-' || (next >= '0' && next <= '9')) return parseNumberLiteral(cursor, key);
  if (next === '"') return cursor.fail('quoted enum strings are forbidden in ashfox 1');
  if (/^[a-zA-Z_]/.test(next)) return readWordAtom(cursor, key, allowRef);
  return cursor.fail('expected literal value');
};

const buildTransitionCurve = (vals: number[], linear: boolean, key: string) => ({
  domain: !linear && LOG_CURVE_KEYS.has(key) && vals.every((v) => v > 0) ? 'log' : 'linear',
  interpolation: linear ? 'linear' : 'smooth',
  points: vals.map((value, i) => ({ at: i / (vals.length - 1), value })),
});

const parseListExpr = (
  cursor: SoundCursor,
  depth: number,
  key: string,
  allowRef: boolean,
): unknown[] => {
  cursor.take('[');
  const values: unknown[] = [];
  const childRef = allowRef || REF_LIST_KEYS.has(key);
  while (cursor.peek() !== ']') {
    values.push(parseExpr(cursor, depth + 1, key, childRef));
    if (cursor.peek() !== ']') cursor.take(',');
  }
  cursor.take(']');
  return values;
};

const parseArrowCurve = (cursor: SoundCursor, first: number, key: string) => {
  const vals = [first];
  let hasLinear = false;
  while (cursor.peekTwo() === '->') {
    cursor.take('->');
    vals.push(parseNumberLiteral(cursor, key));
    if (!/^[a-zA-Z_]/.test(cursor.peek()) || cursor.peek() === ';') continue;
    const tag = cursor.name();
    if (!EASINGS.has(tag)) cursor.fail(`unknown easing ${tag}`);
    if (tag === 'linear') hasLinear = true;
  }
  return buildTransitionCurve(vals, hasLinear, key);
};

export const parseExpr = (
  cursor: SoundCursor,
  depth: number,
  key: string,
  allowRef: boolean,
): unknown => {
  if (depth > 16) cursor.fail('nesting exceeds 16');
  if (cursor.peek() === '[') return parseListExpr(cursor, depth, key, allowRef);
  const first = parseAtom(cursor, key, allowRef);
  if (typeof first !== 'number') return first;
  if (cursor.peekTwo() === '..') {
    cursor.take('..');
    return [first, parseNumberLiteral(cursor, key)];
  }
  if (cursor.peekTwo() === '->') return parseArrowCurve(cursor, first, key);
  return first;
};
