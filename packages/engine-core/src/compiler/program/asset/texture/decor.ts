import type {
  ProgramProperty,
  ProgramTextureChart,
} from '../../../../project/program/syntax/contract';
import { properties, readInteger, type TextureExpressionContext } from './expressions';
import { readRole } from './palette';
import type { PreparedTexture } from './prepare';
import {
  boxSurfacePoint,
  paint,
  roleId,
  sampleBudget,
  type PaintGrid,
  type TextureRegion,
} from './raster';
import { propertyIssue, type TextureReporter } from './report';

type PatternStatement = Extract<ProgramTextureChart['statements'][number], { kind: 'pattern' }>;
type BorderEdges = 'all' | 'top' | 'bottom' | 'sides';
type StripeAxis = 'u' | 'v' | 'x' | 'y' | 'z';

const EDGE_SET = new Set<string>(['all', 'top', 'bottom', 'sides']);
const AXIS_SET = new Set<string>(['u', 'v', 'x', 'y', 'z']);

const onBorder = (
  x: number,
  y: number,
  w: number,
  h: number,
  width: number,
  edges: BorderEdges,
): boolean => {
  const left = x < width;
  const right = x >= w - width;
  const top = y < width;
  const bottom = y >= h - width;
  if (edges === 'top') return top;
  if (edges === 'bottom') return bottom;
  if (edges === 'sides') return left || right;
  return left || right || top || bottom;
};

const readTexelInt = (
  entry: ProgramProperty | undefined,
  fallback: number,
  min: number,
  max: number,
  context: TextureExpressionContext,
  report: TextureReporter,
  label: string,
): number | null => {
  if (entry === undefined) return fallback;
  const val = readInteger(
    entry.value,
    context,
    'texel',
    report.path,
    propertyIssue(report),
    entry.span,
  );
  if (val === null || val < BigInt(min) || val > BigInt(max)) {
    report.report(
      entry.value.span,
      'asset.texture.invalid-pattern',
      `${label} must be between ${min}px and ${max}px.`,
    );
    return null;
  }
  return Number(val);
};

const readBorderEdges = (
  edgesProp: ProgramProperty | undefined,
  report: TextureReporter,
): BorderEdges | null => {
  if (edgesProp === undefined) return 'all';
  if (edgesProp.value.kind === 'name' && EDGE_SET.has(edgesProp.value.value)) {
    return edgesProp.value.value as BorderEdges;
  }
  report.report(
    edgesProp.value.span,
    'asset.texture.invalid-pattern',
    'Border edges must be all, top, bottom, or sides.',
  );
  return null;
};

const paintBorderRegion = (
  grid: PaintGrid,
  region: TextureRegion,
  roleIdValue: number,
  width: number,
  edges: BorderEdges,
): void => {
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      if (onBorder(x, y, region.width, region.height, width, edges)) {
        paint(grid, region.x + x, region.y + y, roleIdValue, 2);
      }
    }
  }
};

/** Paint crisp edge trim or framing borders along region boundaries. */
export const applyBorderPattern = (
  statement: PatternStatement,
  regions: readonly TextureRegion[],
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  report: TextureReporter,
): boolean => {
  const entries = properties(
    statement.properties,
    ['paint', 'width', 'edges'],
    statement.span,
    report.path,
    propertyIssue(report),
  );
  if (entries === null) return false;
  const paintProp = entries.get('paint');
  if (paintProp === undefined) {
    report.report(
      statement.span,
      'asset.texture.missing-property',
      'Border pattern requires a paint role.',
    );
    return false;
  }
  const role = readRole(
    paintProp.value,
    prepared.palette,
    true,
    report.path,
    propertyIssue(report),
    paintProp.span,
  );
  const id = role === null ? null : roleId(grid, role.name);
  const width = readTexelInt(entries.get('width'), 1, 1, 16, context, report, 'Border width');
  const edges = readBorderEdges(entries.get('edges'), report);
  if (id === null || width === null || edges === null) return false;
  for (const region of regions) paintBorderRegion(grid, region, id, width, edges);
  return true;
};

const stripeCoord = (region: TextureRegion, axis: StripeAxis, x: number, y: number): number => {
  if (axis === 'u') return x;
  if (axis === 'v') return y;
  const p = boxSurfacePoint(region, x, y);
  const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  return Math.floor(p[idx]!);
};

interface StripeConfig {
  readonly roleId: number;
  readonly axis: StripeAxis;
  readonly period: number;
  readonly width: number;
  readonly phase: number;
}

const paintStripeRegion = (grid: PaintGrid, region: TextureRegion, cfg: StripeConfig): void => {
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const coord = stripeCoord(region, cfg.axis, x, y) + cfg.phase;
      const mod = ((coord % cfg.period) + cfg.period) % cfg.period;
      if (mod < cfg.width) paint(grid, region.x + x, region.y + y, cfg.roleId, 2);
    }
  }
};

const readStripeAxis = (axisProp: ProgramProperty, report: TextureReporter): StripeAxis | null => {
  if (axisProp.value.kind === 'name' && AXIS_SET.has(axisProp.value.value)) {
    return axisProp.value.value as StripeAxis;
  }
  report.report(
    axisProp.value.span,
    'asset.texture.invalid-pattern',
    'Stripe axis must be u, v, x, y, or z.',
  );
  return null;
};

const readStripePhase = (
  entry: ProgramProperty | undefined,
  context: TextureExpressionContext,
  report: TextureReporter,
): number | null => {
  if (entry === undefined) return 0;
  const val = readInteger(
    entry.value,
    context,
    'plain',
    report.path,
    propertyIssue(report),
    entry.span,
  );
  return val === null ? null : Number(val);
};

const readStripeConfig = (
  statement: PatternStatement,
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  report: TextureReporter,
): StripeConfig | null => {
  const entries = properties(
    statement.properties,
    ['paint', 'axis', 'period', 'width', 'phase'],
    statement.span,
    report.path,
    propertyIssue(report),
  );
  if (entries === null) return null;
  const paintProp = entries.get('paint');
  const axisProp = entries.get('axis');
  const periodProp = entries.get('period');
  if (paintProp === undefined || axisProp === undefined || periodProp === undefined) {
    report.report(
      statement.span,
      'asset.texture.missing-property',
      'Stripe pattern requires paint, axis, and period.',
    );
    return null;
  }
  const axis = readStripeAxis(axisProp, report);
  const role = readRole(
    paintProp.value,
    prepared.palette,
    true,
    report.path,
    propertyIssue(report),
    paintProp.span,
  );
  const id = role === null ? null : roleId(grid, role.name);
  const period = readTexelInt(periodProp, 4, 2, 128, context, report, 'Stripe period');
  const width = readTexelInt(entries.get('width'), 1, 1, 64, context, report, 'Stripe width');
  const phase = readStripePhase(entries.get('phase'), context, report);
  if (axis === null || id === null || period === null || width === null || phase === null)
    return null;
  if (width >= period) {
    report.report(
      statement.span,
      'asset.texture.invalid-pattern',
      'Stripe width must be smaller than period.',
    );
    return null;
  }
  return { roleId: id, axis, period, width, phase };
};

/** Paint periodic stripes across feathers, ribs, fur markings, or planks. */
export const applyStripePattern = (
  statement: PatternStatement,
  regions: readonly TextureRegion[],
  prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  report: TextureReporter,
): boolean => {
  const cfg = readStripeConfig(statement, prepared, context, grid, report);
  if (cfg === null) return false;
  if (sampleBudget(regions, 2) === null) {
    report.report(
      statement.span,
      'asset.texture-budget',
      'Stripe pattern exceeds the bounded work budget.',
    );
    return false;
  }
  for (const region of regions) paintStripeRegion(grid, region, cfg);
  return true;
};
