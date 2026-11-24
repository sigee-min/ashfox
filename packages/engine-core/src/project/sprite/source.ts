import { lexProgramSource, type ProgramToken } from '../program/syntax/lex';
import { assertWellFormedSourceText } from '../workspace/path';
import { deepFreeze } from '../../immutable';
import { SpriteInputError } from './contract';

export interface SpriteSourceUnit {
  readonly kind: 'sprite' | 'module';
  readonly id: string;
  readonly imports: readonly { readonly path: string; readonly alias: string }[];
  readonly masks: readonly Record<string, unknown>[];
  readonly materials: readonly Record<string, unknown>[];
  readonly stamps: readonly Record<string, unknown>[];
  readonly item: Readonly<Record<string, unknown>> | null;
}

interface SourceCursor {
  readonly tokens: readonly ProgramToken[];
  readonly file: string;
  offset: number;
}

interface ParsedMembers {
  readonly kind: 'sprite' | 'module';
  readonly imports: { path: string; alias: string }[];
  readonly masks: Record<string, unknown>[];
  readonly materials: Record<string, unknown>[];
  readonly stamps: Record<string, unknown>[];
  readonly item: Record<string, unknown>;
  readonly aliases: Set<string>;
}

const peek = (cursor: SourceCursor): ProgramToken => cursor.tokens[cursor.offset]!;

const failSyntax = (cursor: SourceCursor, expected: string): never => {
  const token = peek(cursor);
  throw new SpriteInputError({
    code: 'sprite.syntax',
    file: cursor.file,
    pointer: `line:${token.span.start.line}:${token.span.start.column}`,
    expected,
    actual: token.value || 'EOF',
  });
};

const take = (cursor: SourceCursor, value?: string): ProgramToken => {
  const token = peek(cursor);
  if (value !== undefined && token.value !== value) failSyntax(cursor, value);
  if (token.kind === 'eof') failSyntax(cursor, value ?? 'token');
  cursor.offset += 1;
  return token;
};

const readName = (cursor: SourceCursor): string => {
  const token = peek(cursor);
  if (token.kind !== 'identifier' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token.value)) {
    failSyntax(cursor, 'identifier');
  }
  return take(cursor).value;
};

const readAtom = (cursor: SourceCursor, token: ProgramToken, pixels: boolean): unknown => {
  if (token.kind === 'number') {
    if (!(pixels ? /^\d+(?:px)?$/ : /^\d+$/).test(token.value)) {
      failSyntax(cursor, pixels ? 'integer pixel literal' : 'unitless integer');
    }
    return Number.parseInt(token.value, 10);
  }
  if (token.kind === 'string' || token.kind === 'color') return token.value;
  if (token.kind === 'identifier') {
    let result = token.value;
    while (peek(cursor).value === '.') {
      take(cursor, '.');
      result += '.' + readName(cursor);
    }
    return result;
  }
  return failSyntax(cursor, 'literal');
};

const readValue = (cursor: SourceCursor, depth = 0, pixels = false): unknown => {
  if (depth > 16) failSyntax(cursor, 'nesting <= 16');
  const next = peek(cursor).value;
  if (next === '{') return readBlock(cursor, depth + 1);
  if (next === '(' || next === '[') {
    const end = take(cursor).value === '(' ? ')' : ']';
    const values: unknown[] = [];
    while (peek(cursor).value !== end) {
      values.push(readValue(cursor, depth + 1, pixels));
      if (peek(cursor).value !== end) take(cursor, ',');
    }
    take(cursor, end);
    return values;
  }
  return readAtom(cursor, take(cursor), pixels);
};

const readBlock = (cursor: SourceCursor, depth = 0): Record<string, unknown> => {
  if (depth > 16) failSyntax(cursor, 'nesting <= 16');
  take(cursor, '{');
  const record: Record<string, unknown> = {};
  while (peek(cursor).value !== '}') {
    const key = readName(cursor);
    if (Object.hasOwnProperty.call(record, key)) failSyntax(cursor, 'unique property ' + key);
    if (peek(cursor).value === '=') {
      take(cursor, '=');
      record[key] = readValue(cursor, 0, ['at', 'canvas', 'axis'].includes(key));
      take(cursor, ';');
    } else record[key] = readBlock(cursor, depth + 1);
  }
  take(cursor, '}');
  return record;
};

const readImport = (cursor: SourceCursor, exported: boolean, members: ParsedMembers): void => {
  if (exported || peek(cursor).kind !== 'string')
    failSyntax(cursor, 'import "relative.ashfox" as alias;');
  const path = take(cursor).value;
  take(cursor, 'as');
  const alias = readName(cursor);
  take(cursor, ';');
  if (members.aliases.has(alias)) failSyntax(cursor, 'unique import alias');
  members.aliases.add(alias);
  members.imports.push({ path, alias });
};

const readExportedDeclaration = (
  cursor: SourceCursor,
  key: string,
  members: ParsedMembers,
): void => {
  const declarationId = readName(cursor);
  const record = readBlock(cursor);
  if (Object.hasOwnProperty.call(record, 'id')) failSyntax(cursor, 'declaration-owned id');
  const declaration = { id: declarationId, ...record };
  const target =
    key === 'mask' ? members.masks : key === 'material' ? members.materials : members.stamps;
  target.push(declaration);
};

const readSpriteMember = (
  cursor: SourceCursor,
  key: string,
  item: Record<string, unknown>,
): void => {
  if (['part', 'paint', 'erase', 'stamp'].includes(key)) {
    const layerId = readName(cursor);
    const record = readBlock(cursor);
    if ('id' in record || 'op' in record) failSyntax(cursor, 'declaration-owned layer id and op');
    (item.layers as unknown[]).push({ id: layerId, op: key, ...record });
    return;
  }
  if (Object.hasOwnProperty.call(item, key)) failSyntax(cursor, 'unique sprite property');
  if (peek(cursor).value === '=') {
    take(cursor, '=');
    item[key] = readValue(cursor, 0, ['at', 'canvas', 'axis'].includes(key));
    take(cursor, ';');
  } else item[key] = readBlock(cursor);
};

const readTopMember = (cursor: SourceCursor, members: ParsedMembers): void => {
  const exported = peek(cursor).value === 'export';
  if (exported) take(cursor, 'export');
  const key = readName(cursor);
  if (key === 'import') {
    readImport(cursor, exported, members);
    return;
  }
  if (['mask', 'material', 'stamp'].includes(key) && (members.kind === 'module' || exported)) {
    if (!exported) failSyntax(cursor, 'exported module declaration');
    readExportedDeclaration(cursor, key, members);
    return;
  }
  if (exported || members.kind === 'module')
    failSyntax(cursor, 'export mask/material/stamp declaration');
  readSpriteMember(cursor, key, members.item);
};

/** Native .ashfox syntax, sharing the model language's lexer and literal spelling. */
export const parseSpriteSource = (source: string, file: string): SpriteSourceUnit => {
  assertWellFormedSourceText(source);
  const lexical = lexProgramSource(source);
  const cursor: SourceCursor = { tokens: lexical.tokens, file, offset: 0 };
  if (lexical.diagnostics.length || lexical.tokens.length > 12000) {
    failSyntax(cursor, 'valid .ashfox tokens within budget');
  }
  take(cursor, 'ashfox-model');
  take(cursor, '1');
  const rawKind = take(cursor).value;
  if (rawKind !== 'sprite' && rawKind !== 'module') failSyntax(cursor, 'sprite or module');
  const kind: 'sprite' | 'module' = rawKind === 'sprite' ? 'sprite' : 'module';
  const id = readName(cursor);
  take(cursor, '{');
  const members: ParsedMembers = {
    kind,
    imports: [],
    masks: [],
    materials: [],
    stamps: [],
    item: { id, layers: [] },
    aliases: new Set<string>(),
  };
  while (peek(cursor).value !== '}') readTopMember(cursor, members);
  take(cursor, '}');
  if (peek(cursor).kind !== 'eof') failSyntax(cursor, 'end of file');
  return deepFreeze({
    kind,
    id,
    imports: members.imports,
    masks: members.masks,
    materials: members.materials,
    stamps: members.stamps,
    item: kind === 'sprite' ? members.item : null,
  });
};
