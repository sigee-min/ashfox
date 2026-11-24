import type { ProgramExpr } from '../syntax/contract';
import type { ProgramToken } from '../syntax/lex';
import type { SourceSpan } from '../../source/contract';

export type Token = ProgramToken;
export class ParserAbort extends Error {}
export const join = (left: SourceSpan, right: SourceSpan): SourceSpan =>
  Object.freeze({ start: left.start, end: right.end });
export const valueName = (value: ProgramExpr): string | null =>
  value.kind === 'name' ? value.value : null;
export const badName = (token: Token): boolean =>
  token.kind !== 'identifier' ||
  token.value.includes('$') ||
  token.value.includes('/') ||
  token.value.includes('.');
