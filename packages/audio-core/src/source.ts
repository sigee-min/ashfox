import { encodeUtf8 } from '@ashfox/internal-contracts';
import { SoundCursor, parseAtom, parseExpr } from './parseCursor';
import {
  lowerBlockProps,
  lowerLoopBlock,
  lowerMasterBlock,
  lowerSeqBlock,
  lowerSpaceBlock,
  lowerSubBlock,
  lowerVoiceBlock,
  type ParsedBlockItem,
} from './parseLower';
import { readRecipe } from './read';
import type { SoundRecipe } from './contract';

export interface SoundImportDecl {
  readonly path: string;
  readonly alias: string;
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
  readonly outputs: readonly SoundOutputRaw[];
  readonly previews: readonly SoundPreviewRaw[];
  readonly voices: readonly SoundNamedDecl[];
  readonly sequences: readonly SoundNamedDecl[];
  readonly body: Readonly<Record<string, unknown>>;
  readonly report: (error: unknown) => never;
}

const SNAKE_KEY_RE = /^[a-z][a-z0-9_]*$/;

const readBlockItems = (
  cursor: SoundCursor,
  depth: number,
  path: string,
  fail: (m: string) => never,
): ParsedBlockItem[] => {
  if (depth > 16) cursor.fail('nesting exceeds 16');
  cursor.take('{');
  const items: ParsedBlockItem[] = [];
  while (cursor.peek() !== '}') {
    cursor.space();
    const keyOffset = cursor.offset;
    const key = cursor.keyName();
    cursor.spans.set(`${path}.${key}`, keyOffset);
    if (cursor.peek() === '=') {
      cursor.take('=');
      const val = parseExpr(cursor, depth + 1, key, false);
      cursor.take(';');
      items.push({ kind: 'prop', key, tag: null, value: val });
      continue;
    }
    const tag = cursor.peek() === '{' ? null : cursor.name();
    const subItems = readBlockItems(cursor, depth + 1, `${path}.${key}`, fail);
    const val = key === 'step' ? subItems : lowerSubBlock(key, tag, subItems, fail);
    items.push({ kind: 'block', key, tag, value: val });
  }
  cursor.take('}');
  return items;
};

const parseOutputsList = (cursor: SoundCursor): SoundOutputRaw[] => {
  cursor.take('=');
  cursor.take('[');
  const out: SoundOutputRaw[] = [];
  while (cursor.peek() !== ']') {
    out.push({ format: cursor.name(), attributes: {} });
    if (cursor.peek() === ',') cursor.take(',');
    else break;
  }
  cursor.take(']');
  cursor.take(';');
  return out;
};

const parseOutputsBlock = (cursor: SoundCursor): SoundOutputRaw[] => {
  if (cursor.peek() === '=') return parseOutputsList(cursor);
  cursor.take('{');
  const out: SoundOutputRaw[] = [];
  while (cursor.peek() !== '}') {
    const format = cursor.name();
    const attributes: Record<string, unknown> = {};
    while (cursor.peek() !== ';') {
      const key = cursor.keyName();
      cursor.take('=');
      attributes[key] = parseAtom(cursor, key, false);
    }
    cursor.take(';');
    out.push({ format, attributes });
  }
  cursor.take('}');
  return out;
};

const parsePreviewBlock = (cursor: SoundCursor): SoundPreviewRaw => {
  const name = cursor.peek() === '{' ? 'default' : cursor.name();
  cursor.take('{');
  const properties: Record<string, unknown> = {};
  while (cursor.peek() !== '}') {
    const key = cursor.keyName();
    if (Object.hasOwn(properties, key)) cursor.fail(`duplicate preview field ${key}`);
    cursor.take('=');
    properties[key] = parseAtom(cursor, key, false);
    cursor.take(';');
  }
  cursor.take('}');
  return { name, properties };
};

interface SoundUnitDraft {
  readonly kind: 'sound' | 'module';
  readonly imports: SoundImportDecl[];
  readonly aliases: Set<string>;
  readonly outputs: SoundOutputRaw[];
  readonly previews: SoundPreviewRaw[];
  readonly voices: SoundNamedDecl[];
  readonly sequences: SoundNamedDecl[];
  readonly localVoices: unknown[];
  readonly localSeqs: unknown[];
  readonly localVariants: unknown[];
  readonly body: Record<string, unknown>;
}

const parseVoiceOrSeqDecl = (
  cursor: SoundCursor,
  exported: boolean,
  declKind: 'voice' | 'seq',
  draft: SoundUnitDraft,
): void => {
  const fail = (m: string): never => cursor.fail(m);
  if (exported && draft.kind !== 'module') cursor.fail('export applies only inside module');
  if (draft.kind === 'module' && !exported) cursor.fail('module declarations must be exported');
  const id = cursor.name();
  let sourceKind: string | null = null;
  if (declKind === 'voice' && cursor.peek() === ':') {
    cursor.take(':');
    sourceKind = cursor.name();
  }
  const items = readBlockItems(cursor, 0, `${declKind}.${id}`, fail);
  const val =
    declKind === 'voice'
      ? lowerVoiceBlock(id, sourceKind, items, fail)
      : lowerSeqBlock(id, items, fail);
  if (exported) {
    const list = declKind === 'voice' ? draft.voices : draft.sequences;
    if (list.some((d) => d.id === id)) cursor.fail(`duplicate ${declKind} ${id}`);
    list.push({ exported, id, value: val });
    return;
  }
  (declKind === 'voice' ? draft.localVoices : draft.localSeqs).push(val);
};

const handleSoundBlockDecl = (
  first: string,
  cursor: SoundCursor,
  draft: SoundUnitDraft,
): boolean => {
  const fail = (m: string): never => cursor.fail(m);
  if (first === 'voice' || first === 'seq') {
    parseVoiceOrSeqDecl(cursor, false, first, draft);
    return true;
  }
  if (first === 'variant') {
    const id = cursor.name();
    const props = lowerBlockProps(readBlockItems(cursor, 0, `variant.${id}`, fail));
    draft.localVariants.push({ id, ...props });
    return true;
  }
  if (first === 'space' || first === 'master' || first === 'output' || first === 'loop') {
    const items = readBlockItems(cursor, 0, `recipe.${first}`, fail);
    if (first === 'space') draft.body.space = lowerSpaceBlock(items, fail);
    else if (first === 'loop') draft.body.playback = lowerLoopBlock(items, fail);
    else draft.body.output = lowerMasterBlock(items, fail);
    return true;
  }
  return false;
};

const parseSoundImport = (cursor: SoundCursor, draft: SoundUnitDraft): void => {
  const p = cursor.stringLiteral();
  if (cursor.name() !== 'as') cursor.fail('expected as after import path');
  const alias = cursor.name();
  cursor.take(';');
  if (draft.aliases.has(alias)) cursor.fail(`duplicate import alias ${alias}`);
  draft.aliases.add(alias);
  draft.imports.push({ path: p, alias });
};

const parseUnitStatement = (cursor: SoundCursor, draft: SoundUnitDraft): void => {
  cursor.space();
  const keyOffset = cursor.offset;
  const first = cursor.name();
  if (first === 'import') return parseSoundImport(cursor, draft);
  if (first === 'export') {
    const decl = cursor.name();
    if (decl !== 'voice' && decl !== 'seq') cursor.fail('expected voice or seq after export');
    return parseVoiceOrSeqDecl(cursor, true, decl, draft);
  }
  if (draft.kind === 'module') cursor.fail('module allows only import and export voice/seq');
  if (first === 'outputs') {
    draft.outputs.push(...parseOutputsBlock(cursor));
    return;
  }
  if (first === 'preview') {
    draft.previews.push(parsePreviewBlock(cursor));
    return;
  }
  if (first === 'use') {
    const ref = cursor.dotted();
    cursor.take(';');
    draft.localVoices.push({ $ref: ref });
    return;
  }
  if (handleSoundBlockDecl(first, cursor, draft)) return;
  if (!SNAKE_KEY_RE.test(first)) cursor.fail(`expected snake_case key, got ${first}`);
  cursor.spans.set(`recipe.${first}`, keyOffset);
  if (Object.hasOwn(draft.body, first)) cursor.fail(`duplicate property ${first}`);
  cursor.take('=');
  const val = parseExpr(cursor, 0, first, false);
  cursor.take(';');
  draft.body[first] = first === 'playback' && typeof val === 'string' ? { kind: val } : val;
};

const mergeSoundCollections = (draft: SoundUnitDraft, cursor: SoundCursor): void => {
  if (draft.localVoices.length > 0) {
    const existing = Array.isArray(draft.body.voices) ? (draft.body.voices as unknown[]) : [];
    draft.body.voices = [...existing, ...draft.localVoices];
  }
  if (draft.localSeqs.length > 0) {
    if ('sequences' in draft.body) cursor.fail('cannot mix seq blocks with sequences property');
    draft.body.sequences = draft.localSeqs;
  }
  if (draft.localVariants.length > 0) {
    if ('variants' in draft.body) cursor.fail('cannot mix variant blocks with variants property');
    draft.body.variants = draft.localVariants;
  } else if (
    draft.kind === 'sound' &&
    !('variants' in draft.body) &&
    typeof draft.body.seed === 'number'
  ) {
    draft.body.variants = [{ id: 'base', seed: draft.body.seed }];
  }
  if (draft.kind === 'sound' && !('playback' in draft.body)) {
    draft.body.playback = { kind: 'oneshot' };
  }
};

export const parseSoundUnit = (source: string, file = 'sound.ashfox'): SoundSourceUnit => {
  if (encodeUtf8(source).length > 262144) throw new Error(`${file}: sound source exceeds 256 KiB`);
  const cursor = new SoundCursor(source, file);
  cursor.take('ashfox');
  if (!/^(?:\s|\/\/|\/\*)/u.test(source.slice(cursor.offset))) cursor.fail('expected whitespace');
  cursor.take('1');
  if (!/^(?:\s|\/\/|\/\*)/u.test(source.slice(cursor.offset))) cursor.fail('expected whitespace');
  const rawKind = cursor.name();
  if (rawKind !== 'sound' && rawKind !== 'module') cursor.fail('expected sound or module');
  const unitKind: 'sound' | 'module' = rawKind === 'module' ? 'module' : 'sound';
  cursor.space();
  cursor.spans.set('recipe.id', cursor.offset);
  const id = cursor.name();
  const draft: SoundUnitDraft = {
    kind: unitKind,
    imports: [],
    aliases: new Set(),
    outputs: [],
    previews: [],
    voices: [],
    sequences: [],
    localVoices: [],
    localSeqs: [],
    localVariants: [],
    body: Object.create(null),
  };
  cursor.take('{');
  while (cursor.peek() !== '}') parseUnitStatement(cursor, draft);
  cursor.take('}');
  if (cursor.peek() !== '') cursor.fail('unexpected trailing source');
  mergeSoundCollections(draft, cursor);
  for (const key of ['format', 'version', 'id']) {
    if (!Object.hasOwn(draft.body, key)) continue;
    cursor.offset = cursor.spans.get(`recipe.${key}`) ?? 0;
    cursor.fail(`sound.invalid: recipe.${key}: declaration owns identity`);
  }
  return {
    kind: unitKind,
    id,
    imports: draft.imports,
    outputs: draft.outputs,
    previews: draft.previews,
    voices: draft.voices,
    sequences: draft.sequences,
    body: draft.body,
    report: (e: unknown) => cursor.report(e),
  };
};

export const parseSoundDocument = (source: string, file = 'sound.ashfox') => {
  const unit = parseSoundUnit(source, file);
  if (unit.kind !== 'sound') throw new Error(`${file}: expected sound declaration`);
  if (unit.imports.length || unit.voices.length || unit.sequences.length) {
    throw new Error(`${file}: imports/voice/seq declarations require directory compilation`);
  }
  try {
    return { recipe: readRecipe({ ...unit.body, id: unit.id }), report: unit.report };
  } catch (error) {
    return unit.report(error);
  }
};

export const parseSoundSource = (source: string, file = 'sound.ashfox'): SoundRecipe =>
  parseSoundDocument(source, file).recipe;
