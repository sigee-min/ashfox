import type {
  ProgramProperty,
  ProgramTextureChart,
} from '../../../../project/program/syntax/contract';
import { properties, readInteger, type TextureExpressionContext } from './expressions';
import type { PreparedTexture } from './prepare';
import { paint, sampleBudget, type PaintGrid, type PaintTone, type TextureRegion } from './raster';
import { propertyIssue, type TextureReporter } from './report';

type PatternStatement = Extract<ProgramTextureChart['statements'][number], { kind: 'pattern' }>;
type EdgeMode = 'highlight' | 'wear' | 'both';

const EDGE_MODES = new Set<string>(['highlight', 'wear', 'both']);

const readEdgeWidth = (
  entry: ProgramProperty | undefined,
  context: TextureExpressionContext,
  report: TextureReporter,
): number | null => {
  if (entry === undefined) return 1;
  const val = readInteger(
    entry.value,
    context,
    'texel',
    report.path,
    propertyIssue(report),
    entry.span,
  );
  if (val === null || val < 1n || val > 4n) {
    report.report(
      entry.value.span,
      'asset.texture.invalid-pattern',
      'Edge width must be 1px..4px.',
    );
    return null;
  }
  return Number(val);
};

const readEdgeStrength = (
  entry: ProgramProperty | undefined,
  context: TextureExpressionContext,
  report: TextureReporter,
): number | null => {
  if (entry === undefined) return 0.75;
  const val = context.evaluate(entry.value, 'ratio');
  if (val?.kind !== 'number' || val.value.unit !== 'ratio' || val.value.denominator <= 0n) {
    report.report(
      entry.value.span,
      'asset.texture.invalid-ratio',
      'Edge strength requires a ratio.',
    );
    return null;
  }
  const ratio = Number(val.value.numerator) / Number(val.value.denominator);
  if (ratio < 0 || ratio > 1) {
    report.report(entry.value.span, 'asset.texture.invalid-ratio', 'Edge strength must be 0..1.');
    return null;
  }
  return ratio;
};

const readEdgeMode = (
  entry: ProgramProperty | undefined,
  report: TextureReporter,
): EdgeMode | null => {
  if (entry === undefined) return 'both';
  if (entry.value.kind === 'name' && EDGE_MODES.has(entry.value.value)) {
    return entry.value.value as EdgeMode;
  }
  report.report(
    entry.value.span,
    'asset.texture.invalid-pattern',
    'Edge mode must be highlight, wear, or both.',
  );
  return null;
};

const edgeHash = (x: number, y: number, w: number, h: number): number => {
  let v =
    (Math.imul(x + 11, 0x9e3779b1) ^
      Math.imul(y + 23, 0x85ebca6b) ^
      Math.imul(w * 31 + h, 0xc2b2ae35)) >>>
    0;
  v ^= v >>> 15;
  v = Math.imul(v, 0x2c1b3c6d) >>> 0;
  return (v ^ (v >>> 12)) >>> 0;
};

const edgeDeltaAt = (
  x: number,
  y: number,
  w: number,
  h: number,
  width: number,
  mode: EdgeMode,
  strength: number,
): number => {
  const topOrLeft = y < width || (x < width && y < h - width);
  const bottomOrRight = y >= h - width || (x >= w - width && y >= width);
  if (!topOrLeft && !bottomOrRight) return 0;
  if ((edgeHash(x, y, w, h) & 0xffff) / 0xffff > strength) return 0;
  if (topOrLeft && mode !== 'wear') return 1;
  if (bottomOrRight && mode !== 'highlight') return -1;
  return 0;
};

const applyRegionEdge = (
  grid: PaintGrid,
  region: TextureRegion,
  width: number,
  mode: EdgeMode,
  strength: number,
): void => {
  if (region.width < 3 || region.height < 3) return;
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const idx = (region.y + y) * grid.width + region.x + x;
      if (grid.fixed[idx] !== 0) continue;
      const roleId = grid.values[idx]!;
      if (grid.roles[roleId]?.kind !== 'ramp') continue;
      const delta = edgeDeltaAt(x, y, region.width, region.height, width, mode, strength);
      if (delta === 0) continue;
      const tone = Math.max(0, Math.min(4, grid.tones[idx]! + delta)) as PaintTone;
      paint(grid, region.x + x, region.y + y, roleId, tone);
    }
  }
};

/** Apply deterministic painterly edge highlight / bottom bevel wear along region borders. */
export const applyEdgePattern = (
  statement: PatternStatement,
  regions: readonly TextureRegion[],
  _prepared: PreparedTexture,
  context: TextureExpressionContext,
  grid: PaintGrid,
  report: TextureReporter,
): boolean => {
  const entries = properties(
    statement.properties,
    ['strength', 'width', 'mode'],
    statement.span,
    report.path,
    propertyIssue(report),
  );
  if (entries === null) return false;
  const width = readEdgeWidth(entries.get('width'), context, report);
  const strength = readEdgeStrength(entries.get('strength'), context, report);
  const mode = readEdgeMode(entries.get('mode'), report);
  if (width === null || strength === null || mode === null) return false;
  if (sampleBudget(regions, 2) === null) {
    report.report(
      statement.span,
      'asset.texture-budget',
      'Edge pattern exceeds bounded work budget.',
    );
    return false;
  }
  for (const region of regions) applyRegionEdge(grid, region, width, mode, strength);
  return true;
};
