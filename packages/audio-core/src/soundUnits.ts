import { soundDidYouMean } from './validate';

export type UnitDim = 'sec' | 'ms' | 'hz' | 'db' | 'lufs' | 'cents' | 'st' | 'raw' | 'any';
export interface ParamValue {
  readonly $param: string;
  readonly $dim: UnitDim;
}
export interface ParamEntry {
  readonly value: number | string | boolean;
  readonly unit?: string;
}
export const isParamRef = (v: unknown): v is ParamValue =>
  Boolean(v && typeof v === 'object' && !Array.isArray(v) && '$param' in v);

interface UnitCursor {
  offset: number;
  readonly source: string;
  readonly params: Set<string>;
  fail(message: string): never;
  peek(): string;
  match(re: RegExp, msg: string): string;
  name(): string;
}

const UNIT_SCALE: Record<UnitDim, Record<string, number>> = {
  sec: { ms: 0.001, s: 1 },
  ms: { ms: 1, s: 1000 },
  hz: { hz: 1, khz: 1000 },
  db: { db: 1 },
  lufs: { lufs: 1, db: 1 },
  cents: { cents: 1, st: 100 },
  st: { st: 1, cents: 0.01 },
  raw: { '%': 0.01 },
  any: { ms: 1, s: 1, hz: 1, khz: 1, db: 1, lufs: 1, cents: 1, st: 1, '%': 1 },
};

export const readNumberAndUnit = (
  cursor: UnitCursor,
): { readonly num: number; readonly unit?: string } => {
  const numStr = cursor.match(/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'expected number');
  const suf = /^(lufs|cents|ms|khz|hz|db|st|s|%)(?![a-zA-Z0-9_])/i.exec(
    cursor.source.slice(cursor.offset),
  );
  if (!suf) return { num: Number(numStr) };
  cursor.offset += suf[1]!.length;
  return { num: Number(numStr), unit: suf[1]!.toLowerCase() };
};

export const convertUnitValue = (
  value: number,
  unit: string | undefined,
  dim: UnitDim,
  fail: (msg: string) => never,
): number => {
  if (dim === 'any') return value;
  if (!unit) return dim === 'raw' ? value : fail(`unit required for ${dim}`);
  const f = UNIT_SCALE[dim][unit];
  if (f !== undefined) return value * f;
  const suggestion = soundDidYouMean(unit, Object.keys(UNIT_SCALE[dim]));
  return fail(`unit "${unit}" is invalid for ${dim}${suggestion}`);
};

export const parseUnitScalar = (cursor: UnitCursor, dim: UnitDim): number | ParamValue => {
  const next = cursor.peek();
  if (next === '{') cursor.fail('sound.legacy-syntax: bracketed object syntax removed in ashfox 1');
  if (/^[a-zA-Z_]/.test(next)) {
    const w = cursor.name();
    return cursor.params.has(w)
      ? { $param: w, $dim: dim }
      : cursor.fail(`unexpected identifier "${w}"`);
  }
  const { num, unit } = readNumberAndUnit(cursor);
  return convertUnitValue(num, unit, dim, (m) => cursor.fail(m));
};
