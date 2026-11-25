import { readRecipe } from './read';
import { SoundError } from './validate';
import type { SoundRecipe } from './contract';

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
  const rest = cursor.source.slice(cursor.offset);
  if (next === '"') {
    const matched = /^"(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/.exec(rest);
    if (!matched) return cursor.fail('expected JSON string literal');
    cursor.take(matched[0]);
    return JSON.parse(matched[0]) as unknown;
  }
  const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
  if (number) {
    cursor.take(number[0]);
    return Number(number[0]);
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

/** Bounded native sound literals. No evaluation, imports, or legacy JSON reader. */
export const parseSoundDocument = (source: string, file = 'sound.ashfox') => {
  if (new TextEncoder().encode(source).length > 262144)
    throw new Error(`${file}: sound source exceeds 256 KiB`);
  const cursor = new SoundCursor(source, file);
  cursor.take('ashfox-model');
  if (!/^(?:\s|\/\/)/u.test(source.slice(cursor.offset)))
    cursor.fail('expected whitespace after header');
  cursor.take('1');
  if (!/^(?:\s|\/\/)/u.test(source.slice(cursor.offset)))
    cursor.fail('expected whitespace after version');
  if (cursor.name() !== 'sound') cursor.fail('expected sound declaration');
  cursor.space();
  cursor.spans.set('recipe.id', cursor.offset);
  const id = cursor.name();
  const body = parseSoundBlock(cursor, 0, 'recipe');
  if (cursor.peek() !== '') cursor.fail('unexpected trailing source');
  for (const key of ['format', 'version', 'id']) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    cursor.offset = cursor.spans.get(`recipe.${key}`) ?? 0;
    cursor.fail(
      `sound.invalid: recipe.${key}: declaration owns identity; obsolete recipe fields are forbidden`,
    );
  }
  try {
    return { recipe: readRecipe({ ...body, id }), report: (e: unknown) => cursor.report(e) };
  } catch (error) {
    return cursor.report(error);
  }
};
export const parseSoundSource = (source: string, file = 'sound.ashfox'): SoundRecipe =>
  parseSoundDocument(source, file).recipe;
