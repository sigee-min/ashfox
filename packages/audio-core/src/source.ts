import { readRecipe } from './read';
import type { SoundRecipe } from './contract';

/** Bounded native sound literals. No evaluation, imports, or legacy JSON reader. */
export const parseSoundSource = (source: string, file = 'sound.ashfox'): SoundRecipe => {
  if (new TextEncoder().encode(source).length > 262144) throw new Error(`${file}: sound source exceeds 256 KiB`);
  let offset = 0, count = 0;
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
  const value = (depth: number): unknown => {
    if (depth > 16) fail('nesting exceeds 16');
    const next = peek();
    if (next === '{') return block(depth + 1);
    if (next === '[' || next === '(') {
      take(next); const end = next === '[' ? ']' : ')', values: unknown[] = [];
      while (peek() !== end) {
        values.push(value(depth + 1)); if (peek() !== end) take(',');
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
    return name();
  };
  const block = (depth: number): Record<string, unknown> => {
    if (depth > 16) fail('nesting exceeds 16');
    take('{'); const result: Record<string, unknown> = Object.create(null);
    while (peek() !== '}') {
      const key = name(); if (Object.prototype.hasOwnProperty.call(result, key)) fail(`duplicate property ${key}`);
      if (peek() === '=') { take('='); result[key] = value(depth + 1); take(';'); }
      else result[key] = block(depth + 1);
    }
    take('}'); return result;
  };
  take('ashfox-model'); take('1');
  if (name() !== 'sound') fail('expected sound declaration');
  const id = name(), body = block(0);
  if (peek() !== '') fail('unexpected trailing source');
  if (['format', 'version', 'id'].some(key => Object.prototype.hasOwnProperty.call(body, key))) fail('declaration owns format/version/id');
  try { return readRecipe({ ...body, format: 'ashfox-sound', version: 1, id }); }
  catch (error) { return fail(error instanceof Error ? error.message : 'invalid sound'); }
};
