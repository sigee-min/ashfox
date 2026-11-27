import { encodeUtf8 } from '@ashfox/internal-contracts';
import type { SoundRecipe } from './contract';
import { readRecipe } from './read';
import { soundDidYouMean } from './validate';
import { applySoundDefaults, parseParamBlock, resolveParamValue } from './soundParams';
import {
  SoundCursor,
  parseEnumIdent,
  parseKeyedBlock,
  parseUnitScalar,
  type ParamEntry,
  type UnitDim,
} from './sourceBlock';
import {
  parseLoopBlock,
  parseMasterBlock,
  parseSeqDecl,
  parseSpaceBlock,
  parseVoiceBlock,
} from './sourceVoice';
import { HOOK_DECL_KEYWORDS, skipHookDeclaration } from './hookSkip';

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
  const sourceKind =
    VOICE_TYPES[rawType] ??
    cursor.fail(
      `unknown voice source type "${rawType}"${soundDidYouMean(rawType, Object.keys(VOICE_TYPES))}`,
    );
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
    space: ['space', parseSpaceBlock],
    loop: ['playback', parseLoopBlock],
    master: ['output', parseMasterBlock],
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

const SOUND_BODY_KEYS = [
  'outputs',
  'preview',
  'variants',
  ...Object.keys(BODY_BLOCKS),
  ...Object.keys(ROOT_SCALARS),
];

const parseSoundBodyStmt = (
  cursor: SoundCursor,
  first: string,
  keyOffset: number,
  draft: SoundUnitDraft,
): void => {
  if (LEGACY_TOP_KEYS.has(first))
    cursor.fail(
      `sound.legacy-syntax: "${first}" is removed in ashfox 1${soundDidYouMean(first, SOUND_BODY_KEYS)}`,
    );
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
  else cursor.fail(`unknown recipe field "${first}"${soundDidYouMean(first, SOUND_BODY_KEYS)}`);
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

export { applySoundDefaults };
export const resolveSoundParams = resolveParamValue;

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
