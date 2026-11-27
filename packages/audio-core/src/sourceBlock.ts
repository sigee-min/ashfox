import { SOUND_DOCS_HINT, SoundError, SoundSyntaxError, soundDidYouMean } from './validate';
import {
  convertUnitValue,
  isParamRef,
  parseUnitScalar,
  readNumberAndUnit,
  type ParamEntry,
  type ParamValue,
  type UnitDim,
} from './soundUnits';
export {
  convertUnitValue,
  isParamRef,
  parseUnitScalar,
  readNumberAndUnit,
  type ParamEntry,
  type ParamValue,
  type UnitDim,
};

const SPACE_RE = /(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/uy;
export class SoundCursor {
  offset = 0;
  private count = 0;
  readonly spans = new Map<string, number>();
  readonly params = new Set<string>();
  constructor(
    readonly source: string,
    readonly file: string,
  ) {}
  fail(message: string, hint: string | undefined = SOUND_DOCS_HINT): never {
    const lines = this.source.slice(0, this.offset).split('\n');
    throw new SoundSyntaxError(
      `${this.file}:${lines.length}:${lines[lines.length - 1]!.length + 1}: ${message}`,
      hint,
    );
  }
  space(): void {
    SPACE_RE.lastIndex = this.offset;
    if (SPACE_RE.exec(this.source)) this.offset = SPACE_RE.lastIndex;
    if (this.source.startsWith('/*', this.offset)) this.fail('unclosed block comment');
  }
  peek(): string {
    this.space();
    return this.source[this.offset] ?? '';
  }
  peekWord(): string {
    this.space();
    return /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(this.source.slice(this.offset))?.[0] ?? '';
  }
  tryTake(text: string): boolean {
    this.space();
    if (!this.source.startsWith(text, this.offset)) return false;
    this.offset += text.length;
    if (++this.count > 16000) this.fail('token budget exceeded');
    return true;
  }
  take(text: string): void {
    if (!this.tryTake(text)) this.fail(`expected ${text}`);
  }
  match(re: RegExp, msg: string): string {
    this.space();
    const m = re.exec(this.source.slice(this.offset));
    if (!m) return this.fail(msg);
    this.take(m[0]);
    return m[0];
  }
  name(): string {
    return this.match(/^[a-zA-Z_][a-zA-Z0-9_]*/, 'expected identifier');
  }
  stringLiteral(): string {
    return JSON.parse(
      this.match(/^"(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/, 'expected string'),
    ) as string;
  }
  dotted(): string {
    let r = this.name();
    while (this.peek() === '.' && !this.source.slice(this.offset).startsWith('..')) {
      this.take('.');
      r += '.' + this.name();
    }
    return r;
  }
  report(error: unknown): never {
    if (error instanceof SoundError) {
      let p = error.path;
      while (!this.spans.has(p) && p.includes('.')) p = p.slice(0, p.lastIndexOf('.'));
      this.offset = this.spans.get(p) ?? 0;
    }
    const hint = error instanceof SoundError ? (error.hint ?? SOUND_DOCS_HINT) : SOUND_DOCS_HINT;
    return this.fail(error instanceof Error ? error.message : 'invalid sound', hint);
  }
}

export const parseBool = (cursor: SoundCursor): boolean => {
  const b = cursor.name();
  if (b !== 'true' && b !== 'false') cursor.fail('expected boolean');
  return b === 'true';
};

export const parseEnumIdent = (cursor: SoundCursor): string | ParamValue => {
  if (cursor.peek() === '"') cursor.fail('sound.legacy-syntax: enums must be unquoted in ashfox 1');
  const w = cursor.name();
  return cursor.params.has(w) ? { $param: w, $dim: 'raw' } : w;
};

const EASINGS = new Set('linear smooth ease_in ease_out ease_in_out snap'.split(' '));
const SMOOTH_EASINGS = new Set('smooth ease_in ease_out ease_in_out'.split(' '));
const CURVE_MODES: Record<string, readonly ['linear' | 'log', 'linear' | 'smooth']> = {
  log: ['log', 'smooth'],
  lin: ['linear', 'linear'],
  smooth: ['linear', 'smooth'],
};
interface CurvePt {
  at?: number | ParamValue;
  value: number | ParamValue;
}

const parsePt = (cursor: SoundCursor, dim: UnitDim): CurvePt => {
  const start = cursor.offset;
  if (/^[0-9+-]/.test(cursor.peek())) {
    const { num, unit } = readNumberAndUnit(cursor);
    if (cursor.tryTake(':')) {
      return {
        at: convertUnitValue(num, unit, 'raw', (m) => cursor.fail(m)),
        value: parseUnitScalar(cursor, dim),
      };
    }
    cursor.offset = start;
  }
  return { value: parseUnitScalar(cursor, dim) };
};

const readParenInterp = (
  cursor: SoundCursor,
  fallback: 'linear' | 'smooth',
): 'linear' | 'smooth' => {
  if (!cursor.tryTake(',')) return fallback;
  const e = cursor.name();
  if (!EASINGS.has(e)) cursor.fail('expected easing name');
  return SMOOTH_EASINGS.has(e) ? 'smooth' : 'linear';
};

const finishCurve = (
  cursor: SoundCursor,
  pts: CurvePt[],
  easings: (string | undefined)[],
  domainOvr: 'linear' | 'log' | undefined,
  interp: 'linear' | 'smooth' | undefined,
  dim: UnitDim,
): Record<string, unknown> => {
  const hasAt = pts.some((p) => p.at !== undefined);
  if (hasAt && pts.some((p) => p.at === undefined)) cursor.fail('mixed curve knot times');
  if (!hasAt) pts.forEach((p, i) => (p.at = i / (pts.length - 1)));
  if (pts.length < 2) cursor.fail('curve transition requires at least 2 points');
  const isPos = pts.every((p) => typeof p.value !== 'number' || p.value > 0);
  const anySmooth = easings.some((e) => e !== undefined && SMOOTH_EASINGS.has(e));
  return {
    domain: domainOvr ?? (dim === 'hz' && isPos ? 'log' : 'linear'),
    interpolation: interp ?? (anySmooth ? 'smooth' : 'linear'),
    points: pts.map((p, i) => ({
      at: p.at!,
      value: p.value,
      ...(i < pts.length - 1 && easings[i] ? { easing: easings[i] } : {}),
    })),
  };
};

const readTransition = (
  cursor: SoundCursor,
  dim: UnitDim,
  domainOvr?: 'linear' | 'log',
  interpOvr?: 'linear' | 'smooth',
  paren = false,
): unknown => {
  const pts: CurvePt[] = [],
    easings: (string | undefined)[] = [];
  do {
    pts.push(parsePt(cursor, dim));
    const w = cursor.peekWord();
    easings.push(EASINGS.has(w) && !cursor.params.has(w) ? cursor.name() : undefined);
  } while (cursor.tryTake('->'));
  if (!paren && pts.length === 1) {
    if (pts[0]!.at !== undefined || easings[0]) cursor.fail('unexpected knot or easing without ->');
    return pts[0]!.value;
  }
  const interp = paren ? readParenInterp(cursor, interpOvr ?? 'linear') : undefined;
  if (paren) cursor.take(')');
  return finishCurve(cursor, pts, easings, domainOvr, interp, dim);
};

export const parseCurveOrScalar = (cursor: SoundCursor, dim: UnitDim): unknown => {
  const next = cursor.peek();
  if (next === '{')
    cursor.fail('sound.legacy-syntax: bracketed { domain = ... } removed in ashfox 1');
  if (next === '(')
    return (cursor.take('('), readTransition(cursor, dim, undefined, 'linear', true));
  const w = cursor.peekWord(),
    mode = CURVE_MODES[w];
  if (mode && /^\w+\s*\(/.test(cursor.source.slice(cursor.offset))) {
    cursor.name();
    cursor.take('(');
    return readTransition(cursor, dim, mode[0], mode[1], true);
  }
  return readTransition(cursor, dim);
};

export type KeyedField = readonly [string, UnitDim | 'enum' | 'bool' | 'range_sec'];
const readKeyedVal = (cursor: SoundCursor, kind: KeyedField[1]): unknown => {
  if (kind === 'enum') return parseEnumIdent(cursor);
  if (kind === 'bool') return parseBool(cursor);
  if (kind !== 'range_sec') return parseUnitScalar(cursor, kind);
  const a = parseUnitScalar(cursor, 'sec');
  cursor.take('..');
  return [a, parseUnitScalar(cursor, 'sec')];
};

export const parseKeyedBlock = (
  cursor: SoundCursor,
  spec: Record<string, KeyedField> | null,
  kindLabel: string,
): Record<string, unknown> => {
  if (cursor.peek() !== '{')
    cursor.fail(`sound.legacy-syntax: ${kindLabel} requires { ... } block`);
  cursor.take('{');
  const out: Record<string, unknown> = {};
  while (cursor.peek() !== '}') {
    const rawKey = cursor.name();
    if (/[A-Z]/.test(rawKey)) {
      const suggestion = spec ? soundDidYouMean(rawKey, Object.keys(spec)) : '';
      cursor.fail(`sound.legacy-syntax: camelCase "${rawKey}" removed${suggestion}`);
    }
    const [target, kind] = spec
      ? (spec[rawKey] ??
        cursor.fail(
          `unknown ${kindLabel} field "${rawKey}"${soundDidYouMean(rawKey, Object.keys(spec))}`,
        ))
      : [rawKey, 'raw' as const];
    if (Object.hasOwn(out, target)) cursor.fail(`duplicate ${kindLabel} field ${rawKey}`);
    cursor.take('=');
    out[target] = readKeyedVal(cursor, kind);
    cursor.take(';');
  }
  cursor.take('}');
  return out;
};
