import type {
  ProgramTextureChart
} from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import type { TextureAlphaMask, TextureCanvasDetail } from '../../../../model/texture';
import type { AssetTextureChartPlan, AssetTextureIssue } from './contract';
import {
  properties,
  readInteger,
  readRole,
  readTexelVector,
  type TextureExpressionContext
} from './expressions';
import {
  applyGrain,
  applyPattern,
  applyVoxelTone,
  createPaintGrid,
  detailBudgetAllows,
  fill,
  gridDetails,
  maskFor,
  roleId,
  type PaintGrid,
  type TextureRegion
} from './raster';
import { propertyIssue, type PreparedChart, type PreparedTexture, type TextureReporter } from './prepare';
import { stampUse } from './stamp';

const issueFrom = (report: TextureReporter): AssetTextureIssue =>
  (_path, span, code, message): void => report.report(span, code, message);

const chartStatements = (
  statements: readonly ProgramTextureChart['statements'][number][],
  chart: ProgramTextureChart,
  regions: readonly TextureRegion[],
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  report: TextureReporter,
  root: boolean
): boolean => {
  let valid = true; let stampSeen = false;
  const faceSeen = new Set<string>();
  for (const statement of statements) {
    if (statement.kind === 'property' || statement.kind === 'coverage') {
      if (statement.kind === 'coverage' && !root) {
        report.report(statement.span, 'asset.texture.invalid-face', 'Coverage belongs only to chart scope.');
        valid = false;
      } else if (statement.kind === 'property' && !root) {
        report.report(statement.span, 'asset.texture.invalid-face', 'Face scopes may not contain chart properties.');
        valid = false;
      }
      continue;
    }
    if (statement.kind === 'pattern') {
      if (stampSeen) {
        report.report(statement.span, 'asset.texture.order', 'Blotch patterns must precede stamp placement.');
        valid = false; continue;
      }
      const entries = properties(statement.properties, ['paint', 'scale', 'density', 'phase'],
        statement.span, report.path, propertyIssue(report));
      if (entries === null) { valid = false; continue; }
      const paint = entries.get('paint'); const scale = entries.get('scale');
      const density = entries.get('density'); const phase = entries.get('phase');
      if (paint === undefined || scale === undefined || density === undefined || phase === undefined) {
        report.report(statement.span, 'asset.texture.missing-property', 'Blotch pattern is incomplete.');
        valid = false; continue;
      }
      const selected = readRole(paint.value, prepared.palette, true, report.path,
        propertyIssue(report), paint.span);
      const scaleValue = readTexelScale(scale.value, context, report, scale.span);
      const densityValue = readRatioValue(density.value, context, report, density.span);
      const phaseValue = readInteger(phase.value, context, 'plain', report.path,
        propertyIssue(report), phase.span);
      if (selected === null || scaleValue === null || densityValue === null || phaseValue === null) {
        valid = false; continue;
      }
      if (scaleValue.some((value) => value < 1 || value > 128) || phaseValue < 0n || phaseValue > 0xffffffffn ||
        densityValue.numerator < 0n || densityValue.numerator > densityValue.denominator) {
        report.report(statement.span, 'asset.texture.invalid-pattern', 'Blotch settings are outside their closed bounds.');
        valid = false; continue;
      }
      const ok = applyPattern(grid, regions, { paint: selected.name, scale: scaleValue,
        density: densityValue, phase: Number(phaseValue) }, issueFrom(report), report.path, statement.span);
      if (!ok) valid = false;
      continue;
    }
    if (statement.kind === 'stamp') {
      stampSeen = true;
      if (chart.layout === 'box' && root) {
        report.report(statement.span, 'asset.texture.invalid-scope', 'Box stamp placement must belong to a face scope.');
        valid = false;
      } else {
        const region = regions[0];
        if (region === undefined) valid = false;
        else stampUse(statement, region, prepared.stamps, context, prepared.palette, grid, report);
      }
      continue;
    }
    if (statement.kind === 'face') {
      if (chart.layout !== 'box' || !root) {
        report.report(statement.span, 'asset.texture.invalid-scope', 'Face scopes are only valid inside box charts.');
        valid = false; continue;
      }
      if (faceSeen.has(statement.direction)) {
        report.report(statement.span, 'asset.texture.duplicate-face',
          'A box chart may declare each face scope only once.');
        valid = false; continue;
      }
      faceSeen.add(statement.direction);
      const region = regions.find((candidate) => candidate.direction === statement.direction);
      if (region === undefined) {
        report.report(statement.span, 'asset.texture.invalid-scope', 'Box face has no geometry-owned region.');
        valid = false; continue;
      }
      if (!chartStatements(statement.statements, chart, [region], prepared, context, grid, report, false)) valid = false;
      continue;
    }
    report.report(chart.span, 'asset.texture.invalid-statement', 'Texture chart statement is malformed.');
    valid = false;
  }
  return valid;
};

const readTexelScale = (
  expression: Parameters<typeof readTexelVector>[0],
  context: TextureExpressionContext,
  report: TextureReporter,
  fallback: SourceSpan
): readonly [number, number, number] | null => {
  if (expression.kind !== 'vector' || !Array.isArray(expression.values) || expression.values.length !== 3) {
    report.report(expression.span ?? fallback, 'asset.texture.invalid-vector', 'Pattern scale requires three texel scalars.');
    return null;
  }
  const result: number[] = [];
  for (const entry of expression.values) {
    const value = context.evaluate(entry, 'texel');
    if (value?.kind !== 'number' || value.value.unit !== 'texel' || value.value.denominator !== 1n) {
      report.report(entry.span, 'asset.texture.invalid-vector', 'Pattern scale requires integral texel scalars.');
      return null;
    }
    const converted = Number(value.value.numerator);
    if (!Number.isSafeInteger(converted)) {
      report.report(entry.span, 'asset.texture.invalid-vector', 'Pattern scale exceeds the safe texel range.');
      return null;
    }
    result.push(converted);
  }
  return [result[0]!, result[1]!, result[2]!] as const;
};

const readRatioValue = (
  expression: Parameters<typeof readTexelVector>[0],
  context: TextureExpressionContext,
  report: TextureReporter,
  fallback: SourceSpan
): Readonly<{ readonly numerator: bigint; readonly denominator: bigint }> | null => {
  const value = context.evaluate(expression, 'ratio');
  if (value?.kind !== 'number' || value.value.unit !== 'ratio' || value.value.denominator <= 0n) {
    report.report(expression.span ?? fallback, 'asset.texture.invalid-ratio', 'Pattern density requires a ratio.');
    return null;
  }
  return { numerator: value.value.numerator, denominator: value.value.denominator };
};

const applyChart = (
  chart: PreparedChart,
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  owner: string,
  report: TextureReporter
): Readonly<{ readonly details: readonly TextureCanvasDetail[]; readonly mask: TextureAlphaMask | null }> | null => {
  const grid = createPaintGrid(chart.abiWidth, chart.abiHeight, prepared.palette);
  const fillEntry = chart.chart.statements.find((entry) => entry.kind === 'property' && entry.name === 'fill');
  if (fillEntry === undefined || fillEntry.kind !== 'property') return null;
  const selected = readRole(fillEntry.value, prepared.palette, true, report.path,
    propertyIssue(report), fillEntry.span);
  const selectedId = selected === null ? null : roleId(grid, selected.name);
  if (selectedId === null) return null;
  fill(grid, 0, 0, chart.abiWidth, chart.abiHeight, selectedId, 2);
  if (!chartStatements(chart.chart.statements, chart.chart, chart.regions, prepared,
    context, grid, report, true)) return null;
  if (report.bad) return null;
  if (chart.coverage !== null) for (let index = 0; index < chart.coverage.length; index += 1) {
    if (chart.coverage[index] === '0') {
      grid.fixed[index] = 1; grid.values[index] = 0; grid.tones[index] = 0;
    }
  }
  if (prepared.tone) applyVoxelTone(grid, chart.regions);
  const seed = prepared.grain.seed === null ? 0n : readInteger(prepared.grain.seed.value,
    context, 'plain', report.path, propertyIssue(report), prepared.grain.seed.span);
  if (seed === null || seed < 0n || seed > 0xffffffffn) {
    report.report(prepared.grain.seed?.value.span ?? prepared.grain.span,
      'asset.texture.invalid-grain', 'Clustered grain seed must be an unsigned 32-bit integer.');
    return null;
  }
  if (!applyGrain(grid, chart.regions, Number(seed), owner, report.path,
    prepared.grain.span, propertyIssue(report))) return null;
  const details = gridDetails(grid, owner, chart.origin[0], chart.origin[1],
    report.path, chart.chart.span, propertyIssue(report));
  if (details === null) return null;
  const mask = chart.coverage === null ? null : maskFor(owner + ':coverage', chart.origin,
    chart.abiWidth, chart.abiHeight, chart.coverage);
  return Object.freeze({ details, mask });
};

export const composeTextureCharts = (
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  owner: string,
  report: TextureReporter
): Readonly<{
  readonly details: readonly TextureCanvasDetail[];
  readonly masks: readonly TextureAlphaMask[];
  readonly charts: Readonly<Record<string, AssetTextureChartPlan>>;
}> | null => {
  const details: TextureCanvasDetail[] = []; const masks: TextureAlphaMask[] = [];
  const charts = Object.create(null) as Record<string, AssetTextureChartPlan>;
  for (const chart of prepared.charts) {
    const result = applyChart(chart, prepared, context, owner + ':' + chart.chart.id, report);
    if (result === null) return null;
    for (const detail of result.details) details.push(detail);
    if (result.mask !== null) masks.push(result.mask);
    charts[chart.chart.id] = Object.freeze({ id: chart.chart.id, layout: chart.chart.layout,
      origin: chart.origin, width: chart.abiWidth, height: chart.abiHeight,
      coverage: chart.coverage, span: chart.chart.span });
  }
  if (!detailBudgetAllows(details, masks, report.path, report.owner, propertyIssue(report))) return null;
  return Object.freeze({ details: Object.freeze(details), masks: Object.freeze(masks), charts: Object.freeze(charts) });
};
