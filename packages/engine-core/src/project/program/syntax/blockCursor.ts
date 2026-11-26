import { freeze } from '../../../immutable';
import type { SourceSpan } from '../../source/contract';
import type { AshfoxParseDiagnostic } from './blockAst';
import type { ProgramToken } from './lex';
import { PROGRAM_PARSE_NESTING_LIMIT } from './limits';

export class BlockAbort extends Error {}

export const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;

export interface BlockParserState {
  readonly tokens: readonly ProgramToken[];
  readonly path: string;
  readonly diagnostics: AshfoxParseDiagnostic[];
  index: number;
  depth: number;
  statements: number;
}

export const joinSpan = (left: SourceSpan, right: SourceSpan): SourceSpan =>
  Object.freeze({ start: left.start, end: right.end });

export const currentTok = (s: BlockParserState): ProgramToken =>
  s.tokens[s.index] ?? s.tokens[s.tokens.length - 1]!;

export const peekTok = (s: BlockParserState, offset = 1): ProgramToken =>
  s.tokens[Math.min(s.index + offset, s.tokens.length - 1)]!;

export const atEnd = (s: BlockParserState): boolean => currentTok(s).kind === 'eof';

export const checkSym = (s: BlockParserState, value: string): boolean =>
  !atEnd(s) && currentTok(s).kind === 'symbol' && currentTok(s).value === value;

export const checkWord = (s: BlockParserState, value: string): boolean =>
  !atEnd(s) && currentTok(s).kind === 'identifier' && currentTok(s).value === value;

export const takeTok = (s: BlockParserState): ProgramToken => {
  const tok = currentTok(s);
  if (!atEnd(s)) s.index += 1;
  return tok;
};

export const failAt = (
  s: BlockParserState,
  code: string,
  message: string,
  tok = currentTok(s),
): void => {
  s.diagnostics.push(
    freeze({ severity: 'error' as const, code, message, path: s.path, span: tok.span }),
  );
};

export const matchSym = (s: BlockParserState, value: string): boolean => {
  if (!checkSym(s, value)) return false;
  takeTok(s);
  return true;
};

export const expectSym = (s: BlockParserState, value: string, message: string): ProgramToken => {
  if (checkSym(s, value)) return takeTok(s);
  failAt(s, 'program.expected-token', message);
  return currentTok(s);
};

export const expectWord = (s: BlockParserState, value: string, message: string): ProgramToken => {
  if (checkWord(s, value)) return takeTok(s);
  failAt(s, 'program.expected-token', message);
  return currentTok(s);
};

export const enterDepth = (s: BlockParserState, tok = currentTok(s)): void => {
  s.depth += 1;
  if (s.depth > PROGRAM_PARSE_NESTING_LIMIT) {
    failAt(s, 'program.nesting-limit', 'Source nesting exceeds the parser limit.', tok);
    throw new BlockAbort();
  }
};

export const leaveDepth = (s: BlockParserState): void => {
  s.depth -= 1;
};

export const countStmt = (s: BlockParserState): void => {
  s.statements += 1;
  if (s.statements > 8192) {
    failAt(s, 'program.statement-limit', 'Source exceeds the maximum statement count.');
    throw new BlockAbort();
  }
};

export const recoverStmt = (s: BlockParserState): void => {
  let braces = 0;
  while (!atEnd(s)) {
    const sym = currentTok(s).kind === 'symbol' ? currentTok(s).value : '';
    if (braces === 0 && sym === '}') return;
    takeTok(s);
    if (sym === '{') braces += 1;
    else if (sym === '}') braces -= 1;
    if ((sym === '}' || sym === ';') && braces === 0) return;
  }
};

export const expectIdent = (
  s: BlockParserState,
  message = 'Expected an identifier.',
): ProgramToken => {
  const tok = currentTok(s);
  if (tok.kind === 'identifier' && !tok.value.includes('$')) {
    takeTok(s);
    return tok;
  }
  failAt(s, 'program.expected-identifier', message, tok);
  return tok;
};

export const validateSnakeKey = (s: BlockParserState, tok: ProgramToken): void => {
  if (SNAKE_CASE_RE.test(tok.value)) return;
  failAt(
    s,
    'program.invalid-key',
    `Identifier "${tok.value}" must be snake_case in ashfox 1.`,
    tok,
  );
};

export const readDottedPath = (
  s: BlockParserState,
  requireSnake: boolean,
  message = 'Expected a name.',
): { readonly segments: readonly string[]; readonly value: string; readonly span: SourceSpan } => {
  const first = expectIdent(s, message);
  if (requireSnake) validateSnakeKey(s, first);
  const segments = [first.value];
  let endSpan = first.span;
  while (matchSym(s, '.')) {
    const next = expectIdent(s, 'Expected an identifier after ".". ');
    if (requireSnake) validateSnakeKey(s, next);
    segments.push(next.value);
    endSpan = next.span;
  }
  return freeze({
    segments: freeze(segments),
    value: segments.join('.'),
    span: joinSpan(first.span, endSpan),
  });
};
