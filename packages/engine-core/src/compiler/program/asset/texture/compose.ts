import type { ProgramTextureChart } from '../../../../project/program/syntax/contract';
import type { TextureAlphaMask, TextureCanvasDetail } from '../../../../model/texture';
import type { PreparedChart } from './chart';
import type { AssetTextureChartPlan } from './contract';
import { readInteger, type TextureExpressionContext } from './expressions';
import { applyGrain, applyVoxelTone } from './grain';
import { readRole } from './palette';
import { applyPatternStatement } from './pattern';
import type { PreparedTexture } from './prepare';
import {
  createPaintGrid,
  detailBudgetAllows,
  fill,
  gridDetails,
  maskFor,
  roleId,
  type PaintGrid,
  type TextureRegion,
} from './raster';
import { propertyIssue, type TextureReporter } from './report';
import { stampUse } from './stamp';

type ChartStatement = ProgramTextureChart['statements'][number];
type FaceStatement = Extract<ChartStatement, { kind: 'face' }>;
type StampStatement = Extract<ChartStatement, { kind: 'stamp' }>;

const reportScopePropertyIssue = (statement: ChartStatement, report: TextureReporter): void => {
  if (statement.kind === 'coverage') {
    report.report(
      statement.span,
      'asset.texture.invalid-face',
      'Coverage belongs only to chart scope.',
    );
  } else {
    report.report(
      statement.span,
      'asset.texture.invalid-face',
      'Face scopes may not contain chart properties.',
    );
  }
};

const applyStampStatement = (
  statement: StampStatement,
  chart: ProgramTextureChart,
  regions: readonly TextureRegion[],
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  report: TextureReporter,
  root: boolean,
): boolean => {
  if (chart.layout === 'box' && root) {
    report.report(
      statement.span,
      'asset.texture.invalid-scope',
      'Box stamp placement must belong to a face scope.',
    );
    return false;
  }
  const region = regions[0];
  if (region === undefined) return false;
  stampUse(statement, region, prepared.stamps, context, prepared.palette, grid, report);
  return true;
};

const applyFaceStatement = (
  statement: FaceStatement,
  chart: ProgramTextureChart,
  regions: readonly TextureRegion[],
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  report: TextureReporter,
  root: boolean,
  faceSeen: Set<string>,
): boolean => {
  if (chart.layout !== 'box' || !root) {
    report.report(
      statement.span,
      'asset.texture.invalid-scope',
      'Face scopes are only valid inside box charts.',
    );
    return false;
  }
  if (faceSeen.has(statement.direction)) {
    report.report(
      statement.span,
      'asset.texture.duplicate-face',
      'A box chart may declare each face scope only once.',
    );
    return false;
  }
  faceSeen.add(statement.direction);
  const region = regions.find((candidate) => candidate.direction === statement.direction);
  if (region === undefined) {
    report.report(
      statement.span,
      'asset.texture.invalid-scope',
      'Box face has no geometry-owned region.',
    );
    return false;
  }
  return chartStatements(
    statement.statements,
    chart,
    [region],
    prepared,
    context,
    grid,
    report,
    false,
  );
};

interface ChartStatementState {
  stampSeen: boolean;
  readonly faceSeen: Set<string>;
}

const applyChartStatement = (
  statement: ChartStatement,
  state: ChartStatementState,
  chart: ProgramTextureChart,
  regions: readonly TextureRegion[],
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  report: TextureReporter,
  root: boolean,
): boolean => {
  if (statement.kind === 'property' || statement.kind === 'coverage') {
    if (root) return true;
    reportScopePropertyIssue(statement, report);
    return false;
  }
  if (statement.kind === 'pattern') {
    return applyPatternStatement(
      statement,
      state.stampSeen,
      regions,
      prepared,
      context,
      grid,
      report,
    );
  }
  if (statement.kind === 'stamp') {
    state.stampSeen = true;
    return applyStampStatement(statement, chart, regions, prepared, context, grid, report, root);
  }
  if (statement.kind === 'face') {
    return applyFaceStatement(
      statement,
      chart,
      regions,
      prepared,
      context,
      grid,
      report,
      root,
      state.faceSeen,
    );
  }
  report.report(
    chart.span,
    'asset.texture.invalid-statement',
    'Texture chart statement is malformed.',
  );
  return false;
};

const chartStatements = (
  statements: readonly ChartStatement[],
  chart: ProgramTextureChart,
  regions: readonly TextureRegion[],
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  report: TextureReporter,
  root: boolean,
): boolean => {
  let valid = true;
  const state: ChartStatementState = { stampSeen: false, faceSeen: new Set<string>() };
  for (const statement of statements) {
    if (
      !applyChartStatement(statement, state, chart, regions, prepared, context, grid, report, root)
    ) {
      valid = false;
    }
  }
  return valid;
};

const fillChartBase = (
  chart: PreparedChart,
  prepared: PreparedTexture,
  report: TextureReporter,
): PaintGrid | null => {
  const grid = createPaintGrid(chart.abiWidth, chart.abiHeight, prepared.palette);
  const fillEntry = chart.chart.statements.find(
    (entry) => entry.kind === 'property' && entry.name === 'fill',
  );
  if (fillEntry === undefined || fillEntry.kind !== 'property') return null;
  const selected = readRole(
    fillEntry.value,
    prepared.palette,
    true,
    report.path,
    propertyIssue(report),
    fillEntry.span,
  );
  const selectedId = selected === null ? null : roleId(grid, selected.name);
  if (selectedId === null) return null;
  fill(grid, 0, 0, chart.abiWidth, chart.abiHeight, selectedId, 2);
  return grid;
};

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
      'Clustered grain seed must be an unsigned 32-bit integer.',
    );
    return null;
  }
  return Number(seed);
};

const applyChart = (
  chart: PreparedChart,
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  owner: string,
  report: TextureReporter,
): Readonly<{
  readonly details: readonly TextureCanvasDetail[];
  readonly mask: TextureAlphaMask | null;
}> | null => {
  const grid = fillChartBase(chart, prepared, report);
  if (grid === null) return null;
  const composed = chartStatements(
    chart.chart.statements,
    chart.chart,
    chart.regions,
    prepared,
    context,
    grid,
    report,
    true,
  );
  if (!composed || report.bad) return null;
  if (chart.coverage !== null) applyChartCoverage(grid, chart.coverage);
  if (prepared.tone) applyVoxelTone(grid, chart.regions);
  const seed = readGrainSeed(prepared, context, report);
  if (seed === null) return null;
  if (
    !applyGrain(
      grid,
      chart.regions,
      seed,
      owner,
      report.path,
      prepared.grain.span,
      propertyIssue(report),
    )
  ) {
    return null;
  }
  const details = gridDetails(
    grid,
    owner,
    chart.origin[0],
    chart.origin[1],
    report.path,
    chart.chart.span,
    propertyIssue(report),
  );
  if (details === null) return null;
  const mask =
    chart.coverage === null
      ? null
      : maskFor(owner + ':coverage', chart.origin, chart.abiWidth, chart.abiHeight, chart.coverage);
  return Object.freeze({ details, mask });
};

/** Compose all prepared charts into canonical canvas details and alpha masks. */
export const composeTextureCharts = (
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  owner: string,
  report: TextureReporter,
): Readonly<{
  readonly details: readonly TextureCanvasDetail[];
  readonly masks: readonly TextureAlphaMask[];
  readonly charts: Readonly<Record<string, AssetTextureChartPlan>>;
}> | null => {
  const details: TextureCanvasDetail[] = [];
  const masks: TextureAlphaMask[] = [];
  const charts = Object.create(null) as Record<string, AssetTextureChartPlan>;
  for (const chart of prepared.charts) {
    const result = applyChart(chart, prepared, context, owner + ':' + chart.chart.id, report);
    if (result === null) return null;
    for (const detail of result.details) details.push(detail);
    if (result.mask !== null) masks.push(result.mask);
    charts[chart.chart.id] = Object.freeze({
      id: chart.chart.id,
      layout: chart.chart.layout,
      origin: chart.origin,
      width: chart.abiWidth,
      height: chart.abiHeight,
      coverage: chart.coverage,
      span: chart.chart.span,
    });
  }
  if (!detailBudgetAllows(details, masks, report.path, report.owner, propertyIssue(report)))
    return null;
  return Object.freeze({
    details: Object.freeze(details),
    masks: Object.freeze(masks),
    charts: Object.freeze(charts),
  });
};
