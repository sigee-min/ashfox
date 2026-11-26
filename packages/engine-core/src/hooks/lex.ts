import type { SourcePosition } from '../project/source/contract';
import type { HookDiagnostic, HookSourceSpan } from './contract';

export type HookTokenKind = 'identifier' | 'number' | 'string' | 'symbol' | 'eof';

export interface HookToken {
  readonly kind: HookTokenKind;
  readonly value: string;
  readonly span: HookSourceSpan;
}

interface LexState {
  readonly file: string;
  readonly source: string;
  readonly starts: readonly number[];
  readonly tokens: HookToken[];
  readonly diagnostics: HookDiagnostic[];
  index: number;
}

const SINGLE_SYMBOLS = '{}[](),;=:+-*/<>|?.';
const TWO_CHAR_SYMBOLS = new Set(['..', '==', '!=', '<=', '>=']);

const computeLineStarts = (source: string): readonly number[] => {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
};

const posAt = (state: LexState, offset: number): SourcePosition => {
  const bounded = Math.max(0, Math.min(offset, state.source.length));
  let lo = 0;
  let hi = state.starts.length;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (state.starts[mid]! <= bounded) lo = mid;
    else hi = mid;
  }
  return Object.freeze({
    offset: bounded,
    line: lo + 1,
    column: bounded - state.starts[lo]! + 1,
  });
};

const spanAt = (state: LexState, start: number, end: number): HookSourceSpan =>
  Object.freeze({
    file: state.file,
    start: posAt(state, start),
    end: posAt(state, end),
  });

const pushDiag = (
  state: LexState,
  code: string,
  message: string,
  start: number,
  end: number,
): void => {
  const span = spanAt(state, start, end);
  const token = state.source.slice(start, end) || 'EOF';
  state.diagnostics.push(
    Object.freeze({
      severity: 'error',
      code,
      message,
      file: state.file,
      line: span.start.line,
      column: span.start.column,
      token,
      span,
    }),
  );
};

const pushToken = (state: LexState, kind: HookTokenKind, value: string, start: number): void => {
  state.tokens.push(Object.freeze({ kind, value, span: spanAt(state, start, state.index) }));
};

const isIdentStart = (ch: string): boolean => /[A-Za-z_]/.test(ch);
const isIdentPart = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);
const isDigit = (ch: string): boolean => /[0-9]/.test(ch);

const skipCommentsAndSpace = (state: LexState): boolean => {
  const ch = state.source[state.index] ?? '';
  if (/\s/.test(ch)) {
    state.index += 1;
    return true;
  }
  if (ch === '/' && state.source[state.index + 1] === '/') {
    state.index += 2;
    while (state.index < state.source.length && state.source[state.index] !== '\n') {
      state.index += 1;
    }
    return true;
  }
  if (ch === '/' && state.source[state.index + 1] === '*') {
    const start = state.index;
    const close = state.source.indexOf('*/', start + 2);
    state.index = close === -1 ? state.source.length : close + 2;
    if (close === -1) {
      pushDiag(
        state,
        'hooks.unclosed-comment',
        'Block comment must close with */.',
        start,
        state.index,
      );
    }
    return true;
  }
  return false;
};

const readStringEscape = (state: LexState): string => {
  const next = state.source[state.index + 1];
  if (next === '"' || next === '\\') {
    state.index += 2;
    return next;
  }
  pushDiag(
    state,
    'hooks.invalid-escape',
    'Only \\" and \\\\ escapes are allowed in strings.',
    state.index,
    Math.min(state.source.length, state.index + 2),
  );
  state.index += next === undefined ? 1 : 2;
  return '';
};

const scanString = (state: LexState): void => {
  const start = state.index;
  state.index += 1;
  let value = '';
  let closed = false;
  while (state.index < state.source.length) {
    const ch = state.source[state.index]!;
    if (ch === '"') {
      state.index += 1;
      closed = true;
      break;
    }
    if (ch === '\n' || ch === '\r') break;
    if (ch === '\\') {
      value += readStringEscape(state);
      continue;
    }
    value += ch;
    state.index += 1;
  }
  if (!closed) {
    pushDiag(
      state,
      'hooks.unclosed-string',
      'Quoted strings must close on the same line.',
      start,
      state.index,
    );
  }
  pushToken(state, 'string', value, start);
};

const scanNumber = (state: LexState): void => {
  const start = state.index;
  while (state.index < state.source.length && isDigit(state.source[state.index]!)) {
    state.index += 1;
  }
  if (
    state.source[state.index] === '.' &&
    state.source[state.index + 1] !== '.' &&
    isDigit(state.source[state.index + 1] ?? '')
  ) {
    state.index += 1;
    while (state.index < state.source.length && isDigit(state.source[state.index]!)) {
      state.index += 1;
    }
  }
  while (state.index < state.source.length && /[A-Za-z]/.test(state.source[state.index]!)) {
    state.index += 1;
  }
  pushToken(state, 'number', state.source.slice(start, state.index), start);
};

const scanIdentifier = (state: LexState): void => {
  const start = state.index;
  if (state.tokens.length === 0 && state.source.startsWith('ashfox-model', start)) {
    const after = state.source[start + 'ashfox-model'.length] ?? '';
    if (!isIdentPart(after)) {
      state.index += 'ashfox-model'.length;
      pushToken(state, 'identifier', 'ashfox-model', start);
      return;
    }
  }
  state.index += 1;
  while (state.index < state.source.length && isIdentPart(state.source[state.index]!)) {
    state.index += 1;
  }
  pushToken(state, 'identifier', state.source.slice(start, state.index), start);
};

const scanNext = (state: LexState): void => {
  const ch = state.source[state.index]!;
  if (ch === '"') {
    scanString(state);
    return;
  }
  if (isDigit(ch)) {
    scanNumber(state);
    return;
  }
  if (isIdentStart(ch)) {
    scanIdentifier(state);
    return;
  }
  const two = state.source.slice(state.index, state.index + 2);
  if (TWO_CHAR_SYMBOLS.has(two)) {
    const start = state.index;
    state.index += 2;
    pushToken(state, 'symbol', two, start);
    return;
  }
  if (SINGLE_SYMBOLS.includes(ch)) {
    const start = state.index;
    state.index += 1;
    pushToken(state, 'symbol', ch, start);
    return;
  }
  pushDiag(
    state,
    'hooks.unexpected-character',
    `Unexpected character "${ch}".`,
    state.index,
    state.index + 1,
  );
  state.index += 1;
};

/** Tokenize native `.ashfox` hooks and schema source text with file/line/column spans. */
export const lexHooksSource = (
  source: string,
  file = 'hooks.ashfox',
): { readonly tokens: readonly HookToken[]; readonly diagnostics: readonly HookDiagnostic[] } => {
  const state: LexState = {
    file,
    source,
    starts: computeLineStarts(source),
    tokens: [],
    diagnostics: [],
    index: 0,
  };
  while (state.index < source.length) {
    if (skipCommentsAndSpace(state)) continue;
    scanNext(state);
  }
  const eofSpan = spanAt(state, source.length, source.length);
  state.tokens.push(Object.freeze({ kind: 'eof', value: '', span: eofSpan }));
  return Object.freeze({
    tokens: Object.freeze(state.tokens),
    diagnostics: Object.freeze(state.diagnostics),
  });
};
