import { readRecipe } from './read';
import { SoundError } from './validate';
import type { SoundRecipe } from './contract';

/** Bounded native sound literals. No evaluation, imports, or legacy JSON reader. */
export const parseSoundDocument = (source: string, file = 'sound.ashfox') => {
  if (new TextEncoder().encode(source).length > 262144) throw new Error(`${file}: sound source exceeds 256 KiB`);
  let offset = 0, count = 0;
  const spans = new Map<string, number>();
  const fail = (message: string): never => {
    const before = source.slice(0, offset), lines = before.split('\n');
    throw new Error(`${file}:${lines.length}:${lines[lines.length - 1].length + 1}: ${message}`);
  };
  const space = (): void => {
    while (true) {
      const rest = source.slice(offset), matched = /^(?:\s+|\/\/[^\n]*(?:\n|$))/.exec(rest);
      if (!matched) return;
      offset += matched[0].length;
    }
  };
  const peek = (): string => { space(); return source[offset] ?? ''; };
  const take = (text: string): void => {
    space(); if (!source.startsWith(text, offset)) fail(`expected ${text}`);
    offset += text.length; if (++count > 12000) fail('token budget exceeded');
  };
  const name = (): string => {
    space(); const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(source.slice(offset));
    if (!match) return fail('expected identifier');
    take(match[0]); return match[0];
  };
  const value = (depth: number, path: string): unknown => {
    space(); spans.set(path, offset);
    if (depth > 16) fail('nesting exceeds 16');
    const next = peek();
    if (next === '{') return block(depth + 1, path);
    if (next === '[') {
      take(next); const end = ']', values: unknown[] = [];
      while (peek() !== end) {
        values.push(value(depth + 1, `${path}[${values.length}]`)); if (peek() !== end) take(',');
      }
      take(end); return values;
    }
    if (next === '"') {
      const matched = /^"(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/.exec(source.slice(offset));
      if (!matched) return fail('expected JSON string literal');
      take(matched[0]); return JSON.parse(matched[0]) as unknown;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
    if (number) { take(number[0]); return Number(number[0]); }
    return fail('expected literal value');
  };
  const block = (depth: number, path: string): Record<string, unknown> => {
    if (depth > 16) fail('nesting exceeds 16');
    take('{'); const result: Record<string, unknown> = Object.create(null);
    while (peek() !== '}') {
      space(); const keyOffset = offset, key = name(); spans.set(`${path}.${key}`, keyOffset); if (Object.prototype.hasOwnProperty.call(result, key)) fail(`duplicate property ${key}`);
      take('='); result[key] = value(depth + 1, `${path}.${key}`); take(';');
    }
    take('}'); return result;
  };
  take('ashfox-model'); if (!/^(?:\s|\/\/)/u.test(source.slice(offset))) fail('expected whitespace after header'); take('1');
  if (!/^(?:\s|\/\/)/u.test(source.slice(offset))) fail('expected whitespace after version');
  if (name() !== 'sound') fail('expected sound declaration');
  space(); spans.set('recipe.id', offset);
  const id = name(), body = block(0, 'recipe');
  if (peek() !== '') fail('unexpected trailing source');
  for (const key of ['format', 'version', 'id']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      offset = spans.get(`recipe.${key}`) ?? 0;
      fail(`sound.invalid: recipe.${key}: declaration owns identity; obsolete recipe fields are forbidden`);
    }
  }
  const report = (error: unknown): never => {
    if (error instanceof SoundError) {
      let path = error.path;
      while (!spans.has(path) && path.includes('.')) path = path.slice(0, path.lastIndexOf('.'));
      offset = spans.get(path) ?? 0;
    }
    return fail(error instanceof Error ? error.message : 'invalid sound');
  };
  try { return { recipe: readRecipe({ ...body, id }), report }; }
  catch (error) { return report(error); }
};
export const parseSoundSource = (source: string, file = 'sound.ashfox'): SoundRecipe => parseSoundDocument(source, file).recipe;
