import type { ProgramExpr } from '../syntax/contract';
import { parseProgramExpression } from '../syntax/expression';
import { PROGRAM_PARSE_NESTING_LIMIT } from '../syntax/limits';
import type { SourceSpan } from '../../source/contract';
import { buildAssemblyDecl, createAssemblyState, readAssemblyEntry } from './assembly';
import { parseMotion } from './motion';
import { parseComponent } from './component';
import {
  type AssetDeclaration,
  type AssetDiagnostic,
  type AssetImportDecl,
  type AssetQualifiedName,
  type AssetSourceParseResult,
  type AssetSourceUnit,
  type AssetValueType,
} from './contract';
import { parseAssetValueType, readAssetDesignDecl } from './design';
import { docsHint } from '../../source/suggest';
import {
  HOOK_DECL_KINDS,
  ParserAbort,
  applyUnitDeclarationTokens,
  badName,
  buildParseResult,
  consumeAssetHeader,
  freezeUnitDecl,
  isAssignmentTokens,
  isKebabAssignmentTokens,
  join,
  kebabKeyErrorMessage,
  readImportDecl,
  readOutputsList,
  skipHookDeclaration,
  unitScopeErrorMessage,
  type AssetReader,
  type Token,
} from './parserSupport';
import { parseRigContract, parseSkeleton, parseSocketContract } from './rig';
import { parseSurface, parseSurfaceContract } from './surface';
import type { RawDeclaredOutput, RawDeclaredPreview } from '../../directory/declarations';

export class Parser {
  private index = 0;
  private depth = 0;
  private declarations = 0;
  private lastBlockEnd: SourceSpan | null = null;
  private readonly diagnostics: AssetDiagnostic[] = [];

  constructor(
    private readonly tokens: readonly Token[],
    private readonly source: string,
    private readonly path: string,
  ) {}

  private current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  private end(): boolean {
    return this.current().kind === 'eof';
  }

  private take(): Token {
    const token = this.current();
    if (!this.end()) this.index += 1;
    return token;
  }

  private prevSpan(): SourceSpan {
    return this.tokens[Math.max(0, this.index - 1)]!.span;
  }

  private nextIsWord(value: string): boolean {
    const next = this.tokens[this.index + 1];
    return next?.kind === 'identifier' && next.value === value;
  }

  private check(value: string): boolean {
    return !this.end() && this.current().kind === 'symbol' && this.current().value === value;
  }

  private match(value: string): boolean {
    if (!this.check(value)) return false;
    this.take();
    return true;
  }

  private checkWord(value: string): boolean {
    return !this.end() && this.current().kind === 'identifier' && this.current().value === value;
  }

  private matchWord(value: string): boolean {
    if (!this.checkWord(value)) return false;
    this.take();
    return true;
  }

  private fail(code: string, message: string, token = this.current(), hint?: string): void {
    this.failSpan(code, message, token.span, hint);
  }

  private failSpan(code: string, message: string, span: SourceSpan, hint?: string): void {
    this.diagnostics.push(
      Object.freeze({
        severity: 'error',
        code,
        message,
        path: this.path,
        span,
        ...(hint !== undefined ? { hint } : {}),
      }),
    );
  }

  private expect(value: string, message: string): Token {
    if (this.check(value)) return this.take();
    this.fail('asset.expected-token', message);
    return this.current();
  }

  private expectWord(value: string, message: string): Token {
    if (this.checkWord(value)) return this.take();
    this.fail('asset.expected-token', message);
    return this.current();
  }

  private enter(token = this.current()): void {
    this.depth += 1;
    if (this.depth > PROGRAM_PARSE_NESTING_LIMIT) {
      this.fail('asset.nesting-limit', 'Asset source nesting exceeds the parser limit.', token);
      throw new ParserAbort();
    }
  }

  private leave(): void {
    this.depth -= 1;
  }

  private count(): void {
    this.declarations += 1;
    if (this.declarations > 4096) {
      this.fail('asset.declaration-limit', 'Asset source declares too many entries.');
      throw new ParserAbort();
    }
  }

  private recover(): void {
    let braces = 0;
    while (!this.end()) {
      const symbol = this.current().kind === 'symbol' ? this.current().value : '';
      if (braces === 0 && symbol === '}') return;
      this.take();
      if (symbol === '{') braces += 1;
      else if (symbol === '}') braces -= 1;
      if ((symbol === '}' || symbol === ';') && braces === 0) return;
    }
  }

  private scopeError(scope: string): void {
    this.fail(
      'asset.invalid-scope',
      'Statement "' + this.current().value + '" is not allowed in ' + scope + ' scope.',
    );
    this.recover();
  }

  private id(message = 'Expected an identifier.'): Token {
    const token = this.current();
    if (!badName(token)) {
      this.take();
      return token;
    }
    this.fail('asset.expected-identifier', message, token);
    return token;
  }

  private qualified(message = 'Expected a qualified name.'): AssetQualifiedName {
    const first = this.id(message);
    const segments = [first.value];
    while (this.match('.')) {
      const next = this.id('Expected a name after the qualified-name dot.');
      segments.push(next.value);
      if (segments.length > 2) {
        this.fail(
          'asset.invalid-qualified-name',
          'Qualified names contain one local name and at most one module alias.',
          next,
        );
      }
    }
    return Object.freeze({
      kind: 'qualified-name',
      segments: Object.freeze(segments),
      span: join(first.span, this.prevSpan()),
    });
  }

  private expression(): ProgramExpr {
    return parseProgramExpression({
      qualifiedNames: true,
      current: () => this.current(),
      take: () => this.take(),
      check: (value) => this.check(value),
      match: (value) => this.match(value),
      fail: (code, message, token, hint) =>
        this.fail(code.replace(/^(?:model|program)\./, 'asset.'), message, token, hint),
      enterDepth: () => this.enter(),
      leaveDepth: () => this.leave(),
    });
  }

  private assignment(): boolean {
    return isAssignmentTokens(this.tokens, this.index);
  }

  private kebabAssignment(): boolean {
    return isKebabAssignmentTokens(this.tokens, this.index);
  }

  private finish(): void {
    if (this.match(';')) {
      this.lastBlockEnd = this.prevSpan();
      return;
    }
    if (this.check('}') || this.end()) {
      this.lastBlockEnd = this.current().span;
      return;
    }
    this.fail('asset.expected-terminator', 'Statements must end with ;.');
    this.recover();
  }

  private finishEnd(): SourceSpan {
    return this.lastBlockEnd ?? this.current().span;
  }

  private word(message: string): string {
    const token = this.current();
    if (token.kind === 'identifier') {
      this.take();
      return token.value;
    }
    this.fail('asset.expected-identifier', message, token);
    return '';
  }

  private name(message = 'Expected a name.'): string {
    return this.id(message).value;
  }

  private abort(): never {
    throw new ParserAbort();
  }

  private block<T>(read: () => T): T[] {
    this.expect('{', 'Expected { to begin a block.');
    this.enter();
    const values: T[] = [];
    try {
      while (!this.check('}') && !this.end()) values.push(read());
      const close = this.expect('}', 'Expected } to close a block.');
      this.lastBlockEnd = close.span;
      return values;
    } finally {
      this.leave();
    }
  }

  private blockEnd(): SourceSpan {
    return this.lastBlockEnd ?? this.current().span;
  }

  private valueType(): AssetValueType {
    return parseAssetValueType({
      id: (message) => this.id(message),
      match: (value) => this.match(value),
      expect: (value, message) => this.expect(value, message),
      fail: (code, message, token) => this.fail(code, message, token),
    });
  }

  private reader(): AssetReader {
    return {
      current: () => this.current(),
      end: () => this.end(),
      take: () => this.take(),
      prevSpan: () => this.prevSpan(),
      nextIsWord: (value) => this.nextIsWord(value),
      check: (value) => this.check(value),
      match: (value) => this.match(value),
      checkWord: (value) => this.checkWord(value),
      fail: (code, message, token, hint) => this.fail(code, message, token, hint),
      failSpan: (code, message, span, hint) => this.failSpan(code, message, span, hint),
      expect: (value, message) => this.expect(value, message),
      expectWord: (value, message) => this.expectWord(value, message),
      enter: (token) => this.enter(token),
      leave: () => this.leave(),
      abort: () => this.abort(),
      recover: () => this.recover(),
      scopeError: (scope) => this.scopeError(scope),
      id: (message) => this.id(message),
      qualified: (message) => this.qualified(message),
      expression: () => this.expression(),
      assignment: () => this.assignment(),
      finish: () => this.finish(),
      finishEnd: () => this.finishEnd(),
      word: (message) => this.word(message),
      name: (message) => this.name(message),
      block: <T>(read: () => T): T[] => this.block(read),
      blockEnd: () => this.blockEnd(),
      valueType: () => this.valueType(),
    };
  }

  private importDecl(): AssetImportDecl {
    return readImportDecl(this.reader(), this.path);
  }

  private design(exported: boolean): AssetDeclaration {
    return readAssetDesignDecl(
      this.reader(),
      exported,
      () => this.count(),
      (word) => this.matchWord(word),
    );
  }

  private declaration(exported: boolean): AssetDeclaration | null {
    this.count();
    const keyword = this.current().value;
    if (HOOK_DECL_KINDS.has(keyword)) {
      skipHookDeclaration(this.reader());
      return null;
    }
    if (keyword === 'design') return this.design(exported);
    if (keyword === 'socket') {
      this.take();
      return parseSocketContract(this.reader(), exported);
    }
    if (keyword === 'rig') {
      this.take();
      return parseRigContract(this.reader(), exported);
    }
    if (keyword === 'skeleton') return parseSkeleton(this.reader(), exported);
    if (keyword === 'surface') return this.surfaceDeclaration(exported);
    if (keyword === 'component') return parseComponent(this.reader(), exported);
    if (keyword === 'motion') return parseMotion(this.reader(), exported);
    this.fail('asset.invalid-scope', unitScopeErrorMessage(keyword), undefined, docsHint('model'));
    this.recover();
    return null;
  }

  private surfaceDeclaration(exported: boolean): AssetDeclaration {
    if (this.nextIsWord('contract')) {
      this.take();
      return parseSurfaceContract(this.reader(), exported);
    }
    return parseSurface(this.reader(), exported);
  }

  private unitDeclarationBlock(
    kind: AssetSourceUnit['kind'],
    outputs: RawDeclaredOutput[],
    previews: RawDeclaredPreview[],
  ): boolean {
    const isAssign = this.checkWord('outputs') && this.assignment();
    const isOutputs = isAssign || this.matchWord('outputs');
    if (!isOutputs && !this.matchWord('preview')) return false;
    if (kind !== 'asset') {
      this.fail('asset.invalid-declaration', 'outputs and preview apply only to models.');
    }
    if (isAssign) {
      readOutputsList(this.reader(), outputs);
      return true;
    }
    try {
      this.index = applyUnitDeclarationTokens(
        this.tokens,
        this.index,
        this.path,
        isOutputs,
        outputs,
        previews,
      );
    } catch (error) {
      this.fail(
        'asset.invalid-declaration',
        error instanceof Error ? error.message : 'Invalid block.',
      );
      throw new ParserAbort();
    }
    return true;
  }

  private isAssemblyStatement(): boolean {
    return (
      this.checkWord('settings') ||
      this.checkWord('use') ||
      this.checkWord('connect') ||
      this.checkWord('variant') ||
      ((this.checkWord('skeleton') || this.checkWord('motions')) && this.assignment())
    );
  }

  private failKebabKey(): void {
    const tok = this.current();
    this.fail(
      'asset.invalid-key',
      kebabKeyErrorMessage(this.tokens, this.index),
      tok,
      docsHint('model'),
    );
    this.recover();
  }

  private unitBody(
    kind: AssetSourceUnit['kind'],
    outputs: RawDeclaredOutput[],
    previews: RawDeclaredPreview[],
    imports: AssetImportDecl[],
    declarations: AssetDeclaration[],
    assembly: ReturnType<typeof createAssemblyState> | null,
  ): void {
    while (!this.check('}') && !this.end()) {
      if (this.kebabAssignment()) this.failKebabKey();
      else if (this.checkWord('import')) imports.push(this.importDecl());
      else if (this.unitDeclarationBlock(kind, outputs, previews)) continue;
      else if (assembly !== null && this.isAssemblyStatement())
        readAssemblyEntry(this.reader(), assembly);
      else {
        const declaration = this.declaration(this.matchWord('export'));
        if (declaration !== null) declarations.push(declaration);
      }
    }
  }

  private unit(kind: AssetSourceUnit['kind']): AssetSourceUnit | null {
    const start = this.take();
    const id = this.id('Expected a source unit name.');
    this.expect('{', 'Expected { to begin a source unit.');
    this.enter();
    const imports: AssetImportDecl[] = [];
    const declarations: AssetDeclaration[] = [];
    const outputs: RawDeclaredOutput[] = [];
    const previews: RawDeclaredPreview[] = [];
    const assembly = kind === 'asset' ? createAssemblyState() : null;
    try {
      this.unitBody(kind, outputs, previews, imports, declarations, assembly);
      const close = this.expect('}', 'Expected } to close a source unit.');
      const span = join(start.span, close.span);
      if (assembly !== null) {
        this.count();
        declarations.push(buildAssemblyDecl(id.value, true, assembly, span));
      }
      return freezeUnitDecl(kind, id.value, imports, declarations, outputs, previews, span);
    } finally {
      this.leave();
    }
  }

  parse(): AssetSourceUnit | null {
    if (
      !consumeAssetHeader(
        this.tokens,
        this.index,
        () => this.take(),
        (c, m, t) => this.fail(c, m, t),
      )
    ) {
      return null;
    }
    const unit = this.checkWord('module')
      ? this.unit('module')
      : this.checkWord('model')
        ? this.unit('asset')
        : null;
    if (unit === null)
      this.fail('asset.expected-unit', 'Source must declare one module or model unit.');
    if (!this.end()) this.fail('asset.trailing-source', 'Only one source unit is allowed.');
    return unit;
  }

  result(): AssetSourceParseResult {
    let unit: AssetSourceUnit | null = null;
    try {
      unit = this.parse();
    } catch (error) {
      if (!(error instanceof ParserAbort)) this.fail('asset.parser-failure', 'Parse failed.');
    }
    return buildParseResult(this.path, this.source, unit, this.diagnostics);
  }
}
