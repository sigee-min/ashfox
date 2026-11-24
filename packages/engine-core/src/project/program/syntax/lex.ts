import { sourceLengthDiagnostic } from '../../source/lexer';
import type { SourceDiagnostic, SourcePosition, SourceSpan } from '../../source/contract';

export type ProgramTokenKind = 'identifier' | 'number' | 'string' | 'color' | 'symbol' | 'eof';

export interface ProgramToken {
  readonly kind: ProgramTokenKind;
  readonly value: string;
  readonly span: SourceSpan;
}

const identifierStart = (value: string): boolean => /[A-Za-z_]/.test(value);
const identifierPart = (value: string): boolean => /[A-Za-z0-9_]/.test(value);
const digit = (value: string): boolean => /[0-9]/.test(value);
const hex = (value: string): boolean => /^[0-9A-Fa-f]{6}$/.test(value);

/** The grammar header is the one hyphenated keyword. */
const HEADER = 'ashfox-model';
const TWO_CHARACTER_SYMBOLS: ReadonlySet<string> = new Set(['==', '!=', '<=', '>=']);
const ONE_CHARACTER_SYMBOLS = '{}[](),;=:+-*/%<>.';

type SpanFactory = (start: number, end: number) => SourceSpan;

const lineStartsFor = (source: string): readonly number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
};

const positionFrom = (
  source: string,
  starts: readonly number[],
  offset: number,
): SourcePosition => {
  const bounded = Math.max(0, Math.min(Math.ceil(offset), source.length));
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= bounded) low = middle;
    else high = middle;
  }
  return Object.freeze({
    offset,
    line: low + 1,
    column: bounded - starts[low]! + 1 + Math.max(0, offset - source.length),
  });
};

const spanFactoryFor = (source: string): SpanFactory => {
  const starts = lineStartsFor(source);
  return (start, end): SourceSpan =>
    Object.freeze({
      start: positionFrom(source, starts, start),
      end: positionFrom(source, starts, end),
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

const skipWhile = (state: LexState, accept: (value: string) => boolean): void => {
  while (state.index < state.source.length && accept(state.source[state.index]!)) state.index += 1;
};

const skipWhitespace: Scanner = (state, current) => {
  if (!/\s/.test(current)) return false;
  state.index += 1;
  return true;
};

const skipLineComment: Scanner = (state, current) => {
  if (current !== '/' || at(state, 1) !== '/') return false;
  state.index += 2;
  skipWhile(state, (value) => value !== '\n');
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
  skipWhile(state, (value) => /[0-9A-Fa-f]/.test(value));
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
  if (/[A-Za-z0-9_$]/.test(at(state, HEADER.length))) return false;
  const start = state.index;
  state.index += HEADER.length;
  add(state, 'identifier', HEADER, start);
  return true;
};

const scanNumber: Scanner = (state, current) => {
  if (!digit(current) && !(current === '.' && digit(at(state, 1)))) return false;
  const start = state.index;
  if (current === '.') state.index += 1;
  skipWhile(state, digit);
  if (at(state) === '.') {
    state.index += 1;
    skipWhile(state, digit);
  }
  skipWhile(state, (value) => /[A-Za-z%]/.test(value));
  add(state, 'number', state.source.slice(start, state.index), start);
  return true;
};

/** Reads `{name}` after `$`; the cursor sits on the opening brace. */
const readBracedInterpolation = (state: LexState, marker: number): void => {
  state.index += 1;
  if (!identifierStart(at(state))) {
    report(
      state,
      'program.invalid-interpolation',
      'Interpolation must name an identifier inside ${...}.',
      marker,
      Math.min(state.source.length, state.index + 1),
    );
  } else {
    state.index += 1;
    skipWhile(state, identifierPart);
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
  if (!identifierStart(at(state))) {
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
  skipWhile(state, identifierPart);
  return true;
};

const scanIdentifier: Scanner = (state, current) => {
  const interpolated = current === '$' && (identifierStart(at(state, 1)) || at(state, 1) === '{');
  if (!identifierStart(current) && !interpolated) return false;
  const start = state.index;
  if (identifierStart(current)) state.index += 1;
  while (state.index < state.source.length) {
    skipWhile(state, identifierPart);
    if (at(state) !== '$' || !readInterpolation(state)) break;
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

const SCANNERS: readonly Scanner[] = Object.freeze([
  skipWhitespace,
  skipLineComment,
  skipBlockComment,
  scanString,
  scanColor,
  scanHeader,
  scanNumber,
  scanIdentifier,
  scanSymbol,
]);

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
    if (SCANNERS.some((scan) => scan(state, current))) continue;
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
