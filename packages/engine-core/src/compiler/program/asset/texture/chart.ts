import type {
  ProgramProperty,
  ProgramTextureChart,
  ProgramTextureDecl,
} from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import { compareText } from '../../../../stableOrder';
import type { TypedSurfaceContract } from '../contract';
import type { AssetTextureUsage } from './contract';
import { properties, readTexelVector, type TextureExpressionContext } from './expressions';
import { hasChartOverlap } from './overlap';
import { packCharts } from './pack';
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

export interface PreparedChartLayout {
  readonly atlas: readonly [number, number];
  readonly charts: readonly PreparedChart[];
}

interface DraftChart {
  readonly chart: ProgramTextureChart;
  readonly abiWidth: number;
  readonly abiHeight: number;
  readonly origin: readonly [number, number] | null;
  readonly originSpan: SourceSpan;
  readonly regions: readonly TextureRegion[];
  readonly coverage: string | null;
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

const readChartOriginAndFill = (
  chart: ProgramTextureChart,
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter,
): Readonly<{
  readonly origin: readonly [number, number] | null;
  readonly originSpan: SourceSpan;
}> | null => {
  const propertyEntries = chart.statements.filter(
    (entry): entry is ProgramProperty => entry.kind === 'property',
  );
  const entries = properties(
    propertyEntries,
    ['origin', 'fill', 'grain'],
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
  if (selected === null) return null;
  const originEntry = entries.get('origin');
  if (originEntry === undefined) return { origin: null, originSpan: chart.span };
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
  return { origin: [origin[0]!, origin[1]!] as const, originSpan: originEntry.value.span };
};

const prepareDraftChart = (
  chart: ProgramTextureChart,
  contractChart: TypedSurfaceContract['charts'][string],
  density: 1 | 2 | 4,
  usages: readonly AssetTextureUsage[],
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
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
  const placement = readChartOriginAndFill(chart, context, palette, report);
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
  };
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

const pow2AtLeast = (value: number): number => {
  let size = 16;
  while (size < value && size < 4096) size *= 2;
  return size;
};

const resolveExplicitOrigins = (
  drafts: readonly DraftChart[],
  explicitAtlas: readonly [number, number] | null,
  report: TextureReporter,
): PreparedChartLayout | null => {
  const maxRight = Math.max(...drafts.map((d) => d.origin![0] + d.abiWidth), 16);
  const maxBottom = Math.max(...drafts.map((d) => d.origin![1] + d.abiHeight), 16);
  const atlas: readonly [number, number] =
    explicitAtlas ?? ([pow2AtLeast(maxRight), pow2AtLeast(maxBottom)] as const);
  if (maxRight > 4096 || maxBottom > 4096 || atlas[0] * atlas[1] > 4096 * 4096) {
    report.report(
      drafts[0]!.originSpan,
      'asset.texture.out-of-bounds',
      'Charts exceed the maximum atlas dimensions.',
    );
    return null;
  }
  const charts: PreparedChart[] = [];
  for (const draft of drafts) {
    if (
      draft.origin![0] + draft.abiWidth > atlas[0] ||
      draft.origin![1] + draft.abiHeight > atlas[1]
    ) {
      report.report(
        draft.originSpan,
        'asset.texture.out-of-bounds',
        'Chart lies outside the permitted texture atlas.',
      );
      return null;
    }
    charts.push(
      Object.freeze({
        chart: draft.chart,
        abiWidth: draft.abiWidth,
        abiHeight: draft.abiHeight,
        origin: draft.origin!,
        regions: draft.regions,
        coverage: draft.coverage,
      }),
    );
  }
  reportChartOverlaps(charts, report);
  return Object.freeze({ atlas, charts: Object.freeze(charts) });
};

const finalizeChartPlacement = (
  drafts: readonly DraftChart[],
  explicitAtlas: readonly [number, number] | null,
  payloadSpan: SourceSpan,
  report: TextureReporter,
): PreparedChartLayout | null => {
  if (drafts.length === 0) {
    return Object.freeze({
      atlas: explicitAtlas ?? ([16, 16] as const),
      charts: Object.freeze([]),
    });
  }
  const withOrigin = drafts.filter((d) => d.origin !== null);
  const withoutOrigin = drafts.filter((d) => d.origin === null);
  if (withOrigin.length > 0 && withoutOrigin.length > 0) {
    report.report(
      withOrigin[0]!.originSpan,
      'asset.texture.mixed-origin',
      'Charts in one texture must either all declare origin or all omit origin for auto-packing.',
    );
    return null;
  }
  const sorted = [...drafts].sort((left, right) => compareText(left.chart.id, right.chart.id));
  if (withoutOrigin.length === 0) return resolveExplicitOrigins(sorted, explicitAtlas, report);
  const packed = packCharts(
    sorted.map((d) => ({ id: d.chart.id, width: d.abiWidth, height: d.abiHeight })),
    explicitAtlas,
  );
  if (packed === null) {
    report.report(
      payloadSpan,
      'asset.texture.out-of-bounds',
      'Auto-packed charts do not fit within the permitted texture atlas.',
    );
    return null;
  }
  const charts = sorted.map((draft) =>
    Object.freeze({
      chart: draft.chart,
      abiWidth: draft.abiWidth,
      abiHeight: draft.abiHeight,
      origin: packed.origins.get(draft.chart.id)!,
      regions: draft.regions,
      coverage: draft.coverage,
    }),
  );
  return Object.freeze({ atlas: packed.atlas, charts: Object.freeze(charts) });
};

/** Prepare and validate every contract-declared chart, auto-packing when origins are omitted. */
export const prepareCharts = (
  payload: ProgramTextureDecl,
  contract: TypedSurfaceContract,
  explicitAtlas: readonly [number, number] | null,
  density: 1 | 2 | 4,
  usages: readonly AssetTextureUsage[],
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter,
): PreparedChartLayout | null => {
  const sources = payload.statements.filter(
    (entry): entry is ProgramTextureChart => entry.kind === 'chart',
  );
  const sourcesById = groupBy(sources, (source) => source.id);
  const usagesByChart = groupBy(usages, (usage) => usage.chart);
  const entries = ownEntries(contract.charts);
  const drafts: DraftChart[] = [];
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
    const draft = prepareDraftChart(
      matches[0]!,
      abi,
      density,
      usagesByChart.get(id) ?? [],
      context,
      palette,
      report,
    );
    if (draft !== null) drafts.push(draft);
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
  if (drafts.length !== entries.length) return null;
  return finalizeChartPlacement(drafts, explicitAtlas, payload.span, report);
};
