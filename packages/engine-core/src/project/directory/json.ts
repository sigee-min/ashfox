import { encodeUtf8 } from '@ashfox/internal-contracts';
import { failWorkspaceConfig } from './validate';

interface JsonScanState {
  readonly source: string;
  readonly file: string;
  offset: number;
}

const failJson = (file: string, pointer: string, expected: string, actual: string): never =>
  failWorkspaceConfig(pointer || file, expected, actual);

const skipSpace = (state: JsonScanState): void => {
  while (state.offset < state.source.length && /\s/u.test(state.source[state.offset] ?? '')) {
    state.offset += 1;
  }
};

const scanString = (state: JsonScanState): string => {
  const start = state.offset++;
  while (state.offset < state.source.length) {
    const ch = state.source[state.offset++];
    if (ch === '\\') state.offset += 1;
    else if (ch === '"') return JSON.parse(state.source.slice(start, state.offset)) as string;
  }
  return failJson(state.file, '', 'closed JSON string', 'end of source');
};

const scanPrimitive = (state: JsonScanState, pointer: string): void => {
  const start = state.offset;
  while (state.offset < state.source.length && !/[\s,\]}]/u.test(state.source[state.offset]!)) {
    state.offset += 1;
  }
  if (state.offset === start)
    failJson(state.file, pointer, 'JSON value', state.source[state.offset] ?? 'EOF');
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
    if (state.source[state.offset++] !== ',')
      failJson(state.file, pointer, 'comma', 'invalid container');
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
export const parseDirectoryJson = (source: string, file: string): unknown => {
  if (encodeUtf8(source).length > 262144) {
    failJson(file, '', 'source <= 256 KiB', 'oversized source');
  }
  const state: JsonScanState = { source, file, offset: 0 };
  scanValue(state, 0, '');
  return JSON.parse(source) as unknown;
};
