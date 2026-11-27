import type {
  ProgramTextureChart,
  ProgramTextureDecl,
} from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import { compareText } from '../../../../stableOrder';
import type { TypedSurfaceContract } from '../contract';
import { prepareDraftChart, type DraftChart } from './chartPatterns';
import type { AssetTextureUsage } from './contract';
import type { TextureExpressionContext } from './expressions';
import { hasChartOverlap } from './overlap';
import { packCharts } from './pack';
import type { PaletteRole } from './palette';
import type { ChartPbrSettings } from './pbr';
import type { TextureRegion } from './raster';
import { ownEntries, type TextureReporter } from './report';

export interface PreparedChart {
  readonly chart: ProgramTextureChart;
  readonly abiWidth: number;
  readonly abiHeight: number;
  readonly origin: readonly [number, number];
  readonly regions: readonly TextureRegion[];
  readonly coverage: string | null;
  readonly pbr: ChartPbrSettings;
}

export interface PreparedChartLayout {
  readonly atlas: readonly [number, number];
  readonly charts: readonly PreparedChart[];
}

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
        pbr: draft.pbr,
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
      pbr: draft.pbr,
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
  defaultPbr: ChartPbrSettings,
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
      defaultPbr,
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
