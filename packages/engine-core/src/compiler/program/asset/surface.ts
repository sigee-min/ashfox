import type {
  ProgramExpr,
  ProgramProperty,
  ProgramTextureChart,
  ProgramTextureDecl,
} from '../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../project/source/contract';
import type { AssetUnloweredTextureSource, TypedChartAbi, TypedSurfaceContract } from './contract';

type SurfaceIssue = (path: string, span: SourceSpan, code: string, message: string) => void;

type ConcreteChart = {
  readonly layout: ProgramTextureChart['layout'];
  readonly coverage: string | null;
  readonly coverageSpan: SourceSpan | null;
  readonly origin: readonly [bigint, bigint] | null;
  readonly originSpan: SourceSpan;
  readonly span: SourceSpan;
};

const integer = (expression: ProgramExpr, unit: 'plain' | 'texel'): bigint | null => {
  if (expression.kind === 'unary') {
    const value = integer(expression.operand, unit);
    return value === null ? null : expression.operator === '-' ? -value : value;
  }
  if (expression.kind !== 'number' || expression.unit !== unit || expression.denominator === 0n)
    return null;
  const denominator =
    expression.denominator < 0n ? -expression.denominator : expression.denominator;
  const numerator = expression.denominator < 0n ? -expression.numerator : expression.numerator;
  return numerator % denominator === 0n ? numerator / denominator : null;
};

const property = (chart: ProgramTextureChart, name: string): ProgramProperty | null =>
  chart.statements.find(
    (entry): entry is ProgramProperty => entry.kind === 'property' && entry.name === name,
  ) ?? null;

const originOf = (
  chart: ProgramTextureChart,
): {
  readonly present: boolean;
  readonly value: readonly [bigint, bigint] | null;
  readonly span: SourceSpan;
} => {
  const entry = property(chart, 'origin');
  if (entry === null) return { present: false, value: null, span: chart.span };
  const value = entry.value;
  if (value.kind !== 'vector' || value.values.length !== 2) {
    return { present: true, value: null, span: entry.span };
  }
  const x = integer(value.values[0]!, 'texel');
  const y = integer(value.values[1]!, 'texel');
  return {
    present: true,
    value: x === null || y === null ? null : [x, y],
    span: entry.span,
  };
};

const sourceTexture = (source: AssetUnloweredTextureSource | null): ProgramTextureDecl | null =>
  source?.payload ?? null;

const chartMap = (
  texture: ProgramTextureDecl | null,
  path: string,
  ownerSpan: SourceSpan,
  issue: SurfaceIssue,
): Map<string, ConcreteChart> => {
  const charts = new Map<string, ConcreteChart>();
  for (const statement of texture?.statements ?? []) {
    if (statement.kind !== 'chart') continue;
    if (charts.has(statement.id))
      issue(
        path,
        statement.span,
        'asset.duplicate-chart',
        'Surface texture chart "' + statement.id + '" is declared more than once.',
      );
    const origin = originOf(statement);
    if (origin.present && origin.value === null)
      issue(
        path,
        origin.span,
        'asset.invalid-chart-origin',
        'Surface chart origins require exactly two integral texel coordinates.',
      );
    const coverages = statement.statements.filter((child) => child.kind === 'coverage');
    if (coverages.length > 1)
      issue(
        path,
        coverages[1]!.span,
        'asset.chart-coverage-mismatch',
        'A chart may declare coverage only once.',
      );
    charts.set(statement.id, {
      layout: statement.layout,
      coverage: coverages[0]?.bits ?? null,
      coverageSpan: coverages[0]?.span ?? null,
      origin: origin.value,
      originSpan: origin.span,
      span: statement.span,
    });
  }
  if (texture === null)
    issue(
      path,
      ownerSpan,
      'asset.missing-surface-texture',
      'A concrete surface must directly own an explicit texture payload.',
    );
  return charts;
};

const chartDimension = (value: NonNullable<TypedChartAbi['width']>): bigint => {
  if (value.value.unit !== 'texel' || value.value.denominator !== 1n) {
    throw new Error('Typed chart dimensions must be integral texel values.');
  }
  return value.value.numerator;
};

/** Validate the one structural texture payload against its typed surface ABI. */
export const validateConcreteSurfaceCharts = (
  source: AssetUnloweredTextureSource | null,
  definition: TypedSurfaceContract,
  path: string,
  ownerSpan: SourceSpan,
  issue: SurfaceIssue,
): void => {
  const charts = chartMap(sourceTexture(source), path, ownerSpan, issue);
  const texture = sourceTexture(source);
  for (const chart of Object.values(definition.charts)) {
    const concrete = charts.get(chart.id);
    if (concrete === undefined) {
      issue(
        path,
        source?.span ?? ownerSpan,
        'asset.missing-chart',
        'Surface texture is missing ABI chart "' + chart.id + '".',
      );
      continue;
    }
    validateChartPair(chart, concrete, definition, path, issue);
  }
  for (const [id, concrete] of charts) {
    if (definition.charts[id] === undefined)
      issue(
        path,
        concrete.span,
        'asset.unknown-chart',
        'Surface texture declares chart "' + id + '" outside its ABI.',
      );
  }
  if (texture !== null && texture.statements.length === 0)
    issue(
      path,
      texture.span,
      'asset.missing-chart',
      'Surface texture must contain its ABI charts.',
    );
};

const validateChartBounds = (
  chart: TypedChartAbi,
  concrete: ConcreteChart,
  definition: TypedSurfaceContract,
  path: string,
  issue: SurfaceIssue,
): void => {
  if (concrete.origin === null) return;
  if (concrete.origin[0] < 0n || concrete.origin[1] < 0n) {
    issue(
      path,
      concrete.originSpan,
      'asset.chart-out-of-bounds',
      'Surface chart "' + chart.id + '" lies outside its contract atlas.',
    );
    return;
  }
  if (chart.width === null || chart.height === null || definition.atlas === null) return;
  const width = chartDimension(chart.width);
  const height = chartDimension(chart.height);
  const atlasWidth = chartDimension(definition.atlas.width);
  const atlasHeight = chartDimension(definition.atlas.height);
  if (concrete.origin[0] + width > atlasWidth || concrete.origin[1] + height > atlasHeight) {
    issue(
      path,
      concrete.originSpan,
      'asset.chart-out-of-bounds',
      'Surface chart "' + chart.id + '" lies outside its contract atlas.',
    );
  }
};

const validateChartPair = (
  chart: TypedChartAbi,
  concrete: ConcreteChart,
  definition: TypedSurfaceContract,
  path: string,
  issue: SurfaceIssue,
): void => {
  if (concrete.layout !== chart.layout)
    issue(
      path,
      concrete.span,
      'asset.chart-layout-mismatch',
      'Surface chart "' + chart.id + '" has the wrong layout.',
    );
  validateChartBounds(chart, concrete, definition, path, issue);
  if (chart.coverage === 'binary' && concrete.coverage === null)
    issue(
      path,
      concrete.span,
      'asset.missing-coverage',
      'Binary chart "' + chart.id + '" requires an explicit coverage payload.',
    );
  if (concrete.coverage !== null && concrete.layout !== 'flat') {
    issue(
      path,
      concrete.coverageSpan ?? concrete.span,
      'asset.chart-coverage-mismatch',
      'Chart coverage must be flat and contain exactly one bit per ABI texel.',
    );
  } else if (
    concrete.coverage !== null &&
    chart.width !== null &&
    chart.height !== null &&
    BigInt(concrete.coverage.length) !== chartDimension(chart.width) * chartDimension(chart.height)
  ) {
    issue(
      path,
      concrete.coverageSpan ?? concrete.span,
      'asset.chart-coverage-mismatch',
      'Chart coverage must be flat and contain exactly one bit per ABI texel.',
    );
  }
  if (chart.coverage === 'opaque' && concrete.coverage !== null)
    issue(
      path,
      concrete.coverageSpan ?? concrete.span,
      'asset.chart-coverage-mismatch',
      'Opaque chart "' + chart.id + '" cannot declare transparent coverage.',
    );
};
