import type {
  ProgramProperty,
  ProgramTextureChart,
} from '../../../../project/program/syntax/contract';
import type { TextureAlphaMask, TextureCanvasDetail } from '../../../../model/texture';
import type { TextureSceneContext } from './ao';
import type { PreparedChart } from './chart';
import type { AssetTextureChartPlan } from './contract';
import { readInteger, type TextureExpressionContext } from './expressions';
import { applyFaceFill, copyMirroredFace, readGrainModeProperty } from './face';
import { applyGrainModes, applyVoxelTone, type GrainMode } from './grain';
import { readRole } from './palette';
import { applyPatternStatement } from './pattern';
import type { PreparedTexture } from './prepare';
import {
  applyAoToGrid,
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
import { snapshotChartPreGrain, type ChartAuthoringTelemetry } from './telemetry';
import { applyPainterlyTone } from './tone';

type ChartStatement = ProgramTextureChart['statements'][number];
type FaceStatement = Extract<ChartStatement, { kind: 'face' }>;
type StampStatement = Extract<ChartStatement, { kind: 'stamp' }>;

interface ComposeContext {
  readonly surfaceKey: string;
  readonly prepared: PreparedTexture;
  readonly context: TextureExpressionContext;
  readonly scene: TextureSceneContext | undefined;
  readonly report: TextureReporter;
  readonly usedStamps: Set<string>;
}

interface ChartRunState {
  readonly chart: ProgramTextureChart;
  readonly regions: readonly TextureRegion[];
  readonly grid: PaintGrid;
  readonly faceSeen: Set<string>;
  readonly faceGrain: Map<TextureRegion, GrainMode>;
  readonly deferredMirrors: {
    readonly statement: FaceStatement;
    readonly region: TextureRegion;
    readonly prop: ProgramProperty;
  }[];
  stampSeen: boolean;
}

const applyStampStatement = (
  statement: StampStatement,
  chart: ProgramTextureChart,
  regions: readonly TextureRegion[],
  compose: ComposeContext,
  grid: PaintGrid,
  root: boolean,
): boolean => {
  if (chart.layout === 'box' && root) {
    compose.report.report(
      statement.span,
      'asset.texture.invalid-scope',
      'Box stamp placement must belong to a face scope.',
    );
    return false;
  }
  const region = regions[0];
  if (region === undefined) return false;
  compose.usedStamps.add(statement.id);
  stampUse(
    statement,
    region,
    compose.prepared.stamps,
    compose.context,
    compose.prepared.palette,
    grid,
    compose.report,
  );
  return true;
};

const runOneStatement = (
  statement: ChartStatement,
  state: ChartRunState,
  regions: readonly TextureRegion[],
  compose: ComposeContext,
  root: boolean,
): boolean => {
  if (statement.kind === 'property') return true;
  if (statement.kind === 'coverage') {
    if (!root) {
      compose.report.report(
        statement.span,
        'asset.texture.invalid-face',
        'Coverage belongs only to chart scope.',
      );
      return false;
    }
    return true;
  }
  if (statement.kind === 'pattern') {
    return applyPatternStatement(
      statement,
      `${compose.surfaceKey}\u0000${state.chart.id}`,
      state.chart.id,
      state.stampSeen,
      regions,
      compose.prepared,
      compose.context,
      state.grid,
      compose.scene,
      compose.report,
    );
  }
  if (statement.kind === 'stamp') {
    state.stampSeen = true;
    return applyStampStatement(statement, state.chart, regions, compose, state.grid, root);
  }
  if (statement.kind === 'face') return applyFaceStatement(statement, state, compose, root);
  return true;
};

const runSubStatements = (
  statements: readonly ChartStatement[],
  state: ChartRunState,
  regions: readonly TextureRegion[],
  compose: ComposeContext,
  root: boolean,
): boolean => {
  let valid = true;
  for (const statement of statements) {
    if (!runOneStatement(statement, state, regions, compose, root)) valid = false;
  }
  return valid;
};

const validateFaceProps = (
  statement: FaceStatement,
  region: TextureRegion,
  state: ChartRunState,
  compose: ComposeContext,
): Readonly<{ readonly ok: boolean; readonly mirror: ProgramProperty | undefined }> => {
  const props = statement.statements.filter(
    (entry): entry is ProgramProperty => entry.kind === 'property',
  );
  const byName = new Map<string, ProgramProperty>();
  for (const prop of props) {
    if (byName.has(prop.name)) {
      compose.report.report(
        prop.span,
        'asset.texture.duplicate-property',
        `Duplicate face property "${prop.name}".`,
      );
      return { ok: false, mirror: undefined };
    }
    byName.set(prop.name, prop);
  }
  const grain = readGrainModeProperty(statement.statements, compose.report);
  if (grain === null) return { ok: false, mirror: undefined };
  if (grain !== undefined) state.faceGrain.set(region, grain);
  const fillProp = byName.get('fill');
  if (
    fillProp !== undefined &&
    !applyFaceFill(fillProp, region, compose.prepared, state.grid, compose.report)
  ) {
    return { ok: false, mirror: undefined };
  }
  return { ok: true, mirror: byName.get('mirror') };
};

const applyFaceStatement = (
  statement: FaceStatement,
  state: ChartRunState,
  compose: ComposeContext,
  root: boolean,
): boolean => {
  if (state.chart.layout !== 'box' || !root) {
    compose.report.report(
      statement.span,
      'asset.texture.invalid-scope',
      'Face scopes are only valid inside box charts.',
    );
    return false;
  }
  if (state.faceSeen.has(statement.direction)) {
    compose.report.report(
      statement.span,
      'asset.texture.duplicate-face',
      'A box chart may declare each face scope only once.',
    );
    return false;
  }
  state.faceSeen.add(statement.direction);
  const region = state.regions.find((candidate) => candidate.direction === statement.direction);
  if (region === undefined) {
    compose.report.report(
      statement.span,
      'asset.texture.invalid-scope',
      'Box face has no geometry-owned region.',
    );
    return false;
  }
  const checked = validateFaceProps(statement, region, state, compose);
  if (!checked.ok) return false;
  if (checked.mirror !== undefined) {
    state.deferredMirrors.push({ statement, region, prop: checked.mirror });
    return true;
  }
  return runSubStatements(statement.statements, state, [region], compose, false);
};

const applyDeferredMirrors = (state: ChartRunState, compose: ComposeContext): boolean => {
  const mirroredDirs = new Set(state.deferredMirrors.map((entry) => entry.statement.direction));
  for (const item of state.deferredMirrors) {
    const srcName = item.prop.value.kind === 'name' ? item.prop.value.value : '';
    if (mirroredDirs.has(srcName as FaceStatement['direction'])) {
      compose.report.report(
        item.prop.value.span,
        'asset.texture.invalid-mirror',
        'Face mirror cannot target another mirrored face.',
      );
      return false;
    }
    if (
      !copyMirroredFace(
        item.prop,
        item.statement.direction,
        item.region,
        state.regions,
        state.grid,
        compose.report,
      )
    ) {
      return false;
    }
    if (!runSubStatements(item.statement.statements, state, [item.region], compose, false))
      return false;
  }
  return true;
};

const fillChartBase = (
  chart: PreparedChart,
  compose: ComposeContext,
): Readonly<{ readonly grid: PaintGrid; readonly baseRoleId: number }> | null => {
  const grid = createPaintGrid(chart.abiWidth, chart.abiHeight, compose.prepared.palette);
  const fillEntry = chart.chart.statements.find(
    (entry) => entry.kind === 'property' && entry.name === 'fill',
  );
  if (fillEntry === undefined || fillEntry.kind !== 'property') return null;
  const selected = readRole(
    fillEntry.value,
    compose.prepared.palette,
    true,
    compose.report.path,
    propertyIssue(compose.report),
    fillEntry.span,
  );
  const selectedId = selected === null ? null : roleId(grid, selected.name);
  if (selectedId === null) return null;
  fill(grid, 0, 0, chart.abiWidth, chart.abiHeight, selectedId, 2);
  return { grid, baseRoleId: selectedId };
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

const applyChart = (
  chart: PreparedChart,
  compose: ComposeContext,
  owner: string,
): Readonly<{
  readonly details: readonly TextureCanvasDetail[];
  readonly mask: TextureAlphaMask | null;
  readonly telemetry: ChartAuthoringTelemetry;
}> | null => {
  const base = fillChartBase(chart, compose);
  if (base === null) return null;
  const chartGrain = readGrainModeProperty(chart.chart.statements, compose.report);
  if (chartGrain === null) return null;
  const state: ChartRunState = {
    chart: chart.chart,
    regions: chart.regions,
    grid: base.grid,
    faceSeen: new Set<string>(),
    faceGrain: new Map<TextureRegion, GrainMode>(),
    deferredMirrors: [],
    stampSeen: false,
  };
  if (
    !runSubStatements(chart.chart.statements, state, chart.regions, compose, true) ||
    compose.report.bad
  )
    return null;
  if (!applyDeferredMirrors(state, compose) || compose.report.bad) return null;
  if (chart.coverage !== null) applyChartCoverage(base.grid, chart.coverage);
  const fallbackGrain = chartGrain ?? compose.prepared.grain.algorithm;
  const modeFor = (region: TextureRegion): GrainMode =>
    state.faceGrain.get(region) ?? fallbackGrain;
  const telemetry = snapshotChartPreGrain(
    chart.chart.id,
    chart.chart.layout,
    base.grid,
    chart.regions,
    base.baseRoleId,
    modeFor,
  );
  if (!applyToneAndGrain(base.grid, chart, modeFor, compose, owner)) return null;
  const details = gridDetails(
    base.grid,
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
      : maskFor(owner + ':coverage', chart.origin, chart.abiWidth, chart.abiHeight, chart.coverage);
  return Object.freeze({ details, mask, telemetry });
};

const reportUnusedStamps = (
  stamps: PreparedTexture['stamps'],
  usedStamps: ReadonlySet<string>,
  report: TextureReporter,
): boolean => {
  let unused = false;
  for (const [name, stamp] of stamps) {
    if (usedStamps.has(name)) continue;
    report.report(
      stamp.span ?? report.owner,
      'asset.texture.unused-stamp',
      `Stamp "${name}" is declared but never placed on any chart or face.`,
    );
    unused = true;
  }
  return unused;
};

/** Compose all prepared charts into canonical canvas details, masks, and pre-grain telemetry. */
export const composeTextureCharts = (
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  owner: string,
  report: TextureReporter,
  surfaceKey = owner,
  scene?: TextureSceneContext,
): Readonly<{
  readonly details: readonly TextureCanvasDetail[];
  readonly masks: readonly TextureAlphaMask[];
  readonly charts: Readonly<Record<string, AssetTextureChartPlan>>;
  readonly chartTelemetry: readonly ChartAuthoringTelemetry[];
}> | null => {
  const details: TextureCanvasDetail[] = [];
  const masks: TextureAlphaMask[] = [];
  const chartTelemetry: ChartAuthoringTelemetry[] = [];
  const charts = Object.create(null) as Record<string, AssetTextureChartPlan>;
  const compose: ComposeContext = {
    surfaceKey,
    prepared,
    context,
    scene,
    report,
    usedStamps: new Set<string>(),
  };
  for (const chart of prepared.charts) {
    const result = applyChart(chart, compose, owner + ':' + chart.chart.id);
    if (result === null) return null;
    for (const detail of result.details) details.push(detail);
    if (result.mask !== null) masks.push(result.mask);
    chartTelemetry.push(result.telemetry);
    charts[chart.chart.id] = Object.freeze({
      id: chart.chart.id,
      layout: chart.chart.layout,
      origin: chart.origin,
      width: chart.abiWidth,
      height: chart.abiHeight,
      density: prepared.density,
      coverage: chart.coverage,
      span: chart.chart.span,
    });
  }
  if (reportUnusedStamps(prepared.stamps, compose.usedStamps, report)) return null;
  if (!detailBudgetAllows(details, masks, report.path, report.owner, propertyIssue(report)))
    return null;
  return Object.freeze({
    details: Object.freeze(details),
    masks: Object.freeze(masks),
    charts: Object.freeze(charts),
    chartTelemetry: Object.freeze(chartTelemetry),
  });
};
