import type {
  TextureAlphaMask,
  TextureCanvasDetail,
  TexturePbrMaterial,
} from '../../../../model/texture';
import type { TextureSceneContext } from './ao';
import type { PreparedChart } from './chart';
import type { AssetTextureChartPlan } from './contract';
import { readInteger, type TextureExpressionContext } from './expressions';
import { applyGrainModes, applyVoxelTone, type GrainMode } from './grain';
import { synthesizeAtlasPbr, type ChartPbrGridEntry } from './pbr';
import type { PreparedTexture } from './prepare';
import {
  applyAoToGrid,
  detailBudgetAllows,
  gridDetails,
  maskFor,
  type PaintGrid,
  type TextureRegion,
} from './raster';
import { propertyIssue, type TextureReporter } from './report';
import { snapshotChartPreGrain, type ChartAuthoringTelemetry } from './telemetry';
import { applyPainterlyTone } from './tone';

export interface ComposeContext {
  readonly surfaceKey: string;
  readonly prepared: PreparedTexture;
  readonly context: TextureExpressionContext;
  readonly scene: TextureSceneContext | undefined;
  readonly report: TextureReporter;
  readonly usedStamps: Set<string>;
}

const applyChartCoverage = (grid: PaintGrid, coverage: string): void => {
  for (let index = 0; index < coverage.length; index += 1) {
    if (coverage[index] === '0') {
      grid.fixed[index] = 1;
      grid.values[index] = 0;
      grid.tones[index] = 0;
    }
  }
};

const readGrainSeed = (
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  report: TextureReporter,
): number | null => {
  const seed =
    prepared.grain.seed === null
      ? 0n
      : readInteger(
          prepared.grain.seed.value,
          context,
          'plain',
          report.path,
          propertyIssue(report),
          prepared.grain.seed.span,
        );
  if (seed === null || seed < 0n || seed > 0xffffffffn) {
    report.report(
      prepared.grain.seed?.value.span ?? prepared.grain.span,
      'asset.texture.invalid-grain',
      'Grain seed must be an unsigned 32-bit integer.',
    );
    return null;
  }
  return Number(seed);
};

const applyToneAndGrain = (
  grid: PaintGrid,
  chart: PreparedChart,
  modeFor: (region: TextureRegion) => GrainMode,
  compose: ComposeContext,
  owner: string,
): boolean => {
  if (compose.prepared.tone === 'voxel') applyVoxelTone(grid, chart.regions);
  else if (compose.prepared.tone === 'painterly') applyPainterlyTone(grid, chart.regions);
  applyAoToGrid(grid);
  const seed = readGrainSeed(compose.prepared, compose.context, compose.report);
  if (seed === null) return false;
  return applyGrainModes(
    grid,
    chart.regions,
    modeFor,
    seed,
    owner,
    compose.report.path,
    compose.prepared.grain.span,
    propertyIssue(compose.report),
  );
};

/** Apply coverage, pre-grain telemetry snapshot, tone/grain passes, details, mask, and PBR grid. */
export const finalizeChartResult = (
  chart: PreparedChart,
  grid: PaintGrid,
  baseRoleId: number,
  faceGrain: ReadonlyMap<TextureRegion, GrainMode>,
  chartGrain: GrainMode | undefined,
  compose: ComposeContext,
  owner: string,
): Readonly<{
  readonly details: readonly TextureCanvasDetail[];
  readonly mask: TextureAlphaMask | null;
  readonly telemetry: ChartAuthoringTelemetry;
  readonly pbrGrid: ChartPbrGridEntry;
}> | null => {
  if (chart.coverage !== null) applyChartCoverage(grid, chart.coverage);
  const fallbackGrain = chartGrain ?? compose.prepared.grain.algorithm;
  const modeFor = (region: TextureRegion): GrainMode => faceGrain.get(region) ?? fallbackGrain;
  const telemetry = snapshotChartPreGrain(
    chart.chart.id,
    chart.chart.layout,
    grid,
    chart.regions,
    baseRoleId,
    modeFor,
  );
  if (!applyToneAndGrain(grid, chart, modeFor, compose, owner)) return null;
  const details = gridDetails(
    grid,
    owner,
    chart.origin[0],
    chart.origin[1],
    compose.report.path,
    chart.chart.span,
    propertyIssue(compose.report),
  );
  if (details === null) return null;
  const mask =
    chart.coverage === null
      ? null
      : maskFor(`${owner}:coverage`, chart.origin, chart.abiWidth, chart.abiHeight, chart.coverage);
  return Object.freeze({
    details,
    mask,
    telemetry,
    pbrGrid: {
      origin: chart.origin,
      width: chart.abiWidth,
      height: chart.abiHeight,
      pbr: chart.pbr,
      grid,
    },
  });
};

/** Enforce detail budget and synthesize the atlas PBR material output. */
export const finalizeAtlasOutput = (
  prepared: PreparedTexture,
  details: readonly TextureCanvasDetail[],
  masks: readonly TextureAlphaMask[],
  charts: Readonly<Record<string, AssetTextureChartPlan>>,
  chartTelemetry: readonly ChartAuthoringTelemetry[],
  pbrGrids: readonly ChartPbrGridEntry[],
  report: TextureReporter,
): Readonly<{
  readonly details: readonly TextureCanvasDetail[];
  readonly masks: readonly TextureAlphaMask[];
  readonly charts: Readonly<Record<string, AssetTextureChartPlan>>;
  readonly chartTelemetry: readonly ChartAuthoringTelemetry[];
  readonly pbr?: TexturePbrMaterial;
}> | null => {
  if (!detailBudgetAllows(details, masks, report.path, report.owner, propertyIssue(report)))
    return null;
  const pbr = synthesizeAtlasPbr(prepared.width, prepared.height, pbrGrids, prepared.defaultPbr);
  return Object.freeze({
    details: Object.freeze(details),
    masks: Object.freeze(masks),
    charts: Object.freeze(charts),
    chartTelemetry: Object.freeze(chartTelemetry),
    ...(pbr ? { pbr } : {}),
  });
};
