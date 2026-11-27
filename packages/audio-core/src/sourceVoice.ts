import { soundDidYouMean } from './validate';
import {
  convertUnitValue,
  parseUnitScalar,
  readNumberAndUnit,
  type ParamValue,
  type UnitDim,
} from './soundUnits';
import {
  SoundCursor,
  parseBool,
  parseCurveOrScalar,
  parseEnumIdent,
  parseKeyedBlock,
  type KeyedField,
} from './sourceBlock';

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

/** Lower a `voice <id>: <type> { ... }` block into a raw voice record. */
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

const specMap = (s: string): Record<string, KeyedField> =>
  Object.fromEntries(
    s.split(' ').map((e) => {
      const [k, t, d] = e.split(':');
      return [k!, [t ?? k!, (d ?? 'raw') as KeyedField[1]]];
    }),
  );

const VARY_SPEC = specMap(
  'vary_timing:timing:sec vary_pitch:pitchCents:cents vary_gain:gain:raw vary_duration:duration:raw',
);
const REPEAT_SPEC = specMap('count:count:raw period:period:sec');
const SPACE_SPEC = specMap(
  'preset:preset:enum mix:mix:raw decay:decay:sec damping:damping:hz size:size:raw pre_delay_ms:preDelayMs:ms width:width:raw',
);
const MASTER_SPEC = specMap(
  'gain:gainDb:db target:targetLufs:lufs peak:peakDb:db punch:punch:raw warmth:warmth:raw air:air:raw glue:glue:raw width:width:raw limit:limit:bool',
);
const LOOP_SPEC = specMap('at:at:range_sec xfade:xfade:sec');
const STEP_SCALARS: Record<string, readonly [string, UnitDim]> = {
  at: ['at', 'sec'],
  duration: ['duration', 'sec'],
  gain: ['gain', 'raw'],
  pitch: ['pitchCents', 'cents'],
};

const readStepField = (
  cursor: SoundCursor,
  key: string,
  step: Record<string, unknown>,
  vary: Record<string, unknown>,
): void => {
  if (key === 'voice') {
    const ref = cursor.dotted();
    step.voice = ref.includes('.') ? { $ref: ref } : ref;
  } else if (key in VARY_SPEC) {
    const [vk, dim] = VARY_SPEC[key]!;
    const a = parseUnitScalar(cursor, dim as UnitDim);
    cursor.take('..');
    vary[vk] = [a, parseUnitScalar(cursor, dim as UnitDim)];
  } else {
    const allowed = ['voice', ...Object.keys(VARY_SPEC), ...Object.keys(STEP_SCALARS)];
    const sc =
      STEP_SCALARS[key] ??
      cursor.fail(`unknown step field "${key}"${soundDidYouMean(key, allowed)}`);
    step[sc[0]] = parseUnitScalar(cursor, sc[1]);
  }
};

const parseSeqStep = (cursor: SoundCursor, stepId: string): Record<string, unknown> => {
  cursor.take('{');
  const step: Record<string, unknown> = { id: stepId, at: 0 },
    vary: Record<string, unknown> = {},
    seen = new Set<string>();
  while (cursor.peek() !== '}') {
    const key = cursor.name();
    if (/[A-Z]/.test(key)) {
      const allowed = ['voice', ...Object.keys(VARY_SPEC), ...Object.keys(STEP_SCALARS)];
      cursor.fail(
        `sound.legacy-syntax: camelCase "${key}" removed${soundDidYouMean(key, allowed)}`,
      );
    }
    if (seen.has(key)) cursor.fail(`duplicate step field ${key}`);
    seen.add(key);
    cursor.take('=');
    readStepField(cursor, key, step, vary);
    cursor.take(';');
  }
  cursor.take('}');
  if (Object.keys(vary).length > 0) step.vary = vary;
  return step;
};

/** Lower a `seq <id> { ... }` block into a raw sequence record. */
export const parseSeqDecl = (cursor: SoundCursor, path: string): Record<string, unknown> => {
  if (cursor.peek() !== '{') cursor.fail('sound.legacy-syntax: seq header attributes removed');
  cursor.take('{');
  let start: unknown = 0,
    repeat: Record<string, unknown> | undefined,
    sawStart = false;
  const steps: Record<string, unknown>[] = [];
  while (cursor.peek() !== '}') {
    const stmt = cursor.name();
    if (stmt === 'start') {
      if (sawStart) cursor.fail('duplicate start in seq');
      sawStart = true;
      cursor.take('=');
      start = parseUnitScalar(cursor, 'sec');
      cursor.take(';');
    } else if (stmt === 'repeat') {
      if (repeat) cursor.fail('duplicate repeat in seq');
      repeat = parseKeyedBlock(cursor, REPEAT_SPEC, 'repeat');
    } else if (stmt === 'step') {
      const stepId = cursor.name();
      cursor.spans.set(`${path}.steps[${steps.length}]`, cursor.offset);
      steps.push(parseSeqStep(cursor, stepId));
    } else {
      cursor.fail(
        `unknown seq statement "${stmt}"${soundDidYouMean(stmt, ['start', 'repeat', 'step'])}`,
      );
    }
  }
  cursor.take('}');
  return { start, ...(repeat ? { repeat } : {}), steps };
};

/** Lower a `loop { ... }` block into a raw loop playback record. */
export const parseLoopBlock = (cursor: SoundCursor): Record<string, unknown> => {
  const raw = parseKeyedBlock(cursor, LOOP_SPEC, 'loop');
  if (!Array.isArray(raw.at)) cursor.fail('loop requires at = <start>..<end>');
  const [start, end] = raw.at as [unknown, unknown];
  const xfade =
    raw.xfade ??
    (typeof start === 'number' && typeof end === 'number'
      ? Math.min(0.08, Math.max(0.002, (end - start) * 0.05))
      : 0.05);
  return { kind: 'loop', start, end, crossfade: xfade };
};

/** Lower a `space { ... }` block into a raw space record. */
export const parseSpaceBlock = (cursor: SoundCursor): Record<string, unknown> =>
  parseKeyedBlock(cursor, SPACE_SPEC, 'space');

/** Lower a `master { ... }` block into a raw master output record. */
export const parseMasterBlock = (cursor: SoundCursor): Record<string, unknown> => ({
  gainDb: 0,
  ...parseKeyedBlock(cursor, MASTER_SPEC, 'master'),
});
