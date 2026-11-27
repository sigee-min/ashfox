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

const parseVowels = (cursor: SoundCursor): string | ParamValue => {
  if (cursor.peek() === '"')
    cursor.fail('sound.legacy-syntax: vowels must be unquoted in ashfox 1');
  const first = cursor.name();
  if (!cursor.tryTake('->'))
    return cursor.params.has(first) ? { $param: first, $dim: 'raw' } : first;
  const tokens = [first];
  do tokens.push(cursor.name());
  while (cursor.tryTake('->'));
  return tokens.join(' -> ');
};

const parseListOrTuple = (cursor: SoundCursor, dim: UnitDim, isCurve: boolean): unknown[] => {
  const close = cursor.tryTake('[') ? ']' : (cursor.take('('), ')');
  const items: unknown[] = [];
  while (cursor.peek() !== close) {
    items.push(isCurve ? parseCurveOrScalar(cursor, dim) : parseUnitScalar(cursor, dim));
    if (!cursor.tryTake(',')) break;
  }
  cursor.take(close);
  return items;
};

const pairs = (s: string): Record<string, string> =>
  Object.fromEntries(s.split(' ').map((p) => p.split(':') as [string, string]));
const KEY_MAP = pairs(
  'pulse_width:pulseWidth detune_cents:detuneCents vibrato_hz:vibratoHz vibrato_cents:vibratoCents trill_hz:trillHz trill_cents:trillCents trill_depth:trillDepth jitter_cents:jitterCents twin_beat:twinBeat stereo_spread:stereoSpread grain_ms:grainMs stereo_width:stereoWidth itd_ms:itdMs sweep_pan:sweepPan noise_tone:noiseTone bow_pressure:bowPressure time_ms:timeMs ping_pong:pingPong shift_semitones:shiftSemitones release_ms:releaseMs',
);
const FIELD_DIMS = pairs(
  'pitch:hz trillHz:hz vibratoHz:hz detuneCents:cents trillCents:cents vibratoCents:cents jitterCents:cents grainMs:ms itdMs:ms cutoff:hz rate:hz timeMs:ms releaseMs:ms attack:sec decay:sec release:sec',
) as Record<string, UnitDim>;
const IDENT_FIELDS = new Set(
  'strike waveform color material texture model env curve kind mode target'.split(' '),
);
const CURVE_FIELDS = new Set(
  'pitch pulseWidth index brightness density velocity sweepPan cutoff q'.split(' '),
);

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

const parseAttrVal = (
  cursor: SoundCursor,
  key: string,
  allowCurves: boolean,
  extraDims: Record<string, UnitDim>,
): unknown => {
  if (key === 'vowels') return parseVowels(cursor);
  if (key === 'formants' || key === 'bandwidths')
    return parseListOrTuple(cursor, 'hz', key === 'formants');
  if (IDENT_FIELDS.has(key)) return parseEnumIdent(cursor);
  if (key === 'pingPong') return parseBool(cursor);
  if (key === 'by') {
    const ref = cursor.dotted();
    return ref.includes('.') ? { $ref: ref } : ref;
  }
  if (key === 'shiftSemitones') {
    const { num, unit } = readNumberAndUnit(cursor);
    return unit ? convertUnitValue(num, unit, 'st', (m) => cursor.fail(m)) : num;
  }
  const dim = extraDims[key] ?? FIELD_DIMS[key] ?? 'raw';
  return allowCurves && CURVE_FIELDS.has(key)
    ? parseCurveOrScalar(cursor, dim)
    : parseUnitScalar(cursor, dim);
};

const HDR_FIELD: Record<string, string> = { drive: 'mode', filter: 'kind', fx: 'kind' };
const parseSubBlock = (
  cursor: SoundCursor,
  key: string,
  extraDims: Record<string, UnitDim> = {},
): Record<string, unknown> => {
  const hdrField = HDR_FIELD[key];
  const hdrVal = hdrField
    ? cursor.tryTake(':') || cursor.peek() !== '{'
      ? cursor.name()
      : undefined
    : undefined;
  if (cursor.peek() !== '{') cursor.fail(`sound.legacy-syntax: ${key} requires { ... } block`);
  cursor.take('{');
  const obj: Record<string, unknown> = hdrVal && hdrField ? { [hdrField]: hdrVal } : {};
  while (cursor.peek() !== '}') {
    const rawKey = cursor.name();
    if (/[A-Z]/.test(rawKey)) {
      const known = [...Object.keys(KEY_MAP), ...Object.keys(FIELD_DIMS), ...IDENT_FIELDS];
      cursor.fail(
        `sound.legacy-syntax: camelCase "${rawKey}" removed${soundDidYouMean(rawKey, known)}`,
      );
    }
    const k = KEY_MAP[rawKey] ?? rawKey;
    if (Object.hasOwn(obj, k)) cursor.fail(`duplicate field ${rawKey}`);
    cursor.take('=');
    obj[k] = parseAttrVal(cursor, k, key === 'filter', extraDims);
    cursor.take(';');
  }
  cursor.take('}');
  return obj;
};

const parseEqBlock = (cursor: SoundCursor): Record<string, unknown> => {
  cursor.take('{');
  const eq: Record<string, unknown> = {};
  while (cursor.peek() !== '}') {
    const band = cursor.name();
    if (band !== 'low' && band !== 'mid' && band !== 'high') cursor.fail(`unknown eq band ${band}`);
    if (Object.hasOwn(eq, band)) cursor.fail(`duplicate eq band ${band}`);
    if (!cursor.tryTake('=')) {
      eq[band] = parseSubBlock(cursor, 'eq_band', { hz: 'hz', db: 'db' });
      continue;
    }
    cursor.take('(');
    const hz = parseUnitScalar(cursor, 'hz'),
      db = (cursor.take(','), parseUnitScalar(cursor, 'db'));
    const q = band === 'mid' && cursor.tryTake(',') ? parseUnitScalar(cursor, 'raw') : undefined;
    cursor.take(')');
    cursor.take(';');
    eq[band] = q !== undefined ? { hz, db, q } : { hz, db };
  }
  cursor.take('}');
  return eq;
};

interface VoiceDraft {
  readonly voice: Record<string, unknown>;
  readonly source: Record<string, unknown>;
  readonly fxList: Record<string, unknown>[];
  inlineCutoff?: unknown;
  inlineQ?: unknown;
}

const VOICE_ASSIGN = new Set('highpass lowpass pan cutoff q'.split(' '));
const setOnce = (cursor: SoundCursor, obj: Record<string, unknown>, key: string, val: unknown) => {
  if (Object.hasOwn(obj, key)) cursor.fail(`duplicate field ${key}`);
  obj[key] = val;
};

const parseInlineVoiceKey = (cursor: SoundCursor, rawKey: string, d: VoiceDraft): void => {
  const val = parseCurveOrScalar(cursor, rawKey === 'pan' || rawKey === 'q' ? 'raw' : 'hz');
  if (rawKey === 'cutoff') {
    if (d.inlineCutoff !== undefined) cursor.fail('duplicate cutoff in voice');
    d.inlineCutoff = val;
  } else if (rawKey === 'q') {
    if (d.inlineQ !== undefined) cursor.fail('duplicate q in voice');
    d.inlineQ = val;
  } else setOnce(cursor, d.voice, rawKey, val);
};

const parseVoiceAssign = (cursor: SoundCursor, rawKey: string, d: VoiceDraft): void => {
  cursor.take('=');
  if (VOICE_ASSIGN.has(rawKey)) parseInlineVoiceKey(cursor, rawKey, d);
  else
    setOnce(
      cursor,
      d.source,
      KEY_MAP[rawKey] ?? rawKey,
      parseAttrVal(cursor, KEY_MAP[rawKey] ?? rawKey, true, {}),
    );
  cursor.take(';');
};

const parseGainStmt = (cursor: SoundCursor, d: VoiceDraft): void => {
  if (d.voice.gain !== undefined) cursor.fail('duplicate gain');
  if (cursor.peek() === '{') {
    d.voice.gain = parseSubBlock(cursor, 'gain');
    return;
  }
  cursor.take('=');
  d.voice.gain = parseCurveOrScalar(cursor, 'raw');
  cursor.take(';');
};

const parseDriveStmt = (cursor: SoundCursor, d: VoiceDraft): void => {
  if (d.voice.drive !== undefined) cursor.fail('duplicate drive');
  if (!cursor.tryTake('=')) {
    d.voice.drive = parseSubBlock(cursor, 'drive');
    return;
  }
  d.voice.drive = parseUnitScalar(cursor, 'raw');
  cursor.take(';');
};

const VOICE_KEYS = Object.keys(KEY_MAP);

const parseVoiceStmt = (cursor: SoundCursor, rawKey: string, d: VoiceDraft): void => {
  if (/[A-Z]/.test(rawKey)) {
    const known = [
      ...VOICE_KEYS,
      'highpass',
      'lowpass',
      'pan',
      'cutoff',
      'q',
      'pitch',
      'attack',
      'decay',
      'release',
    ];
    cursor.fail(
      `sound.legacy-syntax: camelCase "${rawKey}" removed${soundDidYouMean(rawKey, known)}`,
    );
  }
  if (rawKey === 'source') cursor.fail('sound.legacy-syntax: source = { ... } removed in ashfox 1');
  if (rawKey === 'gain') parseGainStmt(cursor, d);
  else if (rawKey === 'eq') setOnce(cursor, d.voice, 'eq', parseEqBlock(cursor));
  else if (rawKey === 'drive') parseDriveStmt(cursor, d);
  else if (rawKey === 'fx') d.fxList.push(parseSubBlock(cursor, 'fx', { damping: 'hz' }));
  else if (rawKey === 'filter' || rawKey === 'duck' || rawKey === 'drift')
    setOnce(cursor, d.voice, rawKey, parseSubBlock(cursor, rawKey));
  else parseVoiceAssign(cursor, rawKey, d);
};

export const parseVoiceBlock = (
  cursor: SoundCursor,
  path: string,
  sourceKind: string,
  rawType: string,
): Record<string, unknown> => {
  cursor.take('{');
  const d: VoiceDraft = { voice: {}, source: { kind: sourceKind }, fxList: [] };
  while (cursor.peek() !== '}') {
    const keyOffset = (cursor.space(), cursor.offset),
      rawKey = cursor.name();
    cursor.spans.set(`${path}.${rawKey}`, keyOffset);
    parseVoiceStmt(cursor, rawKey, d);
  }
  cursor.take('}');
  if (d.inlineCutoff !== undefined) {
    if (d.voice.filter) cursor.fail('duplicate filter and cutoff in voice');
    d.voice.filter = {
      kind: 'bandpass',
      cutoff: d.inlineCutoff,
      ...(d.inlineQ !== undefined ? { q: d.inlineQ } : {}),
    };
  } else if (d.inlineQ !== undefined) cursor.fail('q requires cutoff or filter block');
  if (rawType === 'aero_whoosh' && d.source.velocity === undefined) d.source.velocity = 1.2;
  if (d.fxList.length > 0) d.voice.fx = d.fxList;
  d.voice.source = d.source;
  return d.voice;
};
