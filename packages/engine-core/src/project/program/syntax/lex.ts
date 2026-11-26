import { sourceLengthDiagnostic } from '../../source/lexer';
import type { SourceDiagnostic, SourcePosition, SourceSpan } from '../../source/contract';

export type ProgramTokenKind = 'identifier' | 'number' | 'string' | 'color' | 'symbol' | 'eof';

export interface ProgramToken {
  readonly kind: ProgramTokenKind;
  readonly value: string;
  readonly span: SourceSpan;
}

const isIdentStartCode = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;

const isIdentPartCode = (code: number): boolean =>
  isIdentStartCode(code) || (code >= 48 && code <= 57);

const isDigitCode = (code: number): boolean => code >= 48 && code <= 57;

const isHexCode = (code: number): boolean =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);

const isSpaceAt = (source: string, index: number): boolean => {
  const code = source.charCodeAt(index);
  if (code < 128) return code === 32 || (code >= 9 && code <= 13);
  return /\s/.test(source[index]!);
};

const isAlphaOrPercentCode = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 37;

const hex = (value: string): boolean => {
  if (value.length !== 6) return false;
  for (let i = 0; i < 6; i += 1) {
    if (!isHexCode(value.charCodeAt(i))) return false;
  }
  return true;
};

/** The grammar header is the one hyphenated keyword. */
const HEADER = 'ashfox-model';
const TWO_CHARACTER_SYMBOLS: ReadonlySet<string> = new Set(['==', '!=', '<=', '>=']);
const ONE_CHARACTER_SYMBOLS = '{}[](),;=:+-*/%<>.';

type SpanFactory = (start: number, end: number) => SourceSpan;

const lineStartsFor = (source: string): readonly number[] => {
  const starts = [0];
  let pos = source.indexOf('\n');
  while (pos !== -1) {
    starts.push(pos + 1);
    pos = source.indexOf('\n', pos + 1);
  }
  return starts;
};

const findLineIndex = (starts: readonly number[], bounded: number, hint: number): number => {
  let low = bounded >= starts[hint]! ? hint : 0;
  while (low + 1 < starts.length && starts[low + 1]! <= bounded) {
    low += 1;
  }
  return low;
};

const spanFactoryFor = (source: string): SpanFactory => {
  const starts = lineStartsFor(source);
  let cursor = 0;
  const posAt = (offset: number): SourcePosition => {
    const bounded = Math.max(0, Math.min(Math.ceil(offset), source.length));
    cursor = findLineIndex(starts, bounded, cursor);
    return Object.freeze({
      offset,
      line: cursor + 1,
      column: bounded - starts[cursor]! + 1 + Math.max(0, offset - source.length),
    });
  };
  return (start, end): SourceSpan =>
    Object.freeze({
      start: posAt(start),
      end: posAt(end),
    });
};

const issue = (code: string, message: string, span: SourceSpan): SourceDiagnostic =>
  Object.freeze({ severity: 'error', code, message, span });

const token = (
  kind: ProgramTokenKind,
  value: string,
  span: SpanFactory,
  start: number,
  end: number,
): ProgramToken => Object.freeze({ kind, value, span: span(start, end) });

/** Mutable cursor shared by the scanners of one lexer run. */
interface LexState {
  readonly source: string;
  readonly span: SpanFactory;
  readonly tokens: ProgramToken[];
  readonly diagnostics: SourceDiagnostic[];
  index: number;
}

/** Consumes one lexeme starting at `current` and reports whether it applied. */
type Scanner = (state: LexState, current: string) => boolean;

const at = (state: LexState, offset = 0): string => state.source[state.index + offset] ?? '';

const report = (
  state: LexState,
  code: string,
  message: string,
  start: number,
  end: number,
): void => {
  state.diagnostics.push(issue(code, message, state.span(start, end)));
};

const add = (state: LexState, kind: ProgramTokenKind, value: string, start: number): void => {
  state.tokens.push(token(kind, value, state.span, start, state.index));
};

const skipCodes = (state: LexState, accept: (code: number) => boolean): void => {
  const { source } = state;
  let idx = state.index;
  while (idx < source.length && accept(source.charCodeAt(idx))) idx += 1;
  state.index = idx;
};

const skipWhitespaceRun = (state: LexState): void => {
  const { source } = state;
  let idx = state.index;
  while (idx < source.length && isSpaceAt(source, idx)) idx += 1;
  state.index = idx;
};

const skipLineComment: Scanner = (state, current) => {
  if (current !== '/' || at(state, 1) !== '/') return false;
  const nl = state.source.indexOf('\n', state.index + 2);
  state.index = nl === -1 ? state.source.length : nl;
  return true;
};

const skipBlockComment: Scanner = (state, current) => {
  if (current !== '/' || at(state, 1) !== '*') return false;
  const start = state.index;
  const close = state.source.indexOf('*/', start + 2);
  state.index = close === -1 ? state.source.length : close + 2;
  if (close === -1) {
    report(
      state,
      'program.unclosed-comment',
      'Block comments must close with */.',
      start,
      state.index,
    );
  }
  return true;
};

/** Reads one backslash escape and returns the decoded character, if valid. */
const readEscape = (state: LexState): string => {
  const escaped = state.source[state.index + 1];
  if (escaped === '"' || escaped === '\\') {
    state.index += 2;
    return escaped;
  }
  report(
    state,
    'program.invalid-escape',
    'Only \\" and \\\\ escapes are allowed in strings.',
    state.index,
    Math.min(state.source.length, state.index + 2),
  );
  state.index += escaped === undefined ? 1 : 2;
  return '';
};

/** Reads string contents up to the closing quote; reports whether it closed. */
const readStringBody = (state: LexState): { readonly value: string; readonly closed: boolean } => {
  let value = '';
  while (state.index < state.source.length) {
    const character = state.source[state.index]!;
    if (character === '"') {
      state.index += 1;
      return { value, closed: true };
    }
    if (character === '\n' || character === '\r') break;
    if (character === '\\') {
      value += readEscape(state);
      continue;
    }
    value += character;
    state.index += 1;
  }
  return { value, closed: false };
};

const scanString: Scanner = (state, current) => {
  if (current !== '"') return false;
  const start = state.index;
  state.index += 1;
  const { value, closed } = readStringBody(state);
  if (!closed) {
    report(
      state,
      'program.unclosed-string',
      'Quoted strings must close on the same line.',
      start,
      state.index,
    );
  }
  add(state, 'string', value, start);
  return true;
};

const scanColor: Scanner = (state, current) => {
  if (current !== '#') return false;
  const start = state.index;
  state.index += 1;
  skipCodes(state, isHexCode);
  const value = state.source.slice(start + 1, state.index);
  if (!hex(value)) {
    report(
      state,
      'program.invalid-color',
      'Colors must contain exactly six hexadecimal digits after #.',
      start,
      state.index,
    );
  }
  add(state, 'color', '#' + value.toLowerCase(), start);
  return true;
};

/* Keep the header atomic only at the beginning of the token stream; authored
 * identifiers elsewhere must lex '-' as the subtraction operator. */
const scanHeader: Scanner = (state) => {
  if (state.tokens.length !== 0 || !state.source.startsWith(HEADER, state.index)) return false;
  const next = state.source.charCodeAt(state.index + HEADER.length);
  if (isIdentPartCode(next) || next === 36) return false;
  const start = state.index;
  state.index += HEADER.length;
  add(state, 'identifier', HEADER, start);
  return true;
};

const scanNumber: Scanner = (state, current) => {
  const code = current.charCodeAt(0);
  if (
    !isDigitCode(code) &&
    !(code === 46 && isDigitCode(state.source.charCodeAt(state.index + 1)))
  ) {
    return false;
  }
  const start = state.index;
  if (code === 46) state.index += 1;
  skipCodes(state, isDigitCode);
  if (state.source.charCodeAt(state.index) === 46) {
    state.index += 1;
    skipCodes(state, isDigitCode);
  }
  skipCodes(state, isAlphaOrPercentCode);
  add(state, 'number', state.source.slice(start, state.index), start);
  return true;
};

/** Reads `{name}` after `$`; the cursor sits on the opening brace. */
const readBracedInterpolation = (state: LexState, marker: number): void => {
  state.index += 1;
  if (!isIdentStartCode(state.source.charCodeAt(state.index))) {
    report(
      state,
      'program.invalid-interpolation',
      'Interpolation must name an identifier inside ${...}.',
      marker,
      Math.min(state.source.length, state.index + 1),
    );
  } else {
    state.index += 1;
    skipCodes(state, isIdentPartCode);
  }
  if (at(state) === '}') state.index += 1;
  else {
    report(
      state,
      'program.invalid-interpolation',
      'Braced interpolation must close with }.',
      marker,
      state.index,
    );
  }
};

/** Reads one `$name` or `${name}` interpolation; returns false when the identifier ends. */
const readInterpolation = (state: LexState): boolean => {
  const marker = state.index;
  state.index += 1;
  if (at(state) === '{') {
    readBracedInterpolation(state, marker);
    return true;
  }
  if (!isIdentStartCode(state.source.charCodeAt(state.index))) {
    report(
      state,
      'program.invalid-interpolation',
      'Interpolation must name an identifier after $.',
      marker,
      Math.min(state.source.length, state.index + 1),
    );
    return false;
  }
  state.index += 1;
  skipCodes(state, isIdentPartCode);
  return true;
};

const scanIdentifier: Scanner = (state, current) => {
  const code = current.charCodeAt(0);
  const nextCode = state.source.charCodeAt(state.index + 1);
  const interpolated = code === 36 && (isIdentStartCode(nextCode) || nextCode === 123);
  if (!isIdentStartCode(code) && !interpolated) return false;
  const start = state.index;
  if (isIdentStartCode(code)) state.index += 1;
  while (state.index < state.source.length) {
    skipCodes(state, isIdentPartCode);
    if (state.source.charCodeAt(state.index) !== 36 || !readInterpolation(state)) break;
  }
  add(state, 'identifier', state.source.slice(start, state.index), start);
  return true;
};

const scanSymbol: Scanner = (state, current) => {
  const two = state.source.slice(state.index, state.index + 2);
  const value = TWO_CHARACTER_SYMBOLS.has(two)
    ? two
    : ONE_CHARACTER_SYMBOLS.includes(current)
      ? current
      : null;
  if (value === null) return false;
  const start = state.index;
  state.index += value.length;
  add(state, 'symbol', value, start);
  return true;
};

const scanSlashToken = (state: LexState, current: string): boolean =>
  skipLineComment(state, current) || skipBlockComment(state, current) || scanSymbol(state, current);

const scanNext = (state: LexState, current: string): boolean => {
  const code = current.charCodeAt(0);
  if (isSpaceAt(state.source, state.index)) {
    skipWhitespaceRun(state);
    return true;
  }
  if (code === 47) return scanSlashToken(state, current);
  if (code === 34) return scanString(state, current);
  if (code === 35) return scanColor(state, current);
  if (state.tokens.length === 0 && scanHeader(state, current)) return true;
  if (isDigitCode(code) || code === 46) {
    if (scanNumber(state, current)) return true;
  }
  if (isIdentStartCode(code) || code === 36) {
    if (scanIdentifier(state, current)) return true;
  }
  return scanSymbol(state, current);
};

/** Lexer for the versioned source language. Newlines are insignificant. */
export const lexProgramSource = (
  source: string,
): {
  readonly tokens: readonly ProgramToken[];
  readonly diagnostics: readonly SourceDiagnostic[];
} => {
  const span = spanFactoryFor(source);
  const eof = (): ProgramToken => token('eof', '', span, source.length, source.length);
  const lengthIssue = sourceLengthDiagnostic(source);
  if (lengthIssue) {
    return Object.freeze({
      tokens: Object.freeze([eof()]),
      diagnostics: Object.freeze([lengthIssue]),
    });
  }
  const state: LexState = { source, span, tokens: [], diagnostics: [], index: 0 };
  while (state.index < source.length) {
    const current = source[state.index]!;
    if (scanNext(state, current)) continue;
    report(
      state,
      'program.invalid-character',
      'Unexpected character "' + current + '".',
      state.index,
      state.index + 1,
    );
    state.index += 1;
  }
  state.tokens.push(eof());
  return Object.freeze({
    tokens: Object.freeze(state.tokens),
    diagnostics: Object.freeze(state.diagnostics),
  });
};
