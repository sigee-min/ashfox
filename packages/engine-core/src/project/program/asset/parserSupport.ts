import type { ProgramExpr } from '../syntax/contract';
import type { ProgramToken } from '../syntax/lex';
import type { SourceSpan } from '../../source/contract';
import { docsHint, formatDidYouMean, toSnakeCaseTrap } from '../../source/suggest';
import { compareText } from '../../../stableOrder';
import {
  parseOutputsTokens,
  parsePreviewTokens,
  type RawDeclaredOutput,
  type RawDeclaredPreview,
} from '../../directory/declarations';
import {
  ASHFOX_ASSET_GRAMMAR,
  type AssetDeclaration,
  type AssetDiagnostic,
  type AssetFrameDecl,
  type AssetImportDecl,
  type AssetPropertyDecl,
  type AssetQualifiedName,
  type AssetSourceParseResult,
  type AssetSourceUnit,
  type AssetValueType,
} from './contract';

export type Token = ProgramToken;
export class ParserAbort extends Error {}

export interface AssetReader {
  readonly current: () => Token;
  readonly end: () => boolean;
  readonly take: () => Token;
  readonly prevSpan: () => SourceSpan;
  readonly nextIsWord: (value: string) => boolean;
  readonly check: (value: string) => boolean;
  readonly match: (value: string) => boolean;
  readonly checkWord: (value: string) => boolean;
  readonly fail: (code: string, message: string, token?: Token, hint?: string) => void;
  readonly failSpan: (code: string, message: string, span: SourceSpan, hint?: string) => void;
  readonly expect: (value: string, message: string) => Token;
  readonly expectWord: (value: string, message: string) => Token;
  readonly enter: (token?: Token) => void;
  readonly leave: () => void;
  readonly abort: () => never;
  readonly recover: () => void;
  readonly scopeError: (scope: string) => void;
  readonly id: (message?: string) => Token;
  readonly qualified: (message?: string) => AssetQualifiedName;
  readonly expression: () => ProgramExpr;
  readonly assignment: () => boolean;
  readonly finish: () => void;
  readonly finishEnd: () => SourceSpan;
  readonly word: (message: string) => string;
  readonly name: (message?: string) => string;
  readonly block: <T>(read: () => T) => T[];
  readonly blockEnd: () => SourceSpan;
  readonly valueType: () => AssetValueType;
}

export const join = (left: SourceSpan, right: SourceSpan): SourceSpan =>
  Object.freeze({ start: left.start, end: right.end });

export const valueName = (value: ProgramExpr): string | null =>
  value.kind === 'name' ? value.value : null;

/** Name of an optional value, or `fallback` when the value is absent. */
export const nameOr = (value: ProgramExpr | undefined, fallback: string): string | null =>
  value === undefined ? fallback : valueName(value);

/** Value of the first property declared under `name`. */
export const propertyValue = (
  values: readonly { readonly name: string; readonly value: ProgramExpr }[],
  name: string,
): ProgramExpr | undefined => values.find((entry) => entry.name === name)?.value;

/** Narrows a raw name to one of the allowed literals. */
export const isOneOf = <T extends string>(
  allowed: readonly T[],
  value: string | null,
): value is T => value !== null && (allowed as readonly string[]).includes(value);

export const badName = (token: Token): boolean =>
  token.kind !== 'identifier' ||
  token.value.includes('$') ||
  token.value.includes('/') ||
  token.value.includes('.');

/** Builds a qualified name AST node from a dotted raw name. */
export const qualifiedFromName = (name: string | null, span: SourceSpan): AssetQualifiedName =>
  Object.freeze({
    kind: 'qualified-name',
    segments: Object.freeze(name?.split('.') ?? []),
    span,
  });

/** Reads `{ ... }` with nesting accounting until `}` or EOF and returns the closing token. */
export const readBraced = (
  reader: AssetReader,
  openMessage: string,
  closeMessage: string,
  body: () => void,
): Token => {
  reader.expect('{', openMessage);
  reader.enter();
  try {
    while (!reader.check('}') && !reader.end()) {
      body();
    }
    return reader.expect('}', closeMessage);
  } finally {
    reader.leave();
  }
};

export const isSnakeCase = (value: string): boolean => /^[a-z][a-z0-9_]*$/.test(value);

export const isAssignmentTokens = (tokens: readonly Token[], index: number): boolean => {
  if (tokens[index]?.kind !== 'identifier') return false;
  let next = index + 1;
  while (
    tokens[next]?.kind === 'symbol' &&
    tokens[next]?.value === '.' &&
    tokens[next + 1]?.kind === 'identifier'
  ) {
    next += 2;
  }
  return tokens[next]?.kind === 'symbol' && tokens[next]?.value === '=';
};

export const isKebabAssignmentTokens = (tokens: readonly Token[], index: number): boolean => {
  if (tokens[index]?.kind !== 'identifier') return false;
  let next = index + 1;
  let sawHyphen = false;
  while (
    tokens[next]?.kind === 'symbol' &&
    (tokens[next]?.value === '-' || tokens[next]?.value === '.') &&
    tokens[next + 1]?.kind === 'identifier'
  ) {
    if (tokens[next]?.value === '-') sawHyphen = true;
    next += 2;
  }
  return sawHyphen && tokens[next]?.kind === 'symbol' && tokens[next]?.value === '=';
};

const validatePropertySegment = (reader: AssetReader, token: Token): void => {
  if (isSnakeCase(token.value)) return;
  const snake = toSnakeCaseTrap(token.value);
  const didYouMean = snake !== null ? ` Did you mean "${snake}"?` : '';
  reader.failSpan(
    'asset.invalid-key',
    `Property key "${token.value}" must be snake_case in ashfox 1.${didYouMean}`,
    token.span,
    docsHint('model'),
  );
};

export const readProperty = (reader: AssetReader): AssetPropertyDecl => {
  const start = reader.current();
  const first = reader.id('Expected a property name.');
  validatePropertySegment(reader, first);
  let name = first.value;
  while (reader.match('.')) {
    const segment = reader.id();
    validatePropertySegment(reader, segment);
    name += '.' + segment.value;
  }
  reader.expect('=', 'Expected = in a property declaration.');
  const value = reader.expression();
  reader.finish();
  return Object.freeze({ kind: 'property', name, value, span: join(start.span, value.span) });
};

export const readProperties = (reader: AssetReader, scope: string): AssetPropertyDecl[] => {
  const values: AssetPropertyDecl[] = [];
  readBraced(
    reader,
    'Expected { to begin a property block.',
    'Expected } to close a property block.',
    () => {
      if (reader.assignment()) values.push(readProperty(reader));
      else reader.scopeError(scope);
    },
  );
  return values;
};

const scopeDomain = (scope: string): string => {
  if (scope.includes('rig') || scope.includes('socket') || scope.includes('bind')) return 'rig';
  if (scope.includes('surface') || scope.includes('chart')) return 'surface';
  if (scope.includes('motion')) return 'motion';
  return 'model';
};

export const checkClosedProperties = (
  reader: AssetReader,
  values: readonly AssetPropertyDecl[],
  allowed: readonly string[],
  scope: string,
  domain = scopeDomain(scope),
): void => {
  const seen = new Set<string>();
  for (const property of values) {
    if (!allowed.includes(property.name)) {
      reader.failSpan(
        'asset.invalid-property',
        `Property "${property.name}" is not allowed in ${scope}.${formatDidYouMean(property.name, allowed)}`,
        property.span,
        docsHint(domain),
      );
    } else if (seen.has(property.name)) {
      reader.failSpan(
        'asset.duplicate-property',
        'Property "' + property.name + '" is declared more than once in ' + scope + '.',
        property.span,
      );
    } else {
      seen.add(property.name);
    }
  }
};

export const readFrame = (reader: AssetReader): AssetFrameDecl => {
  const start = reader.expectWord('frame', 'Expected frame.');
  const values = readProperties(reader, 'frame');
  checkClosedProperties(reader, values, ['origin', 'x', 'y', 'z'], 'frame');
  return Object.freeze({
    kind: 'frame',
    properties: Object.freeze(values),
    span: join(start.span, reader.prevSpan()),
  });
};

export const frameOrNull = (
  values: readonly AssetPropertyDecl[],
  start: SourceSpan,
): AssetFrameDecl | null => {
  const axes = values.filter(
    (entry) => entry.name === 'x' || entry.name === 'y' || entry.name === 'z',
  );
  return axes.length === 0
    ? null
    : Object.freeze({
        kind: 'frame',
        properties: Object.freeze(axes),
        span: join(start, axes[axes.length - 1]!.span),
      });
};

export const readNamedAssignment = (reader: AssetReader, name: string): AssetQualifiedName => {
  const start = reader.current();
  reader.expectWord(name, 'Expected ' + name + '.');
  reader.expect('=', 'Expected = after ' + name + '.');
  const ref = reader.qualified('Expected a name after ' + name + '.');
  reader.finish();
  return Object.freeze({
    kind: 'qualified-name',
    segments: ref.segments,
    span: join(start.span, ref.span),
  });
};

export const HOOK_DECL_KINDS = new Set([
  'schema',
  'anchor',
  'volume',
  'cue',
  'meta',
  'zone',
  'mc_block',
]);

export const skipHookDeclaration = (reader: AssetReader): void => {
  let depth = 0;
  while (!reader.end()) {
    const tok = reader.take();
    if (tok.kind === 'symbol' && tok.value === '{') depth += 1;
    else if (tok.kind === 'symbol' && tok.value === '}') {
      if (depth <= 1) return;
      depth -= 1;
    } else if (tok.kind === 'symbol' && tok.value === ';' && depth === 0) return;
  }
};

export const readImportDecl = (reader: AssetReader, sourcePath: string): AssetImportDecl => {
  const start = reader.expectWord('import', 'Expected import.');
  const path = reader.current();
  if (path.kind !== 'string') {
    reader.fail('asset.invalid-import-path', 'Imports require a quoted relative path.', path);
  } else reader.take();
  reader.expectWord('as', 'Expected as after an import path.');
  const alias = reader.id('Expected an import alias.');
  reader.finish();
  return Object.freeze({
    kind: 'import',
    path: path.value,
    alias: alias.value,
    ref: Object.freeze({ path: sourcePath, span: path.span }),
    span: join(start.span, alias.span),
  });
};

/** Parses a `frame` block while diagnosing duplicate frames in the same declaration. */
export const readUniqueFrame = (
  reader: AssetReader,
  current: AssetFrameDecl | null,
): AssetFrameDecl => {
  if (current !== null) {
    reader.failSpan(
      'asset.duplicate-frame',
      'A declaration may contain only one frame.',
      reader.current().span,
    );
  }
  return readFrame(reader);
};

export const readKebabKeyName = (tokens: readonly Token[], index: number): string => {
  let end = index + 1;
  let raw = tokens[index]!.value;
  while (
    tokens[end]?.kind === 'symbol' &&
    (tokens[end]!.value === '-' || tokens[end]!.value === '.') &&
    tokens[end + 1]?.kind === 'identifier'
  ) {
    raw += tokens[end]!.value + tokens[end + 1]!.value;
    end += 2;
  }
  return raw;
};

export const applyUnitDeclarationTokens = (
  tokens: readonly Token[],
  index: number,
  path: string,
  isOutputs: boolean,
  outputs: RawDeclaredOutput[],
  previews: RawDeclaredPreview[],
): number => {
  const res = isOutputs
    ? parseOutputsTokens(tokens, index, path)
    : parsePreviewTokens(tokens, index, path);
  if ('outputs' in res) outputs.push(...res.outputs);
  else previews.push(res.preview);
  return res.nextIndex;
};

const UNIT_SCOPE_DECLS = [
  'design',
  'socket',
  'rig',
  'skeleton',
  'surface',
  'component',
  'motion',
  'anchor',
  'volume',
  'cue',
  'meta',
  'zone',
  'schema',
] as const;

export const unitScopeErrorMessage = (keyword: string): string =>
  `Statement "${keyword}" is not allowed in module or model unit scope.${formatDidYouMean(keyword, UNIT_SCOPE_DECLS)}`;

export const kebabKeyErrorMessage = (tokens: readonly Token[], index: number): string => {
  const snake = toSnakeCaseTrap(readKebabKeyName(tokens, index));
  const didYouMean = snake !== null ? ` Did you mean "${snake}"?` : '';
  return `kebab-case property keys are forbidden; use snake_case.${didYouMean}`;
};

export const freezeUnitDecl = (
  kind: AssetSourceUnit['kind'],
  id: string,
  imports: readonly AssetImportDecl[],
  declarations: readonly AssetDeclaration[],
  outputs: readonly RawDeclaredOutput[],
  previews: readonly RawDeclaredPreview[],
  span: SourceSpan,
): AssetSourceUnit =>
  Object.freeze({
    kind,
    id,
    imports: Object.freeze([...imports]),
    declarations: Object.freeze([...declarations]),
    ...(kind === 'asset'
      ? { outputs: Object.freeze([...outputs]), previews: Object.freeze([...previews]) }
      : {}),
    span,
  }) as AssetSourceUnit;

export const consumeAssetHeader = (
  tokens: readonly Token[],
  index: number,
  take: () => Token,
  fail: (code: string, message: string, token?: Token) => void,
): boolean => {
  const header = tokens[index] ?? tokens[tokens.length - 1]!;
  const version = tokens[index + 1];
  if (
    header.kind !== 'identifier' ||
    header.value !== 'ashfox' ||
    version?.kind !== 'number' ||
    version.value !== '1'
  ) {
    fail('asset.invalid-header', 'Expected "' + ASHFOX_ASSET_GRAMMAR + '".', header);
    return false;
  }
  take();
  take();
  return true;
};

/** Parses `outputs = [format, ...];` at model unit scope. */
export const readOutputsList = (reader: AssetReader, outputs: RawDeclaredOutput[]): void => {
  reader.take();
  reader.expect('=', 'Expected = after outputs.');
  reader.expect('[', 'Expected [ to begin outputs list.');
  while (!reader.check(']') && !reader.end()) {
    outputs.push({ format: reader.id('Expected output format name.').value, attributes: {} });
    if (!reader.match(',')) break;
  }
  reader.expect(']', 'Expected ] to close outputs list.');
  reader.finish();
};

/** Freezes the final `AssetSourceParseResult` with deterministically sorted diagnostics. */
export const buildParseResult = (
  path: string,
  source: string,
  unit: AssetSourceUnit | null,
  diagnostics: readonly AssetDiagnostic[],
): AssetSourceParseResult =>
  Object.freeze({
    path,
    source,
    grammar: ASHFOX_ASSET_GRAMMAR,
    unit: diagnostics.length > 0 ? null : unit,
    diagnostics: Object.freeze(
      [...diagnostics].sort(
        (a, b) => a.span.start.offset - b.span.start.offset || compareText(a.code, b.code),
      ),
    ),
  });
