import type {
  ProgramProperty,
  ProgramTextureChart,
} from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import type { TypedSurfaceContract } from '../contract';
import type { AssetTextureUsage } from './contract';
import { properties, readTexelVector, type TextureExpressionContext } from './expressions';
import { readRole, type PaletteRole } from './palette';
import { readPbrProperties, type ChartPbrSettings } from './pbr';
import { boxRegions, type TextureRegion } from './raster';
import { integerContract, propertyIssue, type TextureReporter } from './report';

export interface DraftChart {
  readonly chart: ProgramTextureChart;
  readonly abiWidth: number;
  readonly abiHeight: number;
  readonly origin: readonly [number, number] | null;
  readonly originSpan: SourceSpan;
  readonly regions: readonly TextureRegion[];
  readonly coverage: string | null;
  readonly pbr: ChartPbrSettings;
}

const flatRegion = (width: number, height: number, density: 1 | 2 | 4): TextureRegion =>
  Object.freeze({
    x: 0,
    y: 0,
    width,
    height,
    density,
    pointAt: (x: number, y: number) => [x, y, 0] as const,
  });

const usageMatches = (
  left: AssetTextureUsage['shape'],
  right: AssetTextureUsage['shape'],
): boolean =>
  left.kind === right.kind &&
  left.size.length === right.size.length &&
  left.size.every((value, index) => value === right.size[index]);

const resolvedDimensions = (
  chart: ProgramTextureChart,
  abi: TypedSurfaceContract['charts'][string],
  density: 1 | 2 | 4,
  first: AssetTextureUsage,
  report: TextureReporter,
): readonly [number, number] | null => {
  const shape = first.shape;
  if (shape.kind !== chart.layout) {
    report.report(
      first.span,
      'asset.texture.chart-layout-mismatch',
      'Geometry usage shape must match its chart layout.',
    );
    return null;
  }
  const inferred: readonly [number, number] =
    shape.kind === 'flat'
      ? [shape.size[0] * density, shape.size[1] * density]
      : [
          (2 * shape.size[0] + 2 * shape.size[2]) * density,
          (shape.size[1] + shape.size[2]) * density,
        ];
  if (abi.width === null || abi.height === null) return inferred;
  const width = integerContract(abi.width, report, abi.span, 'Chart width');
  const height = integerContract(abi.height, report, abi.span, 'Chart height');
  if (width === null || height === null) return null;
  if (width !== inferred[0] || height !== inferred[1]) {
    report.report(
      first.span,
      'asset.texture.chart-size-mismatch',
      shape.kind === 'flat'
        ? 'Flat geometry size must equal its contract chart dimensions.'
        : 'Box geometry dimensions must equal the contract chart net dimensions.',
    );
    return null;
  }
  return [width, height] as const;
};

const resolveRegions = (
  chart: ProgramTextureChart,
  abi: TypedSurfaceContract['charts'][string],
  density: 1 | 2 | 4,
  usages: readonly AssetTextureUsage[],
  report: TextureReporter,
): Readonly<{
  readonly width: number;
  readonly height: number;
  readonly regions: readonly TextureRegion[];
}> | null => {
  if (usages.length === 0) {
    report.report(
      chart.span,
      'asset.texture.unused-chart',
      'Every texture chart must have a geometry usage with exact dimensions.',
    );
    return null;
  }
  const first = usages[0]!;
  if (usages.some((usage) => !usageMatches(first.shape, usage.shape))) {
    report.report(
      usages[1]!.span,
      'asset.texture.usage-mismatch',
      'A chart may be used more than once only with identical geometry dimensions.',
    );
    return null;
  }
  const dims = resolvedDimensions(chart, abi, density, first, report);
  if (dims === null) return null;
  const [width, height] = dims;
  if (first.shape.kind === 'flat')
    return { width, height, regions: Object.freeze([flatRegion(width, height, density)]) };
  const regions = boxRegions(first.shape.size, density);
  if (regions === null || regions.some((r) => r.x + r.width > width || r.y + r.height > height)) {
    report.report(
      first.span,
      'asset.texture.invalid-chart-layout',
      'Box chart face regions do not fit the declared chart rectangle.',
    );
    return null;
  }
  return { width, height, regions };
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

const parseChartOrigin = (
  entries: ReadonlyMap<
    string,
    { readonly value: ProgramProperty['value']; readonly span: SourceSpan }
  >,
  defaultSpan: SourceSpan,
  context: TextureExpressionContext,
  report: TextureReporter,
): Readonly<{
  readonly origin: readonly [number, number] | null;
  readonly originSpan: SourceSpan;
}> | null => {
  const originEntry = entries.get('origin');
  if (originEntry === undefined) return { origin: null, originSpan: defaultSpan };
  const origin = readTexelVector(
    originEntry.value,
    context,
    2,
    report.path,
    propertyIssue(report),
    originEntry.span,
  );
  if (origin !== null && origin[0]! >= 0 && origin[1]! >= 0) {
    return { origin: [origin[0]!, origin[1]!] as const, originSpan: originEntry.value.span };
  }
  report.report(
    originEntry.value.span,
    'asset.texture.invalid-origin',
    'Chart origin must be a non-negative integral texel coordinate.',
  );
  return null;
};

const readChartOriginAndFill = (
  chart: ProgramTextureChart,
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  defaultPbr: ChartPbrSettings,
  report: TextureReporter,
): Readonly<{
  readonly origin: readonly [number, number] | null;
  readonly originSpan: SourceSpan;
  readonly pbr: ChartPbrSettings;
}> | null => {
  const propertyEntries = chart.statements.filter(
    (entry): entry is ProgramProperty => entry.kind === 'property',
  );
  const entries = properties(
    propertyEntries,
    ['origin', 'fill', 'grain', 'roughness', 'metallic', 'roughness_variation'],
    chart.span,
    report.path,
    propertyIssue(report),
  );
  if (entries === null) return null;
  const fillEntry = entries.get('fill');
  if (fillEntry === undefined) {
    report.report(
      chart.span,
      'asset.texture.missing-property',
      'Every chart requires a fill property.',
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
  const pbr = readPbrProperties(entries, defaultPbr, context, report);
  if (selected === null || pbr === null) return null;
  const parsed = parseChartOrigin(entries, chart.span, context, report);
  return parsed === null ? null : { ...parsed, pbr };
};

/** Validate and resolve regions, coverage, origin, fill, and PBR settings for one chart. */
export const prepareDraftChart = (
  chart: ProgramTextureChart,
  contractChart: TypedSurfaceContract['charts'][string],
  density: 1 | 2 | 4,
  usages: readonly AssetTextureUsage[],
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  defaultPbr: ChartPbrSettings,
  report: TextureReporter,
): DraftChart | null => {
  if (chart.layout !== contractChart.layout) {
    report.report(
      chart.span,
      'asset.texture.chart-layout-mismatch',
      'Texture chart layout does not match its contract.',
    );
    return null;
  }
  const resolved = resolveRegions(chart, contractChart, density, usages, report);
  const placement = readChartOriginAndFill(chart, context, palette, defaultPbr, report);
  if (resolved === null || placement === null) return null;
  const coverage = chartCoverage(
    chart,
    resolved.width,
    resolved.height,
    contractChart.coverage,
    report,
  );
  if (coverage === null && contractChart.coverage === 'binary') return null;
  return {
    chart,
    abiWidth: resolved.width,
    abiHeight: resolved.height,
    origin: placement.origin,
    originSpan: placement.originSpan,
    regions: resolved.regions,
    coverage,
    pbr: placement.pbr,
  };
};
