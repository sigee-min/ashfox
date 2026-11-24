import type {
  ProgramProperty,
  ProgramTextureChart,
} from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import type { AssetTextureIssue } from './contract';
import {
  properties,
  readInteger,
  readTexelVector,
  type TextureExpressionContext,
} from './expressions';
import type { TextureSceneContext } from './ao';
import { applyAoPattern } from './ao';
import { applyBorderPattern, applyStripePattern } from './decor';
import { applyGradientPattern } from './gradient';
import { readRole } from './palette';
import type { PreparedTexture } from './prepare';
import { applyPattern, type PaintGrid, type PatternSettings, type TextureRegion } from './raster';
import { propertyIssue, type TextureReporter } from './report';

type PatternStatement = Extract<ProgramTextureChart['statements'][number], { kind: 'pattern' }>;

const issueFrom =
  (report: TextureReporter): AssetTextureIssue =>
  (_path, span, code, message): void =>
    report.report(span, code, message);

const readTexelScale = (
  expression: Parameters<typeof readTexelVector>[0],
  context: TextureExpressionContext,
  report: TextureReporter,
  fallback: SourceSpan,
): readonly [number, number, number] | null => {
  if (
    expression.kind !== 'vector' ||
    !Array.isArray(expression.values) ||
    expression.values.length !== 3
  ) {
    report.report(
      expression.span ?? fallback,
      'asset.texture.invalid-vector',
      'Pattern scale requires three texel scalars.',
    );
    return null;
  }
  const result: number[] = [];
  for (const entry of expression.values) {
    const value = context.evaluate(entry, 'texel');
    if (
      value?.kind !== 'number' ||
      value.value.unit !== 'texel' ||
      value.value.denominator !== 1n
    ) {
      report.report(
        entry.span,
        'asset.texture.invalid-vector',
        'Pattern scale requires integral texel scalars.',
      );
      return null;
    }
    const converted = Number(value.value.numerator);
    if (!Number.isSafeInteger(converted)) {
      report.report(
        entry.span,
        'asset.texture.invalid-vector',
        'Pattern scale exceeds the safe texel range.',
      );
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
  fallback: SourceSpan,
): Readonly<{ readonly numerator: bigint; readonly denominator: bigint }> | null => {
  const value = context.evaluate(expression, 'ratio');
  if (value?.kind !== 'number' || value.value.unit !== 'ratio' || value.value.denominator <= 0n) {
    report.report(
      expression.span ?? fallback,
      'asset.texture.invalid-ratio',
      'Pattern density requires a ratio.',
    );
    return null;
  }
  return { numerator: value.value.numerator, denominator: value.value.denominator };
};

const withinPatternBounds = (
  scaleValue: readonly [number, number, number],
  densityValue: Readonly<{ readonly numerator: bigint; readonly denominator: bigint }>,
  phaseValue: bigint,
): boolean =>
  scaleValue.every((value) => value >= 1 && value <= 128) &&
  phaseValue >= 0n &&
  phaseValue <= 0xffffffffn &&
  densityValue.numerator >= 0n &&
  densityValue.numerator <= densityValue.denominator;

const readPatternProperties = (
  statement: PatternStatement,
  report: TextureReporter,
): Readonly<Record<'paint' | 'scale' | 'density' | 'phase', ProgramProperty>> | null => {
  const entries = properties(
    statement.properties,
    ['paint', 'scale', 'density', 'phase'],
    statement.span,
    report.path,
    propertyIssue(report),
  );
  if (entries === null) return null;
  const paint = entries.get('paint');
  const scale = entries.get('scale');
  const density = entries.get('density');
  const phase = entries.get('phase');
  if (paint === undefined || scale === undefined || density === undefined || phase === undefined) {
    report.report(
      statement.span,
      'asset.texture.missing-property',
      'Blotch pattern is incomplete.',
    );
    return null;
  }
  return { paint, scale, density, phase };
};

const readPatternSettings = (
  statement: PatternStatement,
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  report: TextureReporter,
): PatternSettings | null => {
  const fields = readPatternProperties(statement, report);
  if (fields === null) return null;
  const selected = readRole(
    fields.paint.value,
    prepared.palette,
    true,
    report.path,
    propertyIssue(report),
    fields.paint.span,
  );
  const scaleValue = readTexelScale(fields.scale.value, context, report, fields.scale.span);
  const densityValue = readRatioValue(fields.density.value, context, report, fields.density.span);
  const phaseValue = readInteger(
    fields.phase.value,
    context,
    'plain',
    report.path,
    propertyIssue(report),
    fields.phase.span,
  );
  if (selected === null || scaleValue === null || densityValue === null || phaseValue === null) {
    return null;
  }
  if (!withinPatternBounds(scaleValue, densityValue, phaseValue)) {
    report.report(
      statement.span,
      'asset.texture.invalid-pattern',
      'Blotch settings are outside their closed bounds.',
    );
    return null;
  }
  return {
    paint: selected.name,
    scale: scaleValue,
    density: densityValue,
    phase: Number(phaseValue),
  };
};

/** Validate and paint one procedural pattern statement across the target regions. */
export const applyPatternStatement = (
  statement: PatternStatement,
  chartKey: string,
  chartId: string,
  stampSeen: boolean,
  regions: readonly TextureRegion[],
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  scene: TextureSceneContext | undefined,
  report: TextureReporter,
): boolean => {
  if (stampSeen && statement.algorithm !== 'ao') {
    report.report(
      statement.span,
      'asset.texture.order',
      'Procedural patterns must precede stamp placement.',
    );
    return false;
  }
  if (statement.algorithm === 'gradient') {
    return applyGradientPattern(
      statement,
      chartKey,
      regions,
      prepared,
      context,
      grid,
      scene,
      report,
    );
  }
  if (statement.algorithm === 'border') {
    return applyBorderPattern(statement, regions, prepared, context, grid, report);
  }
  if (statement.algorithm === 'stripe') {
    return applyStripePattern(statement, regions, prepared, context, grid, report);
  }
  if (statement.algorithm === 'ao') {
    return applyAoPattern(statement, chartKey, regions, context, grid, scene, report);
  }
  void chartId;
  const settings = readPatternSettings(statement, prepared, context, report);
  if (settings === null) return false;
  return applyPattern(grid, regions, settings, issueFrom(report), report.path, statement.span);
};
