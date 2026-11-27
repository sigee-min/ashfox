import type {
  TextureAlphaMask,
  TextureCanvasDetail,
  TexturePbrMaterial,
} from '../../../../model/texture';
import {
  applyCurvatureOklch,
  bakeChartCurvatureMask,
  type ChartCurvatureMask,
} from '../../../../textures/curvature';
import { computeBentAoForChart, type TextureSceneContext } from './ao';
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
): number | null => {
  if (compose.prepared.tone === 'voxel') applyVoxelTone(grid, chart.regions);
  else if (compose.prepared.tone === 'painterly') applyPainterlyTone(grid, chart.regions);
  applyAoToGrid(grid);
  const seed = readGrainSeed(compose.prepared, compose.context, compose.report);
  if (seed === null) return null;
  const ok = applyGrainModes(
    grid,
    chart.regions,
    modeFor,
    seed,
    owner,
    compose.report.path,
    compose.prepared.grain.span,
    propertyIssue(compose.report),
  );
  return ok ? seed : null;
};

const RELIEF_PATTERNS: ReadonlySet<string> = new Set(['stripe', 'edge']);

const hasReliefStatement = (
  statements: readonly PreparedChart['chart']['statements'][number][],
): boolean =>
  statements.some(
    (stmt) =>
      stmt.kind === 'stamp' ||
      (stmt.kind === 'pattern' && RELIEF_PATTERNS.has(stmt.algorithm)) ||
      (stmt.kind === 'face' && hasReliefStatement(stmt.statements)),
  );

const hasChartReliefSignal = (chart: PreparedChart, grid: PaintGrid): boolean => {
  if (hasReliefStatement(chart.chart.statements)) return true;
  for (let i = 0; i < grid.fixed.length; i += 1) {
    if (grid.fixed[i]! > 0) return true;
  }
  return false;
};

const splitDetailWithCurvature = (
  detail: TextureCanvasDetail,
  origin: readonly [number, number],
  chartWidth: number,
  grid: PaintGrid,
  curvature: ChartCurvatureMask,
  edgeWear: number,
  out: TextureCanvasDetail[],
): void => {
  const lx0 = detail.x - origin[0];
  const ly = detail.y - origin[1];
  let runStart = 0;
  let runColor = '';
  for (let dx = 0; dx < detail.width; dx += 1) {
    const idx = ly * chartWidth + lx0 + dx;
    const color =
      grid.fixed[idx] !== 0
        ? detail.color
        : applyCurvatureOklch(
            detail.color,
            curvature.convex[idx]!,
            curvature.concave[idx]!,
            edgeWear,
          );
    if (dx === 0) {
      runColor = color;
    } else if (color !== runColor) {
      out.push(
        Object.freeze({
          ...detail,
          id: `${detail.id}:${runStart}`,
          color: runColor,
          x: detail.x + runStart,
          width: dx - runStart,
        }),
      );
      runStart = dx;
      runColor = color;
    }
  }
  out.push(
    Object.freeze({
      ...detail,
      id: runStart === 0 ? detail.id : `${detail.id}:${runStart}`,
      color: runColor,
      x: detail.x + runStart,
      width: detail.width - runStart,
    }),
  );
};

const applyCurvatureToDetails = (
  details: readonly TextureCanvasDetail[],
  origin: readonly [number, number],
  chartWidth: number,
  grid: PaintGrid,
  curvature: ChartCurvatureMask | undefined,
  edgeWear: number,
): readonly TextureCanvasDetail[] => {
  if (edgeWear <= 0 || curvature === undefined) return details;
  const out: TextureCanvasDetail[] = [];
  for (const detail of details) {
    splitDetailWithCurvature(detail, origin, chartWidth, grid, curvature, edgeWear, out);
  }
  return Object.freeze(out);
};

const buildChartCurvature = (
  chartKey: string,
  chart: PreparedChart,
  grid: PaintGrid,
  scene: TextureSceneContext | undefined,
): ChartCurvatureMask | undefined => {
  if (chart.pbr.edgeWear <= 0) return undefined;
  const bentAo = computeBentAoForChart(
    chartKey,
    chart.abiWidth,
    chart.abiHeight,
    chart.regions,
    scene,
  );
  return bakeChartCurvatureMask(
    chart.abiWidth,
    chart.abiHeight,
    chart.regions.map((r) => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      isBoxFace: chart.chart.layout === 'box',
      density: r.density,
    })),
    grid.ao,
    bentAo,
  );
};

const composeChartDetailsAndMask = (
  chart: PreparedChart,
  grid: PaintGrid,
  compose: ComposeContext,
  owner: string,
): Readonly<{
  readonly details: readonly TextureCanvasDetail[];
  readonly mask: TextureAlphaMask | null;
  readonly curvature: ChartCurvatureMask | undefined;
}> | null => {
  const rawDetails = gridDetails(
    grid,
    owner,
    chart.origin[0],
    chart.origin[1],
    compose.report.path,
    chart.chart.span,
    propertyIssue(compose.report),
  );
  if (rawDetails === null) return null;
  const chartKey = `${compose.surfaceKey}\u0000${chart.chart.id}`;
  const curvature = buildChartCurvature(chartKey, chart, grid, compose.scene);
  const details = applyCurvatureToDetails(
    rawDetails,
    chart.origin,
    chart.abiWidth,
    grid,
    curvature,
    chart.pbr.edgeWear,
  );
  const mask =
    chart.coverage === null
      ? null
      : maskFor(`${owner}:coverage`, chart.origin, chart.abiWidth, chart.abiHeight, chart.coverage);
  return { details, mask, curvature };
};

/** Apply coverage, pre-grain telemetry snapshot, tone/grain passes, curvature, details, mask, and PBR grid. */
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
  const hasRelief = hasChartReliefSignal(chart, grid);
  const seed = applyToneAndGrain(grid, chart, modeFor, compose, owner);
  if (seed === null) return null;
  const composed = composeChartDetailsAndMask(chart, grid, compose, owner);
  if (composed === null) return null;
  return Object.freeze({
    details: composed.details,
    mask: composed.mask,
    telemetry,
    pbrGrid: {
      origin: chart.origin,
      width: chart.abiWidth,
      height: chart.abiHeight,
      pbr: chart.pbr,
      grid,
      regions: chart.regions,
      regionGrainModes: chart.regions.map(modeFor),
      baseRoleId,
      seed,
      hasRelief,
      ...(composed.curvature ? { curvature: composed.curvature } : {}),
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
  const pbr = synthesizeAtlasPbr(
    prepared.width,
    prepared.height,
    pbrGrids,
    prepared.defaultPbr,
    prepared.renderMode,
  );
  return Object.freeze({
    details: Object.freeze(details),
    masks: Object.freeze(masks),
    charts: Object.freeze(charts),
    chartTelemetry: Object.freeze(chartTelemetry),
    ...(pbr ? { pbr } : {}),
  });
};
