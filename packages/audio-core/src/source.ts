import { encodeUtf8 } from '@ashfox/internal-contracts';
import { readRecipe } from './read';
import { SoundError } from './validate';
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

class SoundCursor {
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
      const matched = /^(?:\s+|\/\/[^\n]*(?:\n|$))/.exec(this.source.slice(this.offset));
      if (!matched) return;
      this.offset += matched[0].length;
    }
  }

  peek(): string {
    this.space();
    return this.source[this.offset] ?? '';
  }

  take(text: string): void {
    this.space();
    if (!this.source.startsWith(text, this.offset)) this.fail(`expected ${text}`);
    this.offset += text.length;
    if (++this.count > 12000) this.fail('token budget exceeded');
  }

  name(): string {
    this.space();
    const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(this.source.slice(this.offset));
    if (!match) return this.fail('expected identifier');
    this.take(match[0]);
    return match[0];
  }

  stringLiteral(): string {
    this.space();
    const rest = this.source.slice(this.offset);
    const matched = /^"(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/.exec(rest);
    if (!matched) return this.fail('expected JSON string literal');
    this.take(matched[0]);
    return JSON.parse(matched[0]) as string;
  }

  dotted(): string {
    let result = this.name();
    while (this.peek() === '.') {
      this.take('.');
      result += '.' + this.name();
    }
    return result;
  }

  report(error: unknown): never {
    if (error instanceof SoundError) {
      let path = error.path;
      while (!this.spans.has(path) && path.includes('.'))
        path = path.slice(0, path.lastIndexOf('.'));
      this.offset = this.spans.get(path) ?? 0;
    }
    return this.fail(error instanceof Error ? error.message : 'invalid sound');
  }
}

const parseScalarOrIdent = (cursor: SoundCursor): unknown => {
  const next = cursor.peek();
  if (next === '"') return cursor.stringLiteral();
  const rest = cursor.source.slice(cursor.offset);
  const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
  if (number) {
    cursor.take(number[0]);
    return Number(number[0]);
  }
  const word = cursor.dotted();
  if (word === 'true') return true;
  if (word === 'false') return false;
  return word;
};

const parseSoundValue = (cursor: SoundCursor, depth: number, path: string): unknown => {
  cursor.space();
  cursor.spans.set(path, cursor.offset);
  if (depth > 16) cursor.fail('nesting exceeds 16');
  const next = cursor.peek();
  if (next === '{') return parseSoundBlock(cursor, depth + 1, path);
  if (next === '[') {
    cursor.take('[');
    const values: unknown[] = [];
    while (cursor.peek() !== ']') {
      values.push(parseSoundValue(cursor, depth + 1, `${path}[${values.length}]`));
      if (cursor.peek() !== ']') cursor.take(',');
    }
    cursor.take(']');
    return values;
  }
  if (next === '"') return cursor.stringLiteral();
  const rest = cursor.source.slice(cursor.offset);
  const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
  if (number) {
    cursor.take(number[0]);
    return Number(number[0]);
  }
  if (/^[a-zA-Z_]/.test(next)) {
    const word = cursor.dotted();
    if (word === 'true') return true;
    if (word === 'false') return false;
    return { $ref: word };
  }
  return cursor.fail('expected literal value');
};

const parseSoundBlock = (
  cursor: SoundCursor,
  depth: number,
  path: string,
): Record<string, unknown> => {
  if (depth > 16) cursor.fail('nesting exceeds 16');
  cursor.take('{');
  const result: Record<string, unknown> = Object.create(null);
  while (cursor.peek() !== '}') {
    cursor.space();
    const keyOffset = cursor.offset;
    const key = cursor.name();
    cursor.spans.set(`${path}.${key}`, keyOffset);
    if (Object.prototype.hasOwnProperty.call(result, key)) cursor.fail(`duplicate property ${key}`);
    cursor.take('=');
    result[key] = parseSoundValue(cursor, depth + 1, `${path}.${key}`);
    cursor.take(';');
  }
  cursor.take('}');
  return result;
};

const parseOutputsClause = (cursor: SoundCursor): SoundOutputRaw[] => {
  cursor.take('{');
  const out: SoundOutputRaw[] = [];
  while (cursor.peek() !== '}') {
    const format = cursor.name();
    const attributes: Record<string, unknown> = {};
    while (cursor.peek() !== ';') {
      const key = cursor.name();
      cursor.take('=');
      attributes[key] = parseScalarOrIdent(cursor);
    }
    cursor.take(';');
    out.push({ format, attributes });
  }
  cursor.take('}');
  return out;
};

const parsePreviewClause = (cursor: SoundCursor): SoundPreviewRaw => {
  let name = 'default';
  if (cursor.peek() !== '{') name = cursor.name();
  cursor.take('{');
  const properties: Record<string, unknown> = {};
  while (cursor.peek() !== '}') {
    const key = cursor.name();
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      cursor.fail(`duplicate preview field ${key}`);
    }
    cursor.take('=');
    properties[key] = parseScalarOrIdent(cursor);
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
  readonly body: Record<string, unknown>;
}

const parseNamedDecl = (
  cursor: SoundCursor,
  exported: boolean,
  declKind: 'voice' | 'sequence',
  draft: SoundUnitDraft,
): void => {
  if (exported && draft.kind !== 'module') cursor.fail('export applies only inside module');
  if (draft.kind === 'module' && !exported) cursor.fail('module declarations must be exported');
  const id = cursor.name();
  const list = declKind === 'voice' ? draft.voices : draft.sequences;
  if (list.some((d) => d.id === id)) cursor.fail(`duplicate ${declKind} ${id}`);
  cursor.take('=');
  const value = parseSoundBlock(cursor, 0, `${declKind}.${id}`);
  cursor.take(';');
  list.push({ exported, id, value });
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
  if (first === 'import') {
    parseSoundImport(cursor, draft);
    return;
  }
  if (first === 'export') {
    const declKind = cursor.name();
    if (declKind !== 'voice' && declKind !== 'sequence') {
      cursor.fail('expected voice or sequence after export');
    }
    parseNamedDecl(cursor, true, declKind, draft);
    return;
  }
  if (first === 'voice' || first === 'sequence') {
    parseNamedDecl(cursor, false, first, draft);
    return;
  }
  if (draft.kind === 'module') cursor.fail('module allows only import and export voice/sequence');
  if (first === 'outputs') {
    draft.outputs.push(...parseOutputsClause(cursor));
    return;
  }
  if (first === 'preview') {
    draft.previews.push(parsePreviewClause(cursor));
    return;
  }
  cursor.spans.set(`recipe.${first}`, keyOffset);
  if (Object.prototype.hasOwnProperty.call(draft.body, first)) {
    cursor.fail(`duplicate property ${first}`);
  }
  cursor.take('=');
  draft.body[first] = parseSoundValue(cursor, 0, `recipe.${first}`);
  cursor.take(';');
};

export const parseSoundUnit = (source: string, file = 'sound.ashfox'): SoundSourceUnit => {
  if (encodeUtf8(source).length > 262144) {
    throw new Error(`${file}: sound source exceeds 256 KiB`);
  }
  const cursor = new SoundCursor(source, file);
  cursor.take('ashfox-model');
  if (!/^(?:\s|\/\/)/u.test(source.slice(cursor.offset))) cursor.fail('expected whitespace');
  cursor.take('1');
  if (!/^(?:\s|\/\/)/u.test(source.slice(cursor.offset))) cursor.fail('expected whitespace');
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
    body: Object.create(null),
  };
  cursor.take('{');
  while (cursor.peek() !== '}') parseUnitStatement(cursor, draft);
  cursor.take('}');
  if (cursor.peek() !== '') cursor.fail('unexpected trailing source');
  for (const key of ['format', 'version', 'id']) {
    if (!Object.prototype.hasOwnProperty.call(draft.body, key)) continue;
    cursor.offset = cursor.spans.get(`recipe.${key}`) ?? 0;
    cursor.fail(
      `sound.invalid: recipe.${key}: declaration owns identity; obsolete recipe fields are forbidden`,
    );
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

/** Bounded native sound literals. No evaluation, imports, or legacy JSON reader. */
export const parseSoundDocument = (source: string, file = 'sound.ashfox') => {
  const unit = parseSoundUnit(source, file);
  if (unit.kind !== 'sound') throw new Error(`${file}: expected sound declaration`);
  if (unit.imports.length || unit.voices.length || unit.sequences.length) {
    throw new Error(`${file}: imports/voice/sequence declarations require directory compilation`);
  }
  try {
    return { recipe: readRecipe({ ...unit.body, id: unit.id }), report: unit.report };
  } catch (error) {
    return unit.report(error);
  }
};

export const parseSoundSource = (source: string, file = 'sound.ashfox'): SoundRecipe =>
  parseSoundDocument(source, file).recipe;
