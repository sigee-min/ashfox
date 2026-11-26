import { encodeUtf8 } from '@ashfox/internal-contracts';
import type { SoundRecipe } from './contract';
import { readRecipe } from './read';
import {
  SoundCursor,
  convertUnitValue,
  isParamRef,
  parseEnumIdent,
  parseKeyedBlock,
  parseUnitScalar,
  parseVoiceBlock,
  readNumberAndUnit,
  type KeyedField,
  type ParamEntry,
  type UnitDim,
} from './sourceBlock';
import { HOOK_DECL_KEYWORDS, skipHookDeclaration } from './hookSkip';

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

const parseParamBlock = (cursor: SoundCursor, register = true): Record<string, ParamEntry> => {
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

const resolveParamValue = (
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

export interface SoundImportDecl {
  readonly path: string;
  readonly alias: string;
  readonly params?: Readonly<Record<string, ParamEntry>>;
}
export interface SoundNamedDecl {
  readonly exported: boolean;
  readonly id: string;
  readonly value: Readonly<Record<string, unknown>>;
}
export interface SoundOutputRaw {
  readonly format: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}
export interface SoundPreviewRaw {
  readonly name: string;
  readonly properties: Readonly<Record<string, unknown>>;
}
export interface SoundSourceUnit {
  readonly kind: 'sound' | 'module';
  readonly id: string;
  readonly imports: readonly SoundImportDecl[];
  readonly hookAliases?: readonly string[];
  readonly params: Readonly<Record<string, ParamEntry>>;
  readonly outputs: readonly SoundOutputRaw[];
  readonly previews: readonly SoundPreviewRaw[];
  readonly voices: readonly SoundNamedDecl[];
  readonly sequences: readonly SoundNamedDecl[];
  readonly body: Readonly<Record<string, unknown>>;
  readonly report: (error: unknown) => never;
}

const parseAttrs = (cursor: SoundCursor): Record<string, unknown> => {
  cursor.take('{');
  const out: Record<string, unknown> = {};
  while (cursor.peek() !== '}') {
    const k = cursor.name();
    if (Object.hasOwn(out, k)) cursor.fail(`duplicate field ${k}`);
    cursor.take('=');
    const next = cursor.peek();
    if (next === '"') out[k] = cursor.stringLiteral();
    else if (!/^[a-zA-Z_]/.test(next)) out[k] = parseUnitScalar(cursor, 'raw');
    else {
      const w = cursor.dotted();
      out[k] = w === 'true' ? true : w === 'false' ? false : w;
    }
    cursor.take(';');
  }
  cursor.take('}');
  return out;
};

const parseOutputsDecl = (cursor: SoundCursor): SoundOutputRaw[] => {
  if (cursor.tryTake('=')) {
    cursor.take('[');
    const out: SoundOutputRaw[] = [];
    while (cursor.peek() !== ']') {
      out.push({ format: cursor.name(), attributes: {} });
      if (!cursor.tryTake(',')) break;
    }
    cursor.take(']');
    cursor.take(';');
    return out;
  }
  cursor.take('{');
  const out: SoundOutputRaw[] = [];
  while (cursor.peek() !== '}') {
    const format = cursor.name();
    out.push({ format, attributes: cursor.tryTake(';') ? {} : parseAttrs(cursor) });
  }
  cursor.take('}');
  return out;
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
    const sc = STEP_SCALARS[key] ?? cursor.fail(`unknown step field "${key}"`);
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
    if (/[A-Z]/.test(key)) cursor.fail(`sound.legacy-syntax: camelCase "${key}" removed`);
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

const parseSeqDecl = (cursor: SoundCursor, path: string): Record<string, unknown> => {
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
    } else cursor.fail(`unknown seq statement "${stmt}"`);
  }
  cursor.take('}');
  return { start, ...(repeat ? { repeat } : {}), steps };
};

const parseLoopBlock = (cursor: SoundCursor): Record<string, unknown> => {
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

interface SoundUnitDraft {
  readonly kind: 'sound' | 'module';
  readonly imports: SoundImportDecl[];
  readonly aliases: Set<string>;
  readonly params: Record<string, ParamEntry>;
  readonly outputs: SoundOutputRaw[];
  readonly previews: SoundPreviewRaw[];
  readonly voices: SoundNamedDecl[];
  readonly sequences: SoundNamedDecl[];
  readonly body: Record<string, unknown>;
  seenNonImport: boolean;
}

const VOICE_TYPES: Record<string, string> = {
  noise: 'noise',
  osc: 'osc',
  fm: 'fm',
  vocal: 'vocal',
  chirp: 'chirp',
  material: 'material',
  modal_plate: 'material',
  granular: 'granular',
  whoosh: 'whoosh',
  aero_whoosh: 'whoosh',
  waveguide: 'waveguide',
};

const checkExportScope = (cursor: SoundCursor, exported: boolean, draft: SoundUnitDraft): void => {
  if (exported && draft.kind !== 'module') cursor.fail('export applies only inside module');
  if (draft.kind === 'module' && !exported) cursor.fail('module declarations must be exported');
};

const parseVoiceDecl = (cursor: SoundCursor, exported: boolean, draft: SoundUnitDraft): void => {
  checkExportScope(cursor, exported, draft);
  const id = cursor.name();
  if (!cursor.tryTake(':'))
    cursor.fail('sound.legacy-syntax: voice requires ": <type>" in ashfox 1');
  const rawType = cursor.name();
  if (rawType === 'resonator') cursor.fail('sound.legacy-source: resonator is removed');
  const sourceKind = VOICE_TYPES[rawType] ?? cursor.fail(`unknown voice source type "${rawType}"`);
  if (draft.voices.some((d) => d.id === id)) cursor.fail(`duplicate voice ${id}`);
  draft.voices.push({
    exported,
    id,
    value: parseVoiceBlock(cursor, `voice.${id}`, sourceKind, rawType),
  });
};

const parseSeqNamed = (cursor: SoundCursor, exported: boolean, draft: SoundUnitDraft): void => {
  checkExportScope(cursor, exported, draft);
  const id = cursor.name();
  if (draft.sequences.some((d) => d.id === id)) cursor.fail(`duplicate seq ${id}`);
  draft.sequences.push({ exported, id, value: parseSeqDecl(cursor, `sequence.${id}`) });
};

const LEGACY_TOP_KEYS = new Set(
  'voices sequences sequence output timeline oneshot sampleRate'.split(' '),
);
const BODY_BLOCKS: Record<string, readonly [string, (c: SoundCursor) => Record<string, unknown>]> =
  {
    space: ['space', (c) => parseKeyedBlock(c, SPACE_SPEC, 'space')],
    loop: ['playback', parseLoopBlock],
    master: ['output', (c) => ({ gainDb: 0, ...parseKeyedBlock(c, MASTER_SPEC, 'master') })],
  };
const ROOT_SCALARS: Record<string, UnitDim | 'enum' | 'playback'> = {
  profile: 'enum',
  duration: 'sec',
  sample_rate: 'hz',
  channels: 'raw',
  seed: 'raw',
  playback: 'playback',
};

const parseSoundScalar = (
  cursor: SoundCursor,
  first: string,
  keyOffset: number,
  draft: SoundUnitDraft,
): void => {
  const key = first,
    dim = ROOT_SCALARS[first]!;
  cursor.spans.set(`recipe.${key}`, keyOffset);
  if (Object.hasOwn(draft.body, key)) cursor.fail(`duplicate property ${first}`);
  cursor.take('=');
  if (dim === 'enum') draft.body[key] = parseEnumIdent(cursor);
  else if (dim === 'playback') {
    if (parseEnumIdent(cursor) !== 'oneshot')
      cursor.fail('playback accepts only oneshot; use loop { ... }');
    draft.body.playback = { kind: 'oneshot' };
  } else draft.body[key] = parseUnitScalar(cursor, dim);
  cursor.take(';');
};

const parseSoundBodyStmt = (
  cursor: SoundCursor,
  first: string,
  keyOffset: number,
  draft: SoundUnitDraft,
): void => {
  if (LEGACY_TOP_KEYS.has(first))
    cursor.fail(`sound.legacy-syntax: "${first}" is removed in ashfox 1`);
  if (first === 'outputs') draft.outputs.push(...parseOutputsDecl(cursor));
  else if (first === 'preview')
    draft.previews.push({
      name: cursor.peek() !== '{' ? cursor.name() : 'default',
      properties: parseAttrs(cursor),
    });
  else if (first === 'variants') {
    if (Object.hasOwn(draft.body, 'variants')) cursor.fail('duplicate variants');
    draft.body.variants = Object.entries(parseKeyedBlock(cursor, null, 'variants')).map(
      ([id, seed]) => ({ id, seed }),
    );
  } else if (first in BODY_BLOCKS) {
    const [field, fn] = BODY_BLOCKS[first]!;
    if (Object.hasOwn(draft.body, field)) cursor.fail(`duplicate ${first}`);
    draft.body[field] = fn(cursor);
  } else if (first in ROOT_SCALARS) parseSoundScalar(cursor, first, keyOffset, draft);
  else cursor.fail(`unknown recipe field "${first}"`);
};

const parseSoundImport = (cursor: SoundCursor, draft: SoundUnitDraft): void => {
  if (draft.seenNonImport) cursor.fail('imports must appear at top of block');
  const p = cursor.stringLiteral();
  if (cursor.name() !== 'as') cursor.fail('expected as after import path');
  const alias = cursor.name(),
    params = cursor.peek() === '{' ? parseParamBlock(cursor, false) : undefined;
  if (params) cursor.tryTake(';');
  else cursor.take(';');
  if (draft.aliases.has(alias)) cursor.fail(`duplicate import alias ${alias}`);
  draft.aliases.add(alias);
  draft.imports.push({ path: p, alias, ...(params ? { params } : {}) });
};

const parseUnitStatement = (
  cursor: SoundCursor,
  draft: SoundUnitDraft & { readonly hookAliases: Set<string> },
): void => {
  cursor.space();
  const keyOffset = cursor.offset,
    first = cursor.name();
  if (first === 'import') {
    parseSoundImport(cursor, draft);
    return;
  }
  draft.seenNonImport = true;
  if (first === 'params') Object.assign(draft.params, parseParamBlock(cursor));
  else if (first === 'voice') parseVoiceDecl(cursor, false, draft);
  else if (first === 'seq') parseSeqNamed(cursor, false, draft);
  else if (HOOK_DECL_KEYWORDS.has(first)) skipHookDeclaration(cursor, draft.hookAliases);
  else if (first === 'export') {
    const k = cursor.name();
    if (k === 'voice') parseVoiceDecl(cursor, true, draft);
    else if (k === 'seq') parseSeqNamed(cursor, true, draft);
    else if (k === 'schema') skipHookDeclaration(cursor, draft.hookAliases);
    else cursor.fail('expected voice, seq, or schema after export');
  } else if (draft.kind === 'module')
    cursor.fail('module allows only import, params, and export voice/seq/schema');
  else parseSoundBodyStmt(cursor, first, keyOffset, draft);
};

export const resolveSoundParams = resolveParamValue;
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

export const parseSoundUnit = (source: string, file = 'sound.ashfox'): SoundSourceUnit => {
  if (encodeUtf8(source).length > 262144) throw new Error(`${file}: sound source exceeds 256 KiB`);
  const cursor = new SoundCursor(source, file),
    hdr = /^(?:ashfox-model|ashfox-vfx)\b/.exec(
      cursor.source.slice((cursor.space(), cursor.offset)),
    )?.[0];
  if (hdr) cursor.fail(`sound.legacy-syntax: "${hdr} 1" header removed in ashfox 1`);
  for (const tok of ['ashfox', '1']) {
    cursor.take(tok);
    if (!/^(?:\s|\/\/|\/\*)/u.test(source.slice(cursor.offset))) cursor.fail('expected whitespace');
  }
  const rawKind = cursor.name();
  if (rawKind !== 'sound' && rawKind !== 'module') cursor.fail('expected sound or module');
  cursor.space();
  cursor.spans.set('recipe.id', cursor.offset);
  const draft: SoundUnitDraft & { readonly hookAliases: Set<string> } = {
    kind: rawKind === 'module' ? 'module' : 'sound',
    imports: [],
    aliases: new Set(),
    hookAliases: new Set(),
    params: Object.create(null),
    outputs: [],
    previews: [],
    voices: [],
    sequences: [],
    body: Object.create(null),
    seenNonImport: false,
  };
  const id = cursor.name();
  cursor.take('{');
  while (cursor.peek() !== '}') parseUnitStatement(cursor, draft);
  cursor.take('}');
  if (cursor.peek() !== '') cursor.fail('unexpected trailing source');
  return {
    ...draft,
    hookAliases: [...draft.hookAliases],
    id,
    report: (e: unknown) => cursor.report(e),
  };
};

export const parseSoundDocument = (source: string, file = 'sound.ashfox') => {
  const unit = parseSoundUnit(source, file);
  if (unit.kind !== 'sound') throw new Error(`${file}: expected sound declaration`);
  if (unit.imports.length > 0) throw new Error(`${file}: imports require directory compilation`);
  try {
    const voices = unit.voices.map((v) => ({ ...v.value, id: v.id })),
      sequences = unit.sequences.map((s) => ({ ...s.value, id: s.id }));
    const raw = applySoundDefaults(
      { ...unit.body, id: unit.id, voices, sequences },
      unit.params,
      (m) => {
        throw new Error(m);
      },
    );
    return { recipe: readRecipe(raw), report: unit.report };
  } catch (error) {
    return unit.report(error);
  }
};

export const parseSoundSource = (source: string, file = 'sound.ashfox'): SoundRecipe =>
  parseSoundDocument(source, file).recipe;
