import type { ProgramTextureStampDecl } from '../../../../project/program/syntax/contract';
import { compareText } from '../../../../stableOrder';
import { readStampPixels, type TextureExpressionContext } from './expressions';
import { readRole, type PaletteRole } from './palette';
import type { TextureStamp, TextureStampCell } from './raster';
import { propertyIssue, type TextureReporter } from './report';

export const MAX_STAMP_PIXELS = 16_384;

const readStampRows = (
  declaration: ProgramTextureStampDecl,
  context: TextureExpressionContext,
  report: TextureReporter,
): readonly string[] | null => {
  const pixels = readStampPixels(declaration, context, report.path, propertyIssue(report));
  if (pixels === null) return null;
  const rows = pixels.split('/');
  const width = rows[0]?.length ?? 0;
  const validRows =
    width >= 1 &&
    rows.length >= 1 &&
    width * rows.length <= MAX_STAMP_PIXELS &&
    rows.every((row) => row.length === width && /^[.a-z0-9]+$/u.test(row));
  if (!validRows) {
    report.report(
      declaration.span,
      'asset.texture.invalid-stamp',
      'Stamp pixels must be bounded equal-width rows using dot or lowercase symbols.',
    );
    return null;
  }
  return rows;
};

const readStampMappings = (
  declaration: ProgramTextureStampDecl,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter,
): ReadonlyMap<string, string> | null => {
  const mappings = new Map<string, string>();
  let valid = true;
  for (const entry of declaration.properties) {
    if (entry.name === 'pixels') continue;
    if (!/^[a-z0-9]$/u.test(entry.name) || mappings.has(entry.name)) {
      report.report(
        entry.span,
        'asset.texture.invalid-stamp',
        'Stamp mappings require one unique lowercase symbol.',
      );
      valid = false;
      continue;
    }
    const role = readRole(
      entry.value,
      palette,
      false,
      report.path,
      propertyIssue(report),
      declaration.span,
    );
    if (role === null) valid = false;
    else mappings.set(entry.name, role.name);
  }
  return valid ? mappings : null;
};

const validateStampSymbols = (
  rows: readonly string[],
  mappings: ReadonlyMap<string, string>,
  declaration: ProgramTextureStampDecl,
  report: TextureReporter,
): boolean => {
  let valid = true;
  const symbols = new Set<string>([...rows.join('')].filter((symbol) => symbol !== '.'));
  for (const symbol of symbols) {
    if (!mappings.has(symbol)) {
      report.report(
        declaration.span,
        'asset.texture.invalid-stamp',
        'Stamp symbol "' + symbol + '" has no palette mapping.',
      );
      valid = false;
    }
  }
  for (const symbol of mappings.keys()) {
    if (!symbols.has(symbol)) {
      report.report(
        declaration.span,
        'asset.texture.invalid-stamp',
        'Stamp mapping "' + symbol + '" is unused.',
      );
      valid = false;
    }
  }
  return valid;
};

const buildStampCells = (
  rows: readonly string[],
  mappings: ReadonlyMap<string, string>,
): readonly (TextureStampCell | null)[] =>
  Object.freeze(
    rows.flatMap((row) =>
      [...row].map((symbol) =>
        symbol === '.' ? null : Object.freeze({ role: mappings.get(symbol)! }),
      ),
    ),
  );

const prepareStamp = (
  declaration: ProgramTextureStampDecl,
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter,
): TextureStamp | null => {
  const rows = readStampRows(declaration, context, report);
  if (rows === null) return null;
  const mappings = readStampMappings(declaration, palette, report);
  if (mappings === null) return null;
  if (!validateStampSymbols(rows, mappings, declaration, report)) return null;
  return Object.freeze({
    id: declaration.id,
    width: rows[0]!.length,
    height: rows.length,
    cells: buildStampCells(rows, mappings),
    span: declaration.span,
  });
};

/** Prepare and validate declared texture stamps against palette mappings. */
export const prepareStamps = (
  declarations: readonly ProgramTextureStampDecl[],
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter,
): ReadonlyMap<string, TextureStamp> | null => {
  const result = new Map<string, TextureStamp>();
  let valid = true;
  const sorted = [...declarations].sort((left, right) => compareText(left.id, right.id));
  for (const declaration of sorted) {
    if (typeof declaration.id !== 'string' || result.has(declaration.id)) {
      report.report(
        declaration.span,
        'asset.texture.duplicate-stamp',
        'Texture stamp identifiers must be unique.',
      );
      valid = false;
      continue;
    }
    const stamp = prepareStamp(declaration, context, palette, report);
    if (stamp === null) valid = false;
    else result.set(declaration.id, stamp);
  }
  return valid ? result : null;
};
