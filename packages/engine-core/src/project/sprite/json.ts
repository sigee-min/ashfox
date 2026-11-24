import { SpriteInputError } from './contract';

interface JsonScanState {
  readonly source: string;
  readonly file: string;
  offset: number;
}

const failJson = (file: string, pointer: string, expected: string, actual: string): never => {
  throw new SpriteInputError({ code: 'sprite.json', file, pointer, expected, actual });
};

const skipSpace = (state: JsonScanState): void => {
  while (state.offset < state.source.length && /\s/u.test(state.source[state.offset] ?? '')) {
    state.offset += 1;
  }
};

const scanString = (state: JsonScanState): string => {
  const start = state.offset++;
  while (state.offset < state.source.length) {
    const character = state.source[state.offset++];
    if (character === '\\') state.offset += 1;
    else if (character === '"')
      return JSON.parse(state.source.slice(start, state.offset)) as string;
  }
  return failJson(state.file, '', 'closed JSON string', 'end of source');
};

const scanPrimitive = (state: JsonScanState, pointer: string): void => {
  const start = state.offset;
  while (state.offset < state.source.length && !/[\s,\]}]/u.test(state.source[state.offset]!)) {
    state.offset += 1;
  }
  if (state.offset === start) {
    failJson(state.file, pointer, 'JSON value', state.source[state.offset] ?? 'EOF');
  }
};

const readObjectKey = (state: JsonScanState, pointer: string, keys: Set<string>): string => {
  if (state.source[state.offset] !== '"') {
    failJson(state.file, pointer, 'quoted key', state.source[state.offset] ?? 'EOF');
  }
  const key = scanString(state);
  if (keys.has(key)) failJson(state.file, pointer, 'unique keys', key);
  keys.add(key);
  skipSpace(state);
  if (state.source[state.offset++] !== ':')
    failJson(state.file, pointer, 'colon', 'invalid object');
  return key;
};

const scanContainer = (
  state: JsonScanState,
  kind: '{' | '[',
  depth: number,
  pointer: string,
): void => {
  state.offset += 1;
  const end = kind === '{' ? '}' : ']';
  const keys = new Set<string>();
  let index = 0;
  skipSpace(state);
  if (state.source[state.offset] === end) {
    state.offset += 1;
    return;
  }
  while (state.offset < state.source.length) {
    skipSpace(state);
    const key = kind === '{' ? readObjectKey(state, pointer, keys) : String(index++);
    scanValue(state, depth + 1, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    skipSpace(state);
    if (state.source[state.offset] === end) {
      state.offset += 1;
      return;
    }
    if (state.source[state.offset++] !== ',') {
      failJson(state.file, pointer, 'comma', 'invalid container');
    }
  }
  failJson(state.file, pointer, end, 'EOF');
};

const scanValue = (state: JsonScanState, depth: number, pointer: string): void => {
  if (depth > 16) failJson(state.file, pointer, 'depth <= 16', String(depth));
  skipSpace(state);
  const kind = state.source[state.offset];
  if (kind === '"') scanString(state);
  else if (kind === '{' || kind === '[') scanContainer(state, kind, depth, pointer);
  else scanPrimitive(state, pointer);
};

/** Check depth and duplicate decoded keys before native JSON parsing loses them. */
export const parseSpriteJson = (source: string, file: string): unknown => {
  if (new TextEncoder().encode(source).length > 262144) {
    failJson(file, '', 'source <= 256 KiB', 'oversized source');
  }
  const state: JsonScanState = { source, file, offset: 0 };
  try {
    scanValue(state, 0, '');
    return JSON.parse(source) as unknown;
  } catch (error) {
    if (error instanceof SpriteInputError) throw error;
    return failJson(
      file,
      '',
      'valid JSON',
      error instanceof Error ? error.message : 'parse failure',
    );
  }
};
