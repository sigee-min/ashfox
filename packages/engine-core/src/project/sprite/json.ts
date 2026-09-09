import { SpriteInputError } from './contract';

/** Check depth and duplicate decoded keys before native JSON parsing loses them. */
export const parseSpriteJson = (source: string, file: string): unknown => {
  const fail = (pointer: string, expected: string, actual: string): never => {
    throw new SpriteInputError({ code: 'sprite.json', file, pointer, expected, actual });
  };
  if (new TextEncoder().encode(source).length > 262144) fail('', 'source <= 256 KiB', 'oversized source');
  let offset = 0;
  const space = (): void => { while (/\s/u.test(source[offset] ?? '') && offset < source.length) offset += 1; };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      const character = source[offset++];
      if (character === '\\') offset += 1;
      else if (character === '"') return JSON.parse(source.slice(start, offset)) as string;
    }
    return fail('', 'closed JSON string', 'end of source');
  };
  const scan = (depth: number, pointer: string): void => {
    if (depth > 16) fail(pointer, 'depth <= 16', String(depth));
    space();
    const kind = source[offset];
    if (kind === '"') { string(); return; }
    if (kind !== '{' && kind !== '[') {
      const start = offset;
      while (offset < source.length && !/[\s,\]}]/u.test(source[offset]!)) offset += 1;
      if (offset === start) fail(pointer, 'JSON value', source[offset] ?? 'EOF');
      return;
    }
    offset += 1;
    const end = kind === '{' ? '}' : ']';
    const keys = new Set<string>();
    let index = 0;
    space();
    if (source[offset] === end) { offset += 1; return; }
    while (offset < source.length) {
      space();
      let key = String(index++);
      if (kind === '{') {
        if (source[offset] !== '"') fail(pointer, 'quoted key', source[offset] ?? 'EOF');
        key = string();
        if (keys.has(key)) fail(pointer, 'unique keys', key);
        keys.add(key); space();
        if (source[offset++] !== ':') fail(pointer, 'colon', 'invalid object');
      }
      scan(depth + 1, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      space();
      if (source[offset] === end) { offset += 1; return; }
      if (source[offset++] !== ',') fail(pointer, 'comma', 'invalid container');
    }
    fail(pointer, end, 'EOF');
  };
  try { scan(0, ''); return JSON.parse(source) as unknown; }
  catch (error) {
    if (error instanceof SpriteInputError) throw error;
    return fail('', 'valid JSON', error instanceof Error ? error.message : 'parse failure');
  }
};
