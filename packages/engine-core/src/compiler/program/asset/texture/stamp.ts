import type {
  ProgramProperty,
  ProgramTextureStampUse,
} from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import {
  properties,
  readInteger,
  readTexelVector,
  type TextureExpressionContext,
} from './expressions';
import { readRole, type PaletteRole } from './palette';
import {
  paint,
  paintStamp,
  roleId,
  type PaintGrid,
  type TextureRegion,
  type TextureStamp,
} from './raster';
import { propertyIssue, type TextureReporter } from './report';

const anchors: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  top_left: [0, 0],
  top: [0.5, 0],
  top_right: [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  bottom_left: [0, 1],
  bottom: [0.5, 1],
  bottom_right: [1, 1],
});

type StampFlip = 'none' | 'x' | 'y' | 'xy';

const stampFlips: ReadonlySet<StampFlip> = new Set(['none', 'x', 'y', 'xy']);

const readFlip = (
  value: ProgramTextureStampUse['properties'][number]['value'],
  report: TextureReporter,
  fallback: SourceSpan,
): StampFlip | null => {
  if (value.kind === 'name' && stampFlips.has(value.value as StampFlip)) {
    return value.value as StampFlip;
  }
  report.report(
    value.span ?? fallback,
    'asset.texture.invalid-flip',
    'Stamp flip must be one of none, x, y, or xy.',
  );
  return null;
};

const applyAnchor = (
  x: number,
  y: number,
  anchor: ProgramProperty,
  region: TextureRegion,
  stamp: TextureStamp,
  report: TextureReporter,
): readonly [number, number] | null => {
  const alignment =
    anchor.value.kind === 'name' &&
    Object.prototype.hasOwnProperty.call(anchors, anchor.value.value)
      ? anchors[anchor.value.value]
      : undefined;
  if (alignment === undefined) {
    report.report(
      anchor.value.span,
      'asset.texture.invalid-anchor',
      'Stamp anchor must name one of the nine face-local anchors.',
    );
    return null;
  }
  const shiftedX = x + (region.width - stamp.width) * alignment[0];
  const shiftedY = y + (region.height - stamp.height) * alignment[1];
  if (!Number.isSafeInteger(shiftedX) || !Number.isSafeInteger(shiftedY)) {
    report.report(
      anchor.value.span,
      'asset.texture.stamp-off-grid',
      'Centered stamp placement must land on exact integer pixels; change face or stamp parity.',
    );
    return null;
  }
  return [shiftedX, shiftedY];
};

interface ProtectPolicy {
  readonly padding: number;
  readonly protectCells: boolean;
  readonly freezeRect: boolean;
}

const readProtectPolicy = (
  protect: ProgramProperty | undefined,
  region: TextureRegion,
  context: TextureExpressionContext,
  report: TextureReporter,
  fallback: SourceSpan,
): ProtectPolicy | null => {
  if (protect === undefined) return { padding: 0, protectCells: true, freezeRect: false };
  const evaluated = context.evaluate(protect.value);
  if (evaluated?.kind === 'boolean') {
    return { padding: 0, protectCells: evaluated.value, freezeRect: false };
  }
  const margin = readInteger(
    protect.value,
    context,
    'texel',
    report.path,
    propertyIssue(report),
    protect.span,
  );
  if (margin === null) return null;
  if (margin < 0n || margin > BigInt(Math.max(region.width, region.height))) {
    report.report(
      protect.value.span ?? fallback,
      'asset.texture.invalid-protection',
      'Stamp protection requires a boolean or nonnegative integral texel margin bounded by its face.',
    );
    return null;
  }
  return { padding: Number(margin), protectCells: true, freezeRect: true };
};

const withinFaceBounds = (
  x: number,
  y: number,
  padding: number,
  stamp: TextureStamp,
  region: TextureRegion,
): boolean =>
  x - padding >= 0 &&
  y - padding >= 0 &&
  x + stamp.width + padding <= region.width &&
  y + stamp.height + padding <= region.height;

const freezeProtection = (
  grid: PaintGrid,
  region: TextureRegion,
  x: number,
  y: number,
  padding: number,
  stamp: TextureStamp,
): void => {
  for (let row = y - padding; row < y + stamp.height + padding; row += 1) {
    for (let column = x - padding; column < x + stamp.width + padding; column += 1) {
      grid.fixed[(region.y + row) * grid.width + region.x + column] = 1;
    }
  }
};

const paintStampCell = (
  grid: PaintGrid,
  region: TextureRegion,
  x: number,
  y: number,
  roleName: string,
  palette: ReadonlyMap<string, PaletteRole>,
  protectCells: boolean,
  report: TextureReporter,
  span: SourceSpan,
): void => {
  const selected = readRole(
    { kind: 'name', value: roleName, span },
    palette,
    false,
    report.path,
    propertyIssue(report),
    span,
  );
  const id = selected === null ? null : roleId(grid, selected.name);
  if (id === null) return;
  if (protectCells) paintStamp(grid, region.x + x, region.y + y, id, 2);
  else paint(grid, region.x + x, region.y + y, id, 2);
};

const paintStampCells = (
  grid: PaintGrid,
  region: TextureRegion,
  x: number,
  y: number,
  stamp: TextureStamp,
  flip: StampFlip,
  palette: ReadonlyMap<string, PaletteRole>,
  protectCells: boolean,
  report: TextureReporter,
  span: SourceSpan,
): void => {
  for (let row = 0; row < stamp.height; row += 1) {
    for (let column = 0; column < stamp.width; column += 1) {
      const cell = stamp.cells[row * stamp.width + column];
      if (cell === null) continue;
      const targetColumn = flip === 'x' || flip === 'xy' ? stamp.width - 1 - column : column;
      const targetRow = flip === 'y' || flip === 'xy' ? stamp.height - 1 - row : row;
      paintStampCell(
        grid,
        region,
        x + targetColumn,
        y + targetRow,
        cell.role,
        palette,
        protectCells,
        report,
        span,
      );
    }
  }
};

const readStampPosition = (
  entries: ReadonlyMap<string, ProgramProperty>,
): Readonly<{
  readonly position: ProgramProperty;
  readonly anchor: ProgramProperty | undefined;
}> | null => {
  const at = entries.get('at');
  const anchor = entries.get('anchor');
  const offset = entries.get('offset');
  const validPair =
    (at !== undefined && anchor === undefined && offset === undefined) ||
    (at === undefined && anchor !== undefined && offset !== undefined);
  if (!validPair) return null;
  return { position: at ?? offset!, anchor };
};

const resolveStampPlacement = (
  entries: ReadonlyMap<string, ProgramProperty>,
  statement: ProgramTextureStampUse,
  region: TextureRegion,
  stamp: TextureStamp,
  context: TextureExpressionContext,
  report: TextureReporter,
): Readonly<{
  readonly coords: readonly [number, number];
  readonly flip: StampFlip;
  readonly positionSpan: SourceSpan;
}> | null => {
  const placement = readStampPosition(entries);
  if (placement === null) {
    report.report(
      statement.span,
      'asset.texture.stamp-placement',
      'Stamp placement requires exactly at or the pair anchor and offset.',
    );
    return null;
  }
  const flipEntry = entries.get('flip');
  const flip = flipEntry === undefined ? 'none' : readFlip(flipEntry.value, report, statement.span);
  if (flip === null) return null;
  const delta = readTexelVector(
    placement.position.value,
    context,
    2,
    report.path,
    propertyIssue(report),
    placement.position.span,
  );
  if (delta === null) return null;
  const coords =
    placement.anchor === undefined
      ? ([delta[0]!, delta[1]!] as const)
      : applyAnchor(delta[0]!, delta[1]!, placement.anchor, region, stamp, report);
  if (coords === null) return null;
  return { coords, flip, positionSpan: placement.position.value.span };
};

/** Place a pixel stamp in the owning face's local integer grid. */
export const stampUse = (
  statement: ProgramTextureStampUse,
  region: TextureRegion,
  stamps: ReadonlyMap<string, TextureStamp>,
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  grid: PaintGrid,
  report: TextureReporter,
): void => {
  const stamp = stamps.get(statement.id);
  if (stamp === undefined) {
    report.report(
      statement.span,
      'asset.texture.unknown-stamp',
      'Unknown texture stamp "' + statement.id + '".',
    );
    return;
  }
  const entries = properties(
    statement.properties,
    ['at', 'anchor', 'offset', 'protect', 'flip'],
    statement.span,
    report.path,
    propertyIssue(report),
  );
  if (entries === null) return;
  const resolved = resolveStampPlacement(entries, statement, region, stamp, context, report);
  if (resolved === null) return;
  const protect = entries.get('protect');
  const policy = readProtectPolicy(protect, region, context, report, statement.span);
  if (policy === null) return;
  const [x, y] = resolved.coords;
  if (!withinFaceBounds(x, y, policy.padding, stamp, region)) {
    report.report(
      resolved.positionSpan,
      'asset.texture.stamp-out-of-bounds',
      'Stamp placement and its protection margin must fit entirely within the owning face.',
    );
    return;
  }
  // Explicit texel padding freezes the whole rectangle, including transparent stamp cells.
  // Binary coverage is applied later and remains authoritative over alpha.
  if (policy.freezeRect) freezeProtection(grid, region, x, y, policy.padding, stamp);
  paintStampCells(
    grid,
    region,
    x,
    y,
    stamp,
    resolved.flip,
    palette,
    policy.protectCells,
    report,
    statement.span,
  );
};
