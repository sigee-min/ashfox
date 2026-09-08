import type { SourceSpan } from '../../source/contract';
import type {
  ProgramChartStatement,
  ProgramExpr,
  ProgramProperty,
  ProgramTextureChart,
  ProgramTextureChartFace,
  ProgramTextureCoverage,
  ProgramTextureGrain,
  ProgramTexturePalette,
  ProgramTexturePattern,
  ProgramTextureStampDecl,
  ProgramTextureStampUse,
  ProgramTextureTone,
  ProgramTextureStatement
} from './contract';
import type { ProgramToken } from './lex';

type Token = ProgramToken;
type ChartLayout = ProgramTextureChart['layout'];
type FaceDirection = ProgramTextureChartFace['direction'];
type ChartScope = 'chart' | 'face';

const freeze = <T>(value: T): T => Object.freeze(value);
const join = (left: SourceSpan, right: SourceSpan): SourceSpan =>
  Object.freeze({ start: left.start, end: right.end });

export interface ProgramTextureReader {
  readonly current: () => Token;
  readonly take: () => Token;
  readonly checkWord: (value: string) => boolean;
  readonly expect: (value: string, message: string) => Token;
  readonly fail: (code: string, message: string, token?: Token) => void;
  readonly abort: () => never;
  readonly name: (message?: string) => string;
  readonly word: (message: string) => string;
  readonly expression: () => ProgramExpr;
  readonly finish: () => void;
  readonly finishEnd: () => SourceSpan;
  readonly block: <T>(read: () => T) => T[];
  readonly blockEnd: () => SourceSpan;
  readonly property: (scope: string) => ProgramProperty;
}

const invalidProperty = (reader: ProgramTextureReader, property: ProgramProperty,
  allowed: readonly string[], scope: string, token: Token): ProgramProperty => {
  if (!allowed.includes(property.name)) reader.fail('program.invalid-property',
    'Property "' + property.name + '" is not allowed in ' + scope + ' scope.',
    token);
  return property;
};

const grain = (reader: ProgramTextureReader): ProgramTextureGrain => {
  const start = reader.take();
  const algorithm = reader.word('Expected a grain algorithm.');
  if (algorithm !== 'clustered') reader.fail('program.invalid-grain',
    'Grain algorithm must be clustered.', start);
  const properties = reader.block(() => {
    const propertyStart = reader.current();
    const property = reader.property('grain');
    return invalidProperty(reader, property, ['seed'], 'grain', propertyStart);
  });
  const seen = new Set<string>();
  for (const property of properties) {
    if (seen.has(property.name)) reader.fail('program.duplicate-property',
      'Grain property "' + property.name + '" is declared more than once.', start);
    seen.add(property.name);
  }
  return freeze({ kind: 'grain', algorithm: 'clustered',
    seed: properties[0] ?? null, span: join(start.span, reader.blockEnd()) });
};

const tone = (reader: ProgramTextureReader): ProgramTextureTone => {
  const start = reader.take();
  const mode = reader.word('Expected a texture tone mode.');
  if (mode !== 'voxel') reader.fail('program.invalid-tone',
    'Texture tone mode must be voxel.', start);
  reader.finish();
  return freeze({ kind: 'tone', mode: 'voxel',
    span: join(start.span, reader.finishEnd()) });
};

const chartProperty = (reader: ProgramTextureReader, scope: ChartScope): ProgramProperty => {
  const start = reader.current();
  return invalidProperty(reader,
    reader.property(scope === 'face' ? 'chart-face' : 'chart'),
    scope === 'face' ? [] : ['origin', 'fill'],
    scope === 'face' ? 'chart face' : 'chart', start);
};

const coverage = (reader: ProgramTextureReader): ProgramTextureCoverage => {
  const start = reader.take();
  reader.expect('=', 'Expected = in chart coverage.');
  const bits = reader.current();
  reader.take();
  reader.finish();
  if (bits.kind !== 'number' || !/^[01]+$/u.test(bits.value)) reader.fail(
    'program.invalid-coverage', 'coverage bits must contain only 0 and 1.', bits);
  return freeze({ kind: 'coverage', bits: bits.value,
    span: join(start.span, bits.span) });
};

const pattern = (reader: ProgramTextureReader): ProgramTexturePattern => {
  const start = reader.take();
  const algorithm = reader.word('Expected a pattern algorithm.');
  if (algorithm !== 'blotch') reader.fail('program.invalid-pattern',
    'Pattern algorithm must be blotch.', start);
  const properties = reader.block(() => {
    const propertyStart = reader.current();
    const property = reader.property('pattern');
    return invalidProperty(reader, property,
      ['paint', 'scale', 'density', 'phase'], 'pattern', propertyStart);
  });
  return freeze({ kind: 'pattern', algorithm: 'blotch',
    properties: freeze(properties), span: join(start.span, reader.blockEnd()) });
};

const stampUse = (reader: ProgramTextureReader): ProgramTextureStampUse => {
  const start = reader.take();
  const id = reader.name('Expected a stamp name.');
  const properties = reader.block(() => {
    const propertyStart = reader.current();
    const property = reader.property('stamp');
    return invalidProperty(reader, property, ['at', 'anchor', 'offset', 'protect', 'flip'], 'stamp use', propertyStart);
  });
  return freeze({ kind: 'stamp', id, properties: freeze(properties),
    span: join(start.span, reader.blockEnd()) });
};

const stampMapping = (reader: ProgramTextureReader): ProgramProperty => {
  const start = reader.current();
  if (start.kind !== 'identifier' && start.kind !== 'number') {
    reader.fail('program.invalid-stamp',
      'Stamp mappings require one lowercase letter or digit.', start);
  }
  const symbol = reader.take();
  if (!/^[a-z0-9]$/u.test(symbol.value)) reader.fail('program.invalid-stamp',
    'Stamp mappings require one lowercase letter or digit.', symbol);
  reader.expect('=', 'Stamp mappings require symbol = palette-role.');
  const value = reader.expression();
  reader.finish();
  if (value.kind !== 'name') reader.fail('program.invalid-stamp',
    'Stamp mappings must name a palette role.', start);
  return freeze({ kind: 'property', name: symbol.value, value,
    span: join(start.span, value.span) });
};

const validateStamp = (reader: ProgramTextureReader, properties: readonly ProgramProperty[],
  span: SourceSpan, start: Token): void => {
  const pixels = properties.filter((property) => property.name === 'pixels');
  if (pixels.length !== 1 || pixels[0]!.value.kind !== 'string') {
    reader.fail('program.invalid-stamp',
      'Stamp requires exactly one pixels string.', start);
    return;
  }
  const rows = pixels[0]!.value.value.split('/');
  const width = rows[0]?.length ?? 0;
  if (width === 0 || rows.some((row) => row.length !== width ||
    !/^[.a-z0-9]+$/u.test(row))) {
    reader.fail('program.invalid-stamp',
      'Stamp pixels must be nonempty equal-width rows using . or lowercase symbols.',
      start);
    return;
  }
  const mappings = properties.filter((property) => property.name !== 'pixels');
  const seen = new Set<string>();
  for (const mapping of mappings) {
    if (seen.has(mapping.name)) reader.fail('program.duplicate-stamp-symbol',
      'Stamp symbol "' + mapping.name + '" is mapped more than once.', start);
    seen.add(mapping.name);
  }
  const symbols = new Set(rows.join('').replace(/\./gu, '').split('').filter(Boolean));
  for (const symbol of symbols) if (!seen.has(symbol)) reader.fail('program.invalid-stamp',
    'Stamp symbol "' + symbol + '" has no palette-role mapping.', start);
  for (const mapping of mappings) if (!symbols.has(mapping.name)) reader.fail(
    'program.invalid-stamp', 'Stamp mapping "' + mapping.name + '" is unused.', start);
  if (span.start.offset > span.end.offset) reader.fail('program.invalid-stamp',
    'Stamp span is invalid.', start);
};

const stampDeclaration = (reader: ProgramTextureReader): ProgramTextureStampDecl => {
  const start = reader.take();
  const id = reader.name('Expected a stamp name.');
  const properties = reader.block(() => reader.checkWord('pixels')
    ? reader.property('stamp') : stampMapping(reader));
  const span = join(start.span, reader.blockEnd());
  validateStamp(reader, properties, span, start);
  return freeze({ kind: 'stamp-decl', id, properties: freeze(properties), span });
};

const chartFace = (reader: ProgramTextureReader, layout: ChartLayout,
  claimed: Set<string> | null): ProgramTextureChartFace => {
  const start = reader.take();
  const direction = reader.word('Expected a box face direction.');
  if (!['north', 'south', 'east', 'west', 'up', 'down'].includes(direction)) {
    reader.fail('program.invalid-face', 'Unknown box face direction "' + direction + '".', start);
  }
  if (claimed?.has(direction)) reader.fail('program.duplicate-face',
    'Box chart face direction "' + direction + '" is declared more than once.', start);
  claimed?.add(direction);
  if (layout === 'flat') reader.fail('program.invalid-scope',
    'Face-local scopes are only allowed in box charts.', start);
  const statements = reader.block(() => chartStatement(reader, layout, 'face', null));
  return freeze({ kind: 'face', direction: direction as FaceDirection,
    statements: freeze(statements), span: join(start.span, reader.blockEnd()) });
};

const chartStatement = (reader: ProgramTextureReader, layout: ChartLayout,
  scope: ChartScope, claimed: Set<string> | null): ProgramChartStatement => {
  if (reader.checkWord('grain')) {
    reader.fail('program.invalid-scope',
      'Grain is only allowed directly in texture scope.', reader.current());
    return reader.abort();
  }
  if (reader.checkWord('pattern')) return pattern(reader);
  if (reader.checkWord('shade')) {
    reader.fail('program.retired-syntax',
      'Texture shade is retired; use texture-level tone voxel.', reader.current());
    return reader.abort();
  }
  if (reader.checkWord('stamp')) {
    if (layout === 'box' && scope === 'chart') reader.fail('program.invalid-scope',
      'Box charts require stamp placement inside a face-local scope.', reader.current());
    return stampUse(reader);
  }
  if (reader.checkWord('face')) {
    if (scope === 'face') {
      reader.fail('program.invalid-scope', 'Nested box face scopes are not allowed.');
      return chartFace(reader, layout, claimed);
    }
    return chartFace(reader, layout, claimed);
  }
  if (reader.checkWord('coverage')) {
    if (scope === 'face') reader.fail('program.invalid-scope',
      'Coverage is only allowed at chart scope.');
    return coverage(reader);
  }
  return chartProperty(reader, scope);
};

const chart = (reader: ProgramTextureReader): ProgramTextureChart => {
  const start = reader.take();
  const id = reader.name('Expected a chart name.');
  const layout = reader.word('Expected chart layout box or flat.');
  if (layout !== 'box' && layout !== 'flat') reader.fail('program.invalid-uv',
    'Chart layout must be box or flat.', start);
  const actualLayout: ChartLayout = layout === 'box' ? 'box' : 'flat';
  const directions = new Set<string>();
  const statements = reader.block(() => chartStatement(reader, actualLayout, 'chart', directions));
  return freeze({ kind: 'chart', id, layout: actualLayout,
    statements: freeze(statements), span: join(start.span, reader.blockEnd()) });
};

export const parseProgramTextureStatement = (
  reader: ProgramTextureReader
): ProgramTextureStatement => {
  if (reader.checkWord('palette')) {
    const start = reader.take();
    const properties = reader.block(() => reader.property('palette'));
    return freeze({ kind: 'palette', properties: freeze(properties),
      span: join(start.span, reader.blockEnd()) } satisfies ProgramTexturePalette);
  }
  if (reader.checkWord('chart')) return chart(reader);
  if (reader.checkWord('grain')) return grain(reader);
  if (reader.checkWord('tone')) return tone(reader);
  if (reader.checkWord('stamp')) return stampDeclaration(reader);
  if (reader.checkWord('shade')) {
    reader.fail('program.retired-syntax',
      'Texture shade is retired; use texture-level tone voxel.', reader.current());
    return reader.abort();
  }
  return reader.property('texture');
};
