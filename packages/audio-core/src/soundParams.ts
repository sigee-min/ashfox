import type { SoundCursor } from './sourceBlock';
import { convertUnitValue, isParamRef, readNumberAndUnit, type ParamEntry } from './soundUnits';

const readParamValue = (cursor: SoundCursor): ParamEntry => {
  const next = cursor.peek();
  if (next === '"') return { value: cursor.stringLiteral() };
  if (/^[a-zA-Z_]/.test(next)) {
    const w = cursor.name();
    return { value: w === 'true' ? true : w === 'false' ? false : w };
  }
  const { num, unit } = readNumberAndUnit(cursor);
  return { value: num, ...(unit ? { unit } : {}) };
};

export const parseParamBlock = (
  cursor: SoundCursor,
  register = true,
): Record<string, ParamEntry> => {
  cursor.take('{');
  const out: Record<string, ParamEntry> = Object.create(null);
  while (cursor.peek() !== '}') {
    const key = cursor.name();
    if (/[A-Z]/.test(key)) cursor.fail(`sound.legacy-syntax: camelCase param "${key}" removed`);
    if (Object.hasOwn(out, key)) cursor.fail(`duplicate param ${key}`);
    cursor.take('=');
    out[key] = readParamValue(cursor);
    cursor.take(';');
    if (register) cursor.params.add(key);
  }
  cursor.take('}');
  return out;
};

export const resolveParamValue = (
  val: unknown,
  params: Readonly<Record<string, ParamEntry>>,
  fail: (msg: string) => never,
): unknown => {
  if (isParamRef(val)) {
    const e = params[val.$param];
    if (!e) return fail(`unknown param "${val.$param}"`);
    return typeof e.value === 'number'
      ? convertUnitValue(e.value, e.unit, val.$dim, fail)
      : e.value;
  }
  if (Array.isArray(val)) return val.map((item) => resolveParamValue(item, params, fail));
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) out[k] = resolveParamValue(v, params, fail);
    return out;
  }
  return val;
};

export const applySoundDefaults = (
  body: Record<string, unknown>,
  params: Readonly<Record<string, ParamEntry>>,
  fail: (msg: string) => never,
): Record<string, unknown> => {
  const r = resolveParamValue(body, params, fail) as Record<string, unknown>;
  r.sample_rate ??= 48000;
  r.channels ??= 2;
  r.playback ??= { kind: 'oneshot' };
  if (r.variants === undefined && typeof r.seed === 'number') {
    const s = r.seed >>> 0;
    r.variants = [
      { id: 'base', seed: s },
      { id: 'alternate', seed: (s ^ 0x9e3779b9) >>> 0 || 1 },
    ];
  }
  return r;
};
