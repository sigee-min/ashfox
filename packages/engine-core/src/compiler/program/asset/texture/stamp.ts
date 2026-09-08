import type { ProgramTextureStampUse } from '../../../../project/program/syntax/contract';
import { properties, readInteger, readRole, readTexelVector,
  type PaletteRole, type TextureExpressionContext } from './expressions';
import { propertyIssue, type TextureReporter } from './prepare';
import { paintStamp, roleId, type PaintGrid, type TextureRegion, type TextureStamp } from './raster';

const anchors: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  top_left: [0, 0], top: [0.5, 0], top_right: [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  bottom_left: [0, 1], bottom: [0.5, 1], bottom_right: [1, 1]
});

type StampFlip = 'none' | 'x' | 'y' | 'xy';

const stampFlips: ReadonlySet<StampFlip> = new Set(['none', 'x', 'y', 'xy']);

const readFlip = (
  value: ProgramTextureStampUse['properties'][number]['value'],
  report: TextureReporter,
  fallback: ProgramTextureStampUse['span']
): StampFlip | null => {
  if (value.kind === 'name' && stampFlips.has(value.value as StampFlip)) return value.value as StampFlip;
  report.report(value.span ?? fallback, 'asset.texture.invalid-flip',
    'Stamp flip must be one of none, x, y, or xy.');
  return null;
};

/** Place a pixel stamp in the owning face's local integer grid. */
export const stampUse = (
  statement: ProgramTextureStampUse,
  region: TextureRegion,
  stamps: ReadonlyMap<string, TextureStamp>,
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  grid: PaintGrid,
  report: TextureReporter
): void => {
  const stamp = stamps.get(statement.id);
  if (stamp === undefined) {
    report.report(statement.span, 'asset.texture.unknown-stamp', 'Unknown texture stamp "' + statement.id + '".');
    return;
  }
  const entries = properties(statement.properties, ['at', 'anchor', 'offset', 'protect', 'flip'],
    statement.span, report.path, propertyIssue(report));
  if (entries === null) return;
  const at = entries.get('at'); const anchor = entries.get('anchor'); const offset = entries.get('offset');
  if ((at !== undefined && (anchor !== undefined || offset !== undefined)) ||
    (at === undefined && (anchor === undefined || offset === undefined))) {
    report.report(statement.span, 'asset.texture.stamp-placement',
      'Stamp placement requires exactly at or the pair anchor and offset.');
    return;
  }
  const flipEntry = entries.get('flip');
  const flip = flipEntry === undefined ? 'none' : readFlip(flipEntry.value, report, statement.span);
  if (flip === null) return;
  const position = at ?? offset!;
  const delta = readTexelVector(position.value, context, 2, report.path, propertyIssue(report), position.span);
  if (delta === null) return;
  let x = delta[0]!; let y = delta[1]!;
  if (anchor !== undefined) {
    const alignment = anchor.value.kind === 'name' && Object.prototype.hasOwnProperty.call(anchors, anchor.value.value)
      ? anchors[anchor.value.value] : undefined;
    if (alignment === undefined) {
      report.report(anchor.value.span, 'asset.texture.invalid-anchor', 'Stamp anchor must name one of the nine face-local anchors.');
      return;
    }
    x += (region.width - stamp.width) * alignment[0];
    y += (region.height - stamp.height) * alignment[1];
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      report.report(anchor.value.span, 'asset.texture.stamp-off-grid',
        'Centered stamp placement must land on exact integer pixels; change face or stamp parity.');
      return;
    }
  }
  const protect = entries.get('protect');
  const margin = protect === undefined ? 0n : readInteger(protect.value, context, 'texel', report.path,
    propertyIssue(report), protect.span);
  if (margin === null) return;
  if (margin < 0n || margin > BigInt(Math.max(region.width, region.height))) {
    report.report(protect?.value.span ?? statement.span, 'asset.texture.invalid-protection',
      'Stamp protection requires a nonnegative integral texel margin bounded by its face.');
    return;
  }
  const padding = Number(margin);
  if (x - padding < 0 || y - padding < 0 || x + stamp.width + padding > region.width ||
    y + stamp.height + padding > region.height) {
    report.report(position.value.span, 'asset.texture.stamp-out-of-bounds',
      'Stamp placement and its protection margin must fit entirely within the owning face.');
    return;
  }
  // Explicit protection freezes the whole rectangle, including transparent stamp cells.
  // Binary coverage is applied later and remains authoritative over alpha.
  if (protect !== undefined) for (let row = y - padding; row < y + stamp.height + padding; row += 1) {
    for (let column = x - padding; column < x + stamp.width + padding; column += 1) {
      grid.fixed[(region.y + row) * grid.width + region.x + column] = 1;
    }
  }
  for (let row = 0; row < stamp.height; row += 1) for (let column = 0; column < stamp.width; column += 1) {
    const cell = stamp.cells[row * stamp.width + column];
    if (cell === null) continue;
    const targetColumn = flip === 'x' || flip === 'xy' ? stamp.width - 1 - column : column;
    const targetRow = flip === 'y' || flip === 'xy' ? stamp.height - 1 - row : row;
    const selected = readRole({ kind: 'name', value: cell.role, span: statement.span }, palette, false,
      report.path, propertyIssue(report), statement.span);
    const id = selected === null ? null : roleId(grid, selected.name);
    if (id !== null) paintStamp(grid, region.x + x + targetColumn, region.y + y + targetRow, id, 2);
  }
};
