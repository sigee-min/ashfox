import type { ProgramExpr } from '../syntax/contract';
import type { ProgramToken } from '../syntax/lex';
import type { SourceSpan } from '../../source/contract';
import type {
  AssetFrameDecl,
  AssetPropertyDecl,
  AssetQualifiedName,
  AssetValueType,
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
  readonly fail: (code: string, message: string, token?: Token) => void;
  readonly failSpan: (code: string, message: string, span: SourceSpan) => void;
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

export const readProperty = (reader: AssetReader): AssetPropertyDecl => {
  const start = reader.current();
  let name = reader.id('Expected a property name.').value;
  while (reader.match('-')) name += '-' + reader.id().value;
  while (reader.match('.')) {
    name += '.' + reader.id().value;
    while (reader.match('-')) name += '-' + reader.id().value;
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

export const checkClosedProperties = (
  reader: AssetReader,
  values: readonly AssetPropertyDecl[],
  allowed: readonly string[],
  scope: string,
): void => {
  const seen = new Set<string>();
  for (const property of values) {
    if (!allowed.includes(property.name)) {
      reader.failSpan(
        'asset.invalid-property',
        'Property "' + property.name + '" is not allowed in ' + scope + '.',
        property.span,
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
