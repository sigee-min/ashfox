import type {
  ProgramProperty,
  ProgramTextureChart,
} from '../../../../project/program/syntax/contract';
import { properties, type TextureExpressionContext } from './expressions';
import type { PreparedTexture } from './prepare';
import { readRole } from './palette';
import {
  boxSurfacePoint,
  paint,
  roleId,
  sampleBudget,
  type PaintGrid,
  type TextureRegion,
  type TextureSceneContext,
} from './raster';
import { propertyIssue, type TextureReporter } from './report';

type PatternStatement = Extract<ProgramTextureChart['statements'][number], { kind: 'pattern' }>;
type GradientAxis = 'u' | 'v' | 'x' | 'y' | 'z';
type GradientSpace = 'local' | 'model';

const AXES = new Set<GradientAxis>(['u', 'v', 'x', 'y', 'z']);

const readNameOption = (
  entry: ProgramProperty | undefined,
  allowed: ReadonlySet<string>,
  fallback: string | null,
  report: TextureReporter,
  message: string,
): string | null => {
  if (entry === undefined) return fallback;
  if (entry.value.kind === 'name' && allowed.has(entry.value.value)) return entry.value.value;
  report.report(entry.value.span, 'asset.texture.invalid-pattern', message);
  return null;
};

const readRatioProp = (
  entry: ProgramProperty | undefined,
  fallback: number,
  context: TextureExpressionContext,
  report: TextureReporter,
): number | null => {
  if (entry === undefined) return fallback;
  const value = context.evaluate(entry.value, 'ratio');
  if (value?.kind !== 'number' || value.value.unit !== 'ratio' || value.value.denominator <= 0n) {
    report.report(
      entry.value.span,
      'asset.texture.invalid-ratio',
      'Gradient soft requires a ratio.',
    );
    return null;
  }
  const ratio = Number(value.value.numerator) / Number(value.value.denominator);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    report.report(
      entry.value.span,
      'asset.texture.invalid-ratio',
      'Gradient soft must be between zero and one.',
    );
    return null;
  }
  return ratio;
};

const axisIndex = (axis: 'x' | 'y' | 'z'): 0 | 1 | 2 => (axis === 'x' ? 0 : axis === 'y' ? 1 : 2);

const computeLocalRatio = (
  region: TextureRegion,
  axis: GradientAxis,
  x: number,
  y: number,
): number => {
  if (axis === 'u') return region.width <= 1 ? 0.5 : x / (region.width - 1);
  if (axis === 'v') return region.height <= 1 ? 0.5 : y / (region.height - 1);
  const idx = axisIndex(axis);
  const point = boxSurfacePoint(region, x, y);
  const d = region.density ?? 1;
  const span = region.boxSize
    ? region.boxSize[idx]!
    : (idx === 1 ? region.height : region.width) / d;
  return span <= 0 ? 0.5 : Math.max(0, Math.min(1, point[idx]! / span));
};

const computeModelRatio = (
  chartId: string,
  region: TextureRegion,
  axis: 'x' | 'y' | 'z',
  x: number,
  y: number,
  scene: TextureSceneContext | undefined,
): number => {
  if (scene === undefined) return computeLocalRatio(region, axis, x, y);
  const worldPoint = scene.worldPointFor(chartId, region, x, y);
  const idx = axisIndex(axis);
  const min = scene.boundsMin[idx]!;
  const max = scene.boundsMax[idx]!;
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (worldPoint[idx]! - min) / (max - min)));
};

const thresholdAt = (x: number, y: number, soft: number): number =>
  0.5 + Math.sin((x >> 1) * 1.7 + (y >> 1) * 2.3) * 0.5 * soft;

interface GradientSpec {
  readonly fromId: number | null;
  readonly toId: number;
  readonly axis: GradientAxis;
  readonly space: GradientSpace;
  readonly soft: number;
}

const paintGradientTexel = (
  grid: PaintGrid,
  chartId: string,
  region: TextureRegion,
  x: number,
  y: number,
  spec: GradientSpec,
  band: number,
  scene: TextureSceneContext | undefined,
): void => {
  const t =
    spec.space === 'model' && spec.axis !== 'u' && spec.axis !== 'v'
      ? computeModelRatio(chartId, region, spec.axis, x, y, scene)
      : computeLocalRatio(region, spec.axis, x, y);
  const thresh = thresholdAt(x, y, spec.soft);
  if (t >= thresh) {
    paint(grid, region.x + x, region.y + y, spec.toId, t - thresh < band ? 1 : 2);
  } else if (spec.fromId !== null) {
    paint(grid, region.x + x, region.y + y, spec.fromId, thresh - t < band ? 3 : 2);
  }
};

const paintGradientRegion = (
  grid: PaintGrid,
  chartId: string,
  region: TextureRegion,
  spec: GradientSpec,
  scene: TextureSceneContext | undefined,
): void => {
  const band = Math.max(0.06, spec.soft * 0.35);
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      paintGradientTexel(grid, chartId, region, x, y, spec, band, scene);
    }
  }
};

const resolveRoleIds = (
  grid: PaintGrid,
  fromProp: ProgramProperty | undefined,
  toProp: ProgramProperty,
  prepared: PreparedTexture,
  report: TextureReporter,
): Readonly<{ readonly fromId: number | null; readonly toId: number }> | null => {
  const toRole = readRole(
    toProp.value,
    prepared.palette,
    true,
    report.path,
    propertyIssue(report),
    toProp.span,
  );
  if (toRole === null) return null;
  const toId = roleId(grid, toRole.name);
  if (toId === null) return null;
  if (fromProp === undefined) return { fromId: null, toId };
  const fromRole = readRole(
    fromProp.value,
    prepared.palette,
    true,
    report.path,
    propertyIssue(report),
    fromProp.span,
  );
  if (fromRole === null) return null;
  const fromId = roleId(grid, fromRole.name);
  return fromId === null ? null : { fromId, toId };
};

const readGradientSpec = (
  statement: PatternStatement,
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  report: TextureReporter,
): GradientSpec | null => {
  const entries = properties(
    statement.properties,
    ['from', 'to', 'axis', 'space', 'soft'],
    statement.span,
    report.path,
    propertyIssue(report),
  );
  if (entries === null) return null;
  const toProp = entries.get('to');
  const axis = readNameOption(
    entries.get('axis'),
    AXES,
    null,
    report,
    'Gradient axis must be u, v, x, y, or z.',
  );
  const space = readNameOption(
    entries.get('space'),
    new Set(['local', 'model']),
    'local',
    report,
    'Gradient space must be local or model.',
  );
  const soft = readRatioProp(entries.get('soft'), 0.25, context, report);
  if (toProp === undefined || axis === null || space === null || soft === null) {
    if (toProp === undefined)
      report.report(
        statement.span,
        'asset.texture.missing-property',
        'Gradient pattern requires to and axis properties.',
      );
    return null;
  }
  const roles = resolveRoleIds(grid, entries.get('from'), toProp, prepared, report);
  if (roles === null) return null;
  return { ...roles, axis: axis as GradientAxis, space: space as GradientSpace, soft };
};

/** Apply ordered-dithered gradient transitions along face or 3D axes. */
export const applyGradientPattern = (
  statement: PatternStatement,
  chartId: string,
  regions: readonly TextureRegion[],
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  scene: TextureSceneContext | undefined,
  report: TextureReporter,
): boolean => {
  const spec = readGradientSpec(statement, prepared, context, grid, report);
  if (spec === null) return false;
  if (sampleBudget(regions, 4) === null) {
    report.report(
      statement.span,
      'asset.texture-budget',
      'Texture gradient exceeds the bounded work budget.',
    );
    return false;
  }
  for (const region of regions) paintGradientRegion(grid, chartId, region, spec, scene);
  return true;
};
