import type { ProgramExpr } from '../syntax/contract';
import { parseProgramExpression } from '../syntax/expression';
import { PROGRAM_PARSE_NESTING_LIMIT } from '../syntax/limits';
import type { SourceSpan } from '../../source/contract';
import { buildAssemblyDecl, createAssemblyState, readAssemblyEntry } from './assembly';
import { parseMotion } from './motion';
import { parseComponent } from './component';
import {
  ASHFOX_ASSET_GRAMMAR,
  type AssetDeclaration,
  type AssetDiagnostic,
  type AssetImportDecl,
  type AssetQualifiedName,
  type AssetSourceParseResult,
  type AssetSourceUnit,
  type AssetValueType,
} from './contract';
import { parseAssetDesign, parseAssetValueType } from './design';
import {
  HOOK_DECL_KINDS,
  ParserAbort,
  badName,
  buildParseResult,
  isAssignmentTokens,
  isKebabAssignmentTokens,
  join,
  readImportDecl,
  readOutputsList,
  skipHookDeclaration,
  type AssetReader,
  type Token,
} from './parserSupport';
import { parseRigContract, parseSkeleton, parseSocketContract } from './rig';
import { parseSurface, parseSurfaceContract } from './surface';
import {
  parseOutputsTokens,
  parsePreviewTokens,
  type RawDeclaredOutput,
  type RawDeclaredPreview,
} from '../../directory/declarations';

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

  private fail(code: string, message: string, token = this.current()): void {
    this.diagnostics.push(
      Object.freeze({ severity: 'error', code, message, path: this.path, span: token.span }),
    );
  }

  private failSpan(code: string, message: string, span: SourceSpan): void {
    this.diagnostics.push(
      Object.freeze({ severity: 'error', code, message, path: this.path, span }),
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
      fail: (code, message, token) =>
        this.fail(code.replace(/^(?:model|program)\./, 'asset.'), message, token),
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
      fail: (code, message, token) => this.fail(code, message, token),
      failSpan: (code, message, span) => this.failSpan(code, message, span),
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
    const reader = this.reader();
    return parseAssetDesign(
      {
        take: reader.take,
        id: reader.id,
        count: () => this.count(),
        matchWord: (word) => this.matchWord(word),
        expect: reader.expect,
        valueType: reader.valueType,
        expression: reader.expression,
        finish: reader.finish,
        block: (read) => {
          reader.block(read);
        },
        blockEnd: reader.blockEnd,
        fail: reader.fail,
      },
      exported,
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
    this.scopeError('module or model unit');
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
      const res = isOutputs
        ? parseOutputsTokens(this.tokens, this.index, this.path)
        : parsePreviewTokens(this.tokens, this.index, this.path);
      if ('outputs' in res) outputs.push(...res.outputs);
      else previews.push(res.preview);
      this.index = res.nextIndex;
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
      ((this.checkWord('skeleton') || this.checkWord('motions')) && this.assignment())
    );
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
      while (!this.check('}') && !this.end()) {
        if (this.kebabAssignment()) {
          this.fail('asset.invalid-key', 'kebab-case property keys are forbidden; use snake_case.');
          this.recover();
        } else if (this.checkWord('import')) imports.push(this.importDecl());
        else if (this.unitDeclarationBlock(kind, outputs, previews)) continue;
        else if (assembly !== null && this.isAssemblyStatement()) {
          readAssemblyEntry(this.reader(), assembly);
        } else {
          const declaration = this.declaration(this.matchWord('export'));
          if (declaration !== null) declarations.push(declaration);
        }
      }
      const close = this.expect('}', 'Expected } to close a source unit.');
      if (assembly !== null) {
        this.count();
        declarations.push(
          buildAssemblyDecl(id.value, true, assembly, join(start.span, close.span)),
        );
      }
      return Object.freeze({
        kind,
        id: id.value,
        imports: Object.freeze(imports),
        declarations: Object.freeze(declarations),
        ...(kind === 'asset'
          ? { outputs: Object.freeze(outputs), previews: Object.freeze(previews) }
          : {}),
        span: join(start.span, close.span),
      }) as AssetSourceUnit;
    } finally {
      this.leave();
    }
  }

  parse(): AssetSourceUnit | null {
    const header = this.current();
    const version = this.tokens[this.index + 1];
    if (
      header.kind !== 'identifier' ||
      header.value !== 'ashfox' ||
      version?.kind !== 'number' ||
      version.value !== '1'
    ) {
      this.fail('asset.invalid-header', 'Expected "' + ASHFOX_ASSET_GRAMMAR + '".', header);
      return null;
    }
    this.take();
    this.take();
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
