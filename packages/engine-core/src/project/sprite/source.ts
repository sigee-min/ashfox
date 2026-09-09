import { lexProgramSource, type ProgramToken } from '../program/syntax/lex';
import { assertWellFormedSourceText } from '../workspace/path';
import { deepFreeze } from '../../immutable';
import { SpriteInputError } from './contract';

export interface SpriteSourceUnit {
  readonly kind: 'sprite' | 'module'; readonly id: string;
  readonly imports: readonly { readonly path: string; readonly alias: string }[];
  readonly masks: readonly Record<string, unknown>[];
  readonly materials: readonly Record<string, unknown>[];
  readonly stamps: readonly Record<string, unknown>[];
  readonly item: Readonly<Record<string, unknown>> | null;
}
/** Native .ashfox syntax, sharing the model language's lexer and literal spelling. */
export const parseSpriteSource = (source: string, file: string): SpriteSourceUnit => {
  assertWellFormedSourceText(source);
  const lexical = lexProgramSource(source);
  let offset = 0;
  const peek = (): ProgramToken => lexical.tokens[offset]!;
  const fail = (expected: string): never => {
    const t = peek();
    throw new SpriteInputError({ code: 'sprite.syntax', file,
      pointer: `line:${t.span.start.line}:${t.span.start.column}`, expected, actual: t.value || 'EOF' });
  };
  if (lexical.diagnostics.length || lexical.tokens.length > 12000) fail('valid .ashfox tokens within budget');
  const take = (value?: string): ProgramToken => {
    const t = peek(); if (value !== undefined && t.value !== value) fail(value);
    if (t.kind === 'eof') fail(value ?? 'token'); offset += 1; return t;
  };
  const name = (): string => {
    if (peek().kind !== 'identifier' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(peek().value)) fail('identifier');
    return take().value;
  };
  const value = (depth = 0, pixels = false): unknown => {
    if (depth > 16) fail('nesting <= 16');
    if (peek().value === '{') return block(depth + 1);
    if (['(', '['].includes(peek().value)) {
      const end = take().value === '(' ? ')' : ']'; const values: unknown[] = [];
      while (peek().value !== end) {
        values.push(value(depth + 1, pixels)); if (peek().value !== end) take(',');
      }
      take(end); return values;
    }
    const t = take();
    if (t.kind === 'number') {
      if (!(pixels ? /^\d+(?:px)?$/ : /^\d+$/).test(t.value)) fail(pixels ? 'integer pixel literal' : 'unitless integer');
      return Number.parseInt(t.value, 10);
    }
    if (t.kind === 'string' || t.kind === 'color') return t.value;
    if (t.kind === 'identifier') {
      let result = t.value;
      while (peek().value === '.') { take('.'); result += '.' + name(); }
      return result;
    }
    return fail('literal');
  };
  const block = (depth = 0): Record<string, unknown> => {
    if (depth > 16) fail('nesting <= 16');
    take('{'); const record: Record<string, unknown> = {};
    while (peek().value !== '}') {
      const key = name();
      if (Object.hasOwnProperty.call(record, key)) fail('unique property ' + key);
      if (peek().value === '=') { take('='); record[key] = value(0, ['at','canvas','axis'].includes(key)); take(';'); }
      else record[key] = block(depth + 1);
    }
    take('}'); return record;
  };
  take('ashfox-model'); take('1');
  const kind = take().value;
  if (kind !== 'sprite' && kind !== 'module') fail('sprite or module');
  const id = name(); take('{');
  const imports: { path: string; alias: string }[] = [], masks: Record<string, unknown>[] = [], materials: Record<string, unknown>[] = [], stamps: Record<string, unknown>[] = [];
  const item: Record<string, unknown> = { id, layers: [] };
  const aliases = new Set<string>();
  while (peek().value !== '}') {
    const exported = peek().value === 'export'; if (exported) take('export');
    const key = name();
    if (key === 'import') {
      if (exported || peek().kind !== 'string') fail('import "relative.ashfox" as alias;');
      const path = take().value; take('as'); const alias = name(); take(';');
      if (aliases.has(alias)) fail('unique import alias'); aliases.add(alias); imports.push({ path, alias }); continue;
    }
    if (['mask','material','stamp'].includes(key) && (kind === 'module' || exported)) {
      if (!exported) fail('exported module declaration');
      const declarationId = name(), record = block();
      if (Object.hasOwnProperty.call(record, 'id')) fail('declaration-owned id');
      const declaration = { id: declarationId, ...record };
      (key === 'mask' ? masks : key === 'material' ? materials : stamps).push(declaration);
      continue;
    }
    if (exported || kind === 'module') fail('export mask/material/stamp declaration');
    if (['part','paint','erase','stamp'].includes(key)) {
      const layerId = name(), record = block();
      if ('id' in record || 'op' in record) fail('declaration-owned layer id and op');
      (item.layers as unknown[]).push({ id: layerId, op: key, ...record });
    } else {
      if (Object.hasOwnProperty.call(item, key)) fail('unique sprite property');
      if (peek().value === '=') { take('='); item[key] = value(0, ['at','canvas','axis'].includes(key)); take(';'); }
      else item[key] = block();
    }
  }
  take('}'); if (peek().kind !== 'eof') fail('end of file');
  return deepFreeze({ kind: kind as 'sprite' | 'module', id, imports, masks, materials, stamps, item: kind === 'sprite' ? item : null });
};
