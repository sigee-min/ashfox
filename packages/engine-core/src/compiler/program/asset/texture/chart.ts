import type {
  ProgramProperty,
  ProgramTextureChart,
  ProgramTextureDecl,
} from '../../../../project/program/syntax/contract';
import type { TypedSurfaceContract } from '../contract';
import type { AssetTextureUsage } from './contract';
import { properties, readTexelVector, type TextureExpressionContext } from './expressions';
import { hasChartOverlap } from './overlap';
import { readRole, type PaletteRole } from './palette';
import { boxRegions, type TextureRegion } from './raster';
import { integerContract, ownEntries, propertyIssue, type TextureReporter } from './report';

export interface PreparedChart {
  readonly chart: ProgramTextureChart;
  readonly abiWidth: number;
  readonly abiHeight: number;
  readonly origin: readonly [number, number];
  readonly regions: readonly TextureRegion[];
  readonly coverage: string | null;
}

const flatRegion = (width: number, height: number): TextureRegion =>
  Object.freeze({
    x: 0,
    y: 0,
    width,
    height,
    pointAt: (x: number, y: number) => [x, y, 0] as const,
  });

const usageMatches = (
  left: AssetTextureUsage['shape'],
  right: AssetTextureUsage['shape'],
): boolean =>
  left.kind === right.kind &&
  left.size.length === right.size.length &&
  left.size.every((value, index) => value === right.size[index]);

const boxChartRegions = (
  first: AssetTextureUsage,
  size: readonly [number, number, number],
  width: number,
  height: number,
  report: TextureReporter,
): readonly TextureRegion[] | null => {
  const expectedWidth = 2 * size[0] + 2 * size[2];
  const expectedHeight = size[1] + size[2];
  if (expectedWidth !== width || expectedHeight !== height) {
    report.report(
      first.span,
      'asset.texture.chart-size-mismatch',
      'Box geometry dimensions must equal the contract chart net dimensions.',
    );
    return null;
  }
  const regions = boxRegions(size);
  if (
    regions === null ||
    regions.some((region) => region.x + region.width > width || region.y + region.height > height)
  ) {
    report.report(
      first.span,
      'asset.texture.invalid-chart-layout',
      'Box chart face regions do not fit the declared chart rectangle.',
    );
    return null;
  }
  return regions;
};

const usageRegions = (
  chart: ProgramTextureChart,
  width: number,
  height: number,
  usages: readonly AssetTextureUsage[],
  report: TextureReporter,
): readonly TextureRegion[] | null => {
  const matches = usages; // Already grouped by chart within this preparation.
  if (matches.length === 0) {
    report.report(
      chart.span,
      'asset.texture.unused-chart',
      'Every texture chart must have a geometry usage with exact dimensions.',
    );
    return null;
  }
  const first = matches[0]!;
  if (matches.some((usage) => !usageMatches(first.shape, usage.shape))) {
    report.report(
      matches[1]!.span,
      'asset.texture.usage-mismatch',
      'A chart may be used more than once only with identical geometry dimensions.',
    );
    return null;
  }
  const shape = first.shape;
  if (shape.kind === 'flat') {
    if (shape.size[0] !== width || shape.size[1] !== height) {
      report.report(
        first.span,
        'asset.texture.chart-size-mismatch',
        'Flat geometry size must equal its contract chart dimensions.',
      );
      return null;
    }
    return Object.freeze([flatRegion(width, height)]);
  }
  return boxChartRegions(first, shape.size, width, height, report);
};

const chartCoverage = (
  chart: ProgramTextureChart,
  width: number,
  height: number,
  policy: 'opaque' | 'binary' | 'optional',
  report: TextureReporter,
): string | null => {
  const entries = chart.statements.filter((entry) => entry.kind === 'coverage');
  if (entries.length > 1) {
    report.report(
      entries[1]!.span,
      'asset.texture.duplicate-coverage',
      'A chart may declare coverage only once.',
    );
    return null;
  }
  const bits = entries[0]?.bits ?? null;
  if (policy === 'binary' && bits === null) {
    report.report(
      chart.span,
      'asset.texture.missing-coverage',
      'A binary chart requires a coverage payload.',
    );
    return null;
  }
  if (
    bits !== null &&
    (chart.layout !== 'flat' || !/^[01]+$/u.test(bits) || bits.length !== width * height)
  ) {
    report.report(
      entries[0]?.span ?? chart.span,
      'asset.texture.coverage-mismatch',
      'Coverage must be binary and contain exactly one bit per flat chart texel.',
    );
    return null;
  }
  if (policy === 'opaque' && bits !== null) {
    report.report(
      entries[0]!.span,
      'asset.texture.coverage-mismatch',
      'Opaque charts may not declare transparent coverage.',
    );
    return null;
  }
  return bits;
};

const readChartOriginAndFill = (
  chart: ProgramTextureChart,
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter,
): Readonly<{
  readonly origin: readonly [number, number];
  readonly originSpan: ProgramProperty['value']['span'];
}> | null => {
  const propertyEntries = chart.statements.filter(
    (entry): entry is ProgramProperty => entry.kind === 'property',
  );
  const entries = properties(
    propertyEntries,
    ['origin', 'fill'],
    chart.span,
    report.path,
    propertyIssue(report),
  );
  if (entries === null) return null;
  const originEntry = entries.get('origin');
  const fillEntry = entries.get('fill');
  if (originEntry === undefined || fillEntry === undefined) {
    report.report(
      chart.span,
      'asset.texture.missing-property',
      'Every chart requires origin and fill properties.',
    );
    return null;
  }
  const origin = readTexelVector(
    originEntry.value,
    context,
    2,
    report.path,
    propertyIssue(report),
    originEntry.span,
  );
  if (origin === null || origin[0]! < 0 || origin[1]! < 0) {
    report.report(
      originEntry.value.span,
      'asset.texture.invalid-origin',
      'Chart origin must be a non-negative integral texel coordinate.',
    );
    return null;
  }
  const selected = readRole(
    fillEntry.value,
    palette,
    true,
    report.path,
    propertyIssue(report),
    fillEntry.span,
  );
  if (selected === null) return null;
  return { origin: [origin[0]!, origin[1]!] as const, originSpan: originEntry.value.span };
};

const prepareChart = (
  chart: ProgramTextureChart,
  contractChart: TypedSurfaceContract['charts'][string],
  atlasWidth: number,
  atlasHeight: number,
  usages: readonly AssetTextureUsage[],
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter,
): PreparedChart | null => {
  if (chart.layout !== contractChart.layout) {
    report.report(
      chart.span,
      'asset.texture.chart-layout-mismatch',
      'Texture chart layout does not match its contract.',
    );
    return null;
  }
  const width = integerContract(contractChart.width, report, contractChart.span, 'Chart width');
  const height = integerContract(contractChart.height, report, contractChart.span, 'Chart height');
  if (width === null || height === null) return null;
  const placement = readChartOriginAndFill(chart, context, palette, report);
  const regions = usageRegions(chart, width, height, usages, report);
  if (placement === null || regions === null) return null;
  if (placement.origin[0] + width > atlasWidth || placement.origin[1] + height > atlasHeight) {
    report.report(
      placement.originSpan,
      'asset.texture.out-of-bounds',
      'Chart lies outside the permitted texture atlas.',
    );
    return null;
  }
  const coverage = chartCoverage(chart, width, height, contractChart.coverage, report);
  if (coverage === null && contractChart.coverage === 'binary') return null;
  return Object.freeze({
    chart,
    abiWidth: width,
    abiHeight: height,
    origin: placement.origin,
    regions,
    coverage,
  });
};

const groupBy = <T>(items: readonly T[], keyOf: (item: T) => string): ReadonlyMap<string, T[]> => {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const entries = result.get(key);
    if (entries) entries.push(item);
    else result.set(key, [item]);
  }
  return result;
};

const chartsOverlap = (a: PreparedChart, b: PreparedChart): boolean =>
  a.origin[0] < b.origin[0] + b.abiWidth &&
  b.origin[0] < a.origin[0] + a.abiWidth &&
  a.origin[1] < b.origin[1] + b.abiHeight &&
  b.origin[1] < a.origin[1] + a.abiHeight;

const reportChartOverlaps = (charts: readonly PreparedChart[], report: TextureReporter): void => {
  if (charts.length >= 32 && !hasChartOverlap(charts)) return;
  for (let left = 0; left < charts.length; left += 1) {
    for (let right = left + 1; right < charts.length; right += 1) {
      if (chartsOverlap(charts[left]!, charts[right]!)) {
        report.report(
          charts[right]!.chart.span,
          'asset.texture.overlap',
          'Texture chart rectangles may not overlap.',
        );
      }
    }
  }
};

/** Prepare and validate every contract-declared chart and check atlas rectangle overlap. */
export const prepareCharts = (
  payload: ProgramTextureDecl,
  contract: TypedSurfaceContract,
  atlasWidth: number,
  atlasHeight: number,
  usages: readonly AssetTextureUsage[],
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter,
): readonly PreparedChart[] | null => {
  const sources = payload.statements.filter(
    (entry): entry is ProgramTextureChart => entry.kind === 'chart',
  );
  const sourcesById = groupBy(sources, (source) => source.id);
  const usagesByChart = groupBy(usages, (usage) => usage.chart);
  const entries = ownEntries(contract.charts);
  const charts: PreparedChart[] = [];
  for (const [id, abi] of entries) {
    const matches = sourcesById.get(id) ?? [];
    if (matches.length !== 1) {
      report.report(
        matches[1]?.span ?? payload.span,
        'asset.texture.chart-count',
        'Texture must declare each contract chart exactly once.',
      );
      continue;
    }
    const chart = prepareChart(
      matches[0]!,
      abi,
      atlasWidth,
      atlasHeight,
      usagesByChart.get(id) ?? [],
      context,
      palette,
      report,
    );
    if (chart !== null) charts.push(chart);
  }
  for (const chart of sources) {
    if (contract.charts[chart.id] === undefined) {
      report.report(
        chart.span,
        'asset.texture.unknown-chart',
        'Texture chart is not declared by the surface contract.',
      );
    }
  }
  if (charts.length !== entries.length) return null;
  charts.sort((left, right) => left.chart.id.localeCompare(right.chart.id));
  reportChartOverlaps(charts, report);
  return Object.freeze(charts);
};
