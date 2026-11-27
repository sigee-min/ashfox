import { freeze } from '../../../immutable';
import { compareText } from '../../../stableOrder';
import { sourceSpan } from '../../source/lexer';
import { docsHint, formatDidYouMean, toSnakeCaseTrap } from '../../source/suggest';
import {
  ASHFOX_GRAMMAR,
  ASHFOX_TOP_KINDS,
  type AshfoxAssignStmt,
  type AshfoxBareItem,
  type AshfoxBareStmt,
  type AshfoxBlock,
  type AshfoxExportDecl,
  type AshfoxFile,
  type AshfoxImportStmt,
  type AshfoxNamedBlock,
  type AshfoxParseResult,
  type AshfoxStatement,
  type AshfoxTopDecl,
  type AshfoxTopKind,
} from './blockAst';
import {
  BlockAbort,
  atEnd,
  checkSym,
  checkWord,
  countStmt,
  currentTok,
  enterDepth,
  expectIdent,
  expectSym,
  expectWord,
  failAt,
  joinSpan,
  leaveDepth,
  matchSym,
  peekTok,
  readDottedPath,
  recoverStmt,
  takeTok,
  validateSnakeKey,
  type BlockParserState,
} from './blockCursor';
import { parseBlockExpr, parseOptionalEasing } from './blockExpr';
import { lexProgramSource, type ProgramToken } from './lex';
import { expandStaticForTokens } from './staticFor';

const TOP_KIND_SET: ReadonlySet<string> = new Set(ASHFOX_TOP_KINDS);
const CONTRACT_BLOCK_KINDS: ReadonlySet<string> = new Set(['rig', 'surface', 'socket']);

const findKebabAssignmentEnd = (s: BlockParserState): number | null => {
  if (currentTok(s).kind !== 'identifier') return null;
  let pos = s.index + 1;
  let sawHyphen = false;
  while (
    s.tokens[pos]?.kind === 'symbol' &&
    (s.tokens[pos]!.value === '-' || s.tokens[pos]!.value === '.') &&
    s.tokens[pos + 1]?.kind === 'identifier'
  ) {
    if (s.tokens[pos]!.value === '-') sawHyphen = true;
    pos += 2;
  }
  return sawHyphen && s.tokens[pos]?.kind === 'symbol' && s.tokens[pos]!.value === '=' ? pos : null;
};

const isAssignStart = (s: BlockParserState): boolean => {
  if (currentTok(s).kind !== 'identifier') return false;
  let pos = s.index + 1;
  while (
    s.tokens[pos]?.kind === 'symbol' &&
    s.tokens[pos]!.value === '.' &&
    s.tokens[pos + 1]?.kind === 'identifier'
  ) {
    pos += 2;
  }
  return s.tokens[pos]?.kind === 'symbol' && s.tokens[pos]!.value === '=';
};

const hasTrailingBlockBrace = (s: BlockParserState, startPos: number): boolean => {
  let pos = startPos;
  while (pos < s.tokens.length) {
    const tok = s.tokens[pos]!;
    if (tok.kind === 'symbol' && tok.value === '{') return true;
    if (tok.kind === 'symbol' && (tok.value === ';' || tok.value === '=' || tok.value === '}')) {
      return false;
    }
    if (tok.kind === 'eof') return false;
    pos += 1;
  }
  return false;
};

const skipBalancedParenPos = (tokens: readonly ProgramToken[], pos: number): number | null => {
  if (tokens[pos]?.kind !== 'symbol' || tokens[pos]!.value !== '(') return pos;
  let depth = 0;
  for (let i = pos; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok.kind === 'symbol' && tok.value === '(') depth += 1;
    else if (tok.kind === 'symbol' && tok.value === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return null;
};

const advanceHeaderPath = (tokens: readonly ProgramToken[], start: number): number => {
  let pos = start + 1;
  while (
    tokens[pos]?.kind === 'symbol' &&
    tokens[pos]!.value === '.' &&
    tokens[pos + 1]?.kind === 'identifier'
  ) {
    pos += 2;
  }
  return pos;
};

const isNamedBlockHeader = (s: BlockParserState): boolean => {
  const head = currentTok(s).value;
  let pos = s.index + 1;
  if (CONTRACT_BLOCK_KINDS.has(head) && s.tokens[pos]?.value === 'contract') pos += 1;
  if (s.tokens[pos]?.value === '{') return true;
  if (s.tokens[pos]?.kind !== 'identifier') return false;
  pos = advanceHeaderPath(s.tokens, pos);
  if (head === 'component' && s.tokens[pos]?.value === '(') {
    const afterParen = skipBalancedParenPos(s.tokens, pos);
    if (afterParen === null) return false;
    pos = afterParen;
  }
  const next = s.tokens[pos];
  if (!next) return false;
  if (next.value === '{') return true;
  const hasClause = next.value === ':' || next.value === 'implements' || next.value === 'for';
  return hasClause ? hasTrailingBlockBrace(s, pos) : false;
};

const parseImportStmt = (s: BlockParserState, topLevel: boolean): AshfoxImportStmt => {
  const start = expectWord(s, 'import', 'Expected import.');
  if (!topLevel) {
    failAt(
      s,
      'program.invalid-import-scope',
      'Imports are only allowed at the top-level block.',
      start,
    );
  }
  const pathTok = currentTok(s);
  const pathValue = pathTok.kind === 'string' ? takeTok(s).value : '';
  if (pathTok.kind !== 'string') {
    failAt(s, 'program.invalid-import-path', 'Imports require a quoted relative path.', pathTok);
  }
  expectWord(s, 'as', 'Expected as after an import path.');
  const alias = expectIdent(s, 'Expected an import alias.');
  const semi = expectSym(s, ';', 'Imports must end with ;.');
  return freeze({
    kind: 'import',
    path: pathValue,
    alias: alias.value,
    pathSpan: pathTok.span,
    span: joinSpan(start.span, semi.span),
  });
};

const parseAssignStmt = (s: BlockParserState): AshfoxAssignStmt => {
  const path = readDottedPath(s, true, 'Expected a snake_case property key.');
  expectSym(s, '=', 'Expected = in an assignment.');
  const value = parseBlockExpr(s);
  const easing = value.kind === 'transition' ? null : parseOptionalEasing(s);
  const semi = expectSym(s, ';', 'Assignments must end with ;.');
  return freeze({
    kind: 'assign',
    path: path.value,
    segments: path.segments,
    value,
    easing,
    span: joinSpan(path.span, semi.span),
  });
};

const parseNamedBlock = (s: BlockParserState): AshfoxNamedBlock => {
  const kindTok = expectIdent(s, 'Expected block keyword.');
  validateSnakeKey(s, kindTok);
  const qualifier =
    CONTRACT_BLOCK_KINDS.has(kindTok.value) && checkWord(s, 'contract') ? takeTok(s).value : null;
  const hasName =
    !checkSym(s, '{') && !checkSym(s, ':') && !checkWord(s, 'implements') && !checkWord(s, 'for');
  const name = hasName ? readDottedPath(s, false, 'Expected a block name.').value : null;
  if (kindTok.value === 'component' && checkSym(s, '(')) {
    const afterParen = skipBalancedParenPos(s.tokens, s.index);
    while (afterParen !== null && s.index < afterParen) takeTok(s);
  }
  const typeRef = matchSym(s, ':')
    ? readDottedPath(s, false, 'Expected a type reference.').value
    : null;
  const implementsRef = checkWord(s, 'implements')
    ? (takeTok(s), readDottedPath(s, false, 'Expected a contract reference.').value)
    : null;
  const forRef = checkWord(s, 'for')
    ? (takeTok(s), readDottedPath(s, false, 'Expected a target reference.').value)
    : null;
  const block = parseBlock(s, false);
  return freeze({
    kind: 'named-block',
    blockKind: kindTok.value,
    qualifier,
    name,
    typeRef,
    implementsRef,
    forRef,
    block,
    span: joinSpan(kindTok.span, block.span),
  });
};

const parseExportDecl = (s: BlockParserState): AshfoxExportDecl => {
  const start = expectWord(s, 'export', 'Expected export.');
  if (currentTok(s).kind !== 'identifier' || !isNamedBlockHeader(s)) {
    failAt(s, 'program.expected-named-block', 'export must precede a named block declaration.');
  }
  const declaration = parseNamedBlock(s);
  return freeze({ kind: 'export', declaration, span: joinSpan(start.span, declaration.span) });
};

const readBareItem = (s: BlockParserState, kind: string, items: AshfoxBareItem[]): void => {
  if (checkSym(s, '=') || checkSym(s, ':')) {
    const sym = takeTok(s);
    items.push(freeze({ kind: 'symbol', value: sym.value as '=' | ':', span: sym.span }));
    return;
  }
  if (kind === 'use' && items.length === 0) {
    const path = readDottedPath(s, false, 'Expected component name.');
    items.push(freeze({ kind: 'expr', value: freeze({ kind: 'path', ...path }) }));
    const afterParen = checkSym(s, '(') ? skipBalancedParenPos(s.tokens, s.index) : null;
    while (afterParen !== null && s.index < afterParen) takeTok(s);
    return;
  }
  const expr = parseBlockExpr(s);
  if (expr.kind === 'path' && checkSym(s, '=')) {
    validateSnakeKey(s, { kind: 'identifier', value: expr.segments[0]!, span: expr.span });
  }
  items.push(freeze({ kind: 'expr', value: expr }));
};

const parseBareStmt = (s: BlockParserState): AshfoxBareStmt => {
  const kindTok = expectIdent(s, 'Expected a statement keyword.');
  validateSnakeKey(s, kindTok);
  const items: AshfoxBareItem[] = [];
  while (!checkSym(s, '{') && !checkSym(s, ';') && !checkSym(s, '}') && !atEnd(s)) {
    readBareItem(s, kindTok.value, items);
  }
  if (checkSym(s, '{')) {
    const block = parseBlock(s, false);
    return freeze({
      kind: 'bare',
      stmtKind: kindTok.value,
      items: freeze(items),
      block,
      span: joinSpan(kindTok.span, block.span),
    });
  }
  const semi = expectSym(s, ';', 'Statements must end with ";" or "{ ... }".');
  return freeze({
    kind: 'bare',
    stmtKind: kindTok.value,
    items: freeze(items),
    block: null,
    span: joinSpan(kindTok.span, semi.span),
  });
};

const kebabSlice = (s: BlockParserState, endPos: number): string => {
  let raw = '';
  for (let i = s.index; i < endPos; i += 1) raw += s.tokens[i]!.value;
  return raw;
};

const parseStatement = (s: BlockParserState, topLevel: boolean): AshfoxStatement | null => {
  countStmt(s);
  const kebabEnd = findKebabAssignmentEnd(s);
  if (kebabEnd !== null) {
    const bad = currentTok(s);
    const raw = kebabSlice(s, kebabEnd);
    const snake = toSnakeCaseTrap(raw);
    const didYouMean = snake !== null ? ` Did you mean "${snake}"?` : '';
    failAt(
      s,
      'program.invalid-key',
      `Property key "${raw}" cannot use kebab-case; use snake_case.${didYouMean}`,
      bad,
      docsHint('model'),
    );
    recoverStmt(s);
    return null;
  }
  if (checkWord(s, 'import') && !isAssignStart(s)) return parseImportStmt(s, topLevel);
  if (checkWord(s, 'export') && !isAssignStart(s)) return parseExportDecl(s);
  if (currentTok(s).kind === 'identifier') {
    if (isAssignStart(s)) return parseAssignStmt(s);
    if (isNamedBlockHeader(s)) return parseNamedBlock(s);
    return parseBareStmt(s);
  }
  failAt(s, 'program.unexpected-token', `Unexpected token "${currentTok(s).value}".`);
  recoverStmt(s);
  return null;
};

const parseBlock = (s: BlockParserState, topLevel: boolean): AshfoxBlock => {
  const open = expectSym(s, '{', 'Expected { to begin a block.');
  enterDepth(s, open);
  const statements: AshfoxStatement[] = [];
  let sawNonImport = false;
  try {
    while (!checkSym(s, '}') && !atEnd(s)) {
      const before = s.index;
      const stmt = parseStatement(s, topLevel);
      if (stmt !== null) {
        if (stmt.kind === 'import' && sawNonImport) {
          failAt(
            s,
            'program.import-order',
            'All import statements must appear at the top of the declaration block.',
            { kind: 'identifier', value: 'import', span: stmt.span },
          );
        }
        if (stmt.kind !== 'import') sawNonImport = true;
        statements.push(stmt);
      }
      if (s.index === before) takeTok(s);
    }
    const close = expectSym(s, '}', 'Expected } to close a block.');
    return freeze({
      kind: 'block',
      statements: freeze(statements),
      span: joinSpan(open.span, close.span),
    });
  } finally {
    leaveDepth(s);
  }
};

const parseTopDecl = (s: BlockParserState): AshfoxTopDecl | null => {
  const kindTok = currentTok(s);
  if (kindTok.kind !== 'identifier' || !TOP_KIND_SET.has(kindTok.value)) {
    failAt(
      s,
      'program.expected-top-decl',
      `Top-level declaration must be module, model, sprite, sound, structure, or vfx.${formatDidYouMean(kindTok.value, ASHFOX_TOP_KINDS)}`,
      kindTok,
      docsHint('model'),
    );
    return null;
  }
  takeTok(s);
  const nameTok = expectIdent(s, 'Expected top-level declaration name.');
  const block = parseBlock(s, true);
  return freeze({
    kind: kindTok.value as AshfoxTopKind,
    name: nameTok.value,
    block,
    span: joinSpan(kindTok.span, block.span),
  });
};

const parseFile = (s: BlockParserState): AshfoxFile | null => {
  const header = currentTok(s);
  const version = peekTok(s);
  if (
    header.kind !== 'identifier' ||
    header.value !== 'ashfox' ||
    version.kind !== 'number' ||
    version.value !== '1'
  ) {
    failAt(s, 'program.invalid-header', `Expected "${ASHFOX_GRAMMAR}".`, header);
    return null;
  }
  takeTok(s);
  takeTok(s);
  const top = parseTopDecl(s);
  if (top === null) return null;
  if (!atEnd(s)) {
    failAt(s, 'program.trailing-source', 'Only one top-level declaration is allowed per file.');
  }
  return freeze({
    grammar: ASHFOX_GRAMMAR,
    top,
    span: joinSpan(header.span, top.span),
  });
};

export const parseAshfoxTokens = (
  tokens: readonly ProgramToken[],
  source: string,
  path = 'main.ashfox',
): AshfoxParseResult => {
  const expanded = expandStaticForTokens(tokens);
  if (expanded.diagnostics.length > 0) {
    return freeze({
      path,
      source,
      grammar: ASHFOX_GRAMMAR,
      file: null,
      diagnostics: freeze(expanded.diagnostics.map((entry) => freeze({ ...entry, path }))),
    });
  }
  const state: BlockParserState = {
    tokens: expanded.tokens,
    path,
    diagnostics: [],
    index: 0,
    depth: 0,
    statements: 0,
  };
  let file: AshfoxFile | null = null;
  try {
    file = parseFile(state);
  } catch (error) {
    if (!(error instanceof BlockAbort)) {
      failAt(state, 'program.parser-failure', 'Source could not be parsed safely.');
    }
  }
  if (state.diagnostics.length > 0) file = null;
  const diagnostics = [...state.diagnostics].sort(
    (a, b) => a.span.start.offset - b.span.start.offset || compareText(a.code, b.code),
  );
  return freeze({
    path,
    source,
    grammar: ASHFOX_GRAMMAR,
    file,
    diagnostics: freeze(diagnostics),
  });
};

export const parseAshfoxProgram = (source: string, path = 'main.ashfox'): AshfoxParseResult => {
  const lexical = lexProgramSource(source);
  if (lexical.diagnostics.length > 0) {
    return freeze({
      path,
      source,
      grammar: ASHFOX_GRAMMAR,
      file: null,
      diagnostics: freeze(lexical.diagnostics.map((entry) => freeze({ ...entry, path }))),
    });
  }
  if (lexical.tokens.length > 32_000) {
    return freeze({
      path,
      source,
      grammar: ASHFOX_GRAMMAR,
      file: null,
      diagnostics: freeze([
        freeze({
          severity: 'error' as const,
          code: 'program.token-limit',
          message: 'Source contains too many tokens.',
          path,
          span: sourceSpan(source, 0, source.length),
        }),
      ]),
    });
  }
  return parseAshfoxTokens(lexical.tokens, source, path);
};
