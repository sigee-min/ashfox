import type {
  ProgramProperty,
  ProgramTextureDecl,
  ProgramTextureGrain,
  ProgramTexturePalette,
  ProgramTextureStampDecl,
} from '../../../../project/program/syntax/contract';
import type { TypedSurfaceContract } from '../contract';
import { prepareCharts, type PreparedChart } from './chart';
import type { AssetTextureUsage } from './contract';
import {
  properties,
  readInteger,
  readStampPixels,
  readTexelVector,
  type TextureExpressionContext,
} from './expressions';
import { readPalette, readRole, type PaletteRole } from './palette';
import type { TextureStamp, TextureStampCell } from './raster';
import { integerContract, propertyIssue, type TextureReporter } from './report';

export const MAX_PIXELS = 4096 * 4096;
export const MAX_STAMP_PIXELS = 16_384;

const ALLOWED_TOP_STATEMENTS = new Set([
  'property',
  'palette',
  'chart',
  'grain',
  'tone',
  'stamp-decl',
]);

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
  });
};

const prepareStamps = (
  declarations: readonly ProgramTextureStampDecl[],
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter,
): ReadonlyMap<string, TextureStamp> | null => {
  const result = new Map<string, TextureStamp>();
  let valid = true;
  const sorted = [...declarations].sort((left, right) => left.id.localeCompare(right.id));
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

const textureProperties = (
  payload: ProgramTextureDecl,
  report: TextureReporter,
): ReadonlyMap<string, ProgramProperty> | null => {
  const entries = payload.statements.filter(
    (statement): statement is ProgramProperty => statement.kind === 'property',
  );
  return properties(
    entries,
    ['atlas', 'background', 'background-alpha'],
    payload.span,
    report.path,
    propertyIssue(report),
  );
};

const validateTopStatements = (payload: ProgramTextureDecl, report: TextureReporter): boolean => {
  for (const statement of payload.statements) {
    if (!ALLOWED_TOP_STATEMENTS.has(statement.kind)) {
      report.report(
        payload.span,
        'asset.texture.invalid-statement',
        'Texture contains an unsupported top-level statement.',
      );
    }
  }
  return !report.bad;
};

const readAtlasDimensions = (
  atlas: ProgramProperty,
  context: TextureExpressionContext,
  contract: TypedSurfaceContract,
  report: TextureReporter,
): readonly [number, number] | null => {
  const contractWidth = integerContract(
    contract.atlas.width,
    report,
    contract.atlas.span,
    'Atlas width',
  );
  const contractHeight = integerContract(
    contract.atlas.height,
    report,
    contract.atlas.span,
    'Atlas height',
  );
  if (
    contractWidth === null ||
    contractHeight === null ||
    contractWidth * contractHeight > MAX_PIXELS
  ) {
    return null;
  }
  const atlasValue = readTexelVector(
    atlas.value,
    context,
    2,
    report.path,
    propertyIssue(report),
    atlas.span,
  );
  if (atlasValue === null || atlasValue[0] !== contractWidth || atlasValue[1] !== contractHeight) {
    report.report(
      atlas.value.span,
      'asset.texture.atlas-mismatch',
      'Texture atlas dimensions must equal the surface contract.',
    );
    return null;
  }
  return [contractWidth, contractHeight] as const;
};

const readBackgroundAlpha = (
  alpha: ProgramProperty,
  context: TextureExpressionContext,
  report: TextureReporter,
): 0 | 255 | null => {
  const alphaValue = readInteger(
    alpha.value,
    context,
    'plain',
    report.path,
    propertyIssue(report),
    alpha.span,
  );
  if (alphaValue !== 0n && alphaValue !== 255n) {
    report.report(
      alpha.value.span,
      'asset.texture.invalid-alpha',
      'Texture background alpha must be exactly zero or 255.',
    );
    return null;
  }
  return alphaValue === 0n ? 0 : 255;
};

const readTextureBlocks = (
  payload: ProgramTextureDecl,
  report: TextureReporter,
): Readonly<{
  readonly palette: ProgramTexturePalette;
  readonly grain: ProgramTextureGrain;
  readonly tone: boolean;
}> | null => {
  const palettes = payload.statements.filter(
    (entry): entry is ProgramTexturePalette => entry.kind === 'palette',
  );
  const grains = payload.statements.filter(
    (entry): entry is ProgramTextureGrain => entry.kind === 'grain',
  );
  const tones = payload.statements.filter((entry) => entry.kind === 'tone');
  if (palettes.length !== 1) {
    report.report(
      payload.span,
      'asset.texture.palette-count',
      'Texture requires exactly one palette block.',
    );
    return null;
  }
  if (grains.length !== 1 || grains[0]!.algorithm !== 'clustered') {
    report.report(
      payload.span,
      'asset.texture.grain-count',
      'Texture requires exactly one clustered grain block.',
    );
    return null;
  }
  if (grains[0]!.seed !== null && grains[0]!.seed.name !== 'seed') {
    report.report(
      grains[0]!.seed.span,
      'asset.texture.invalid-grain',
      'Clustered grain accepts only the seed property.',
    );
    return null;
  }
  if (tones.length > 1) {
    report.report(
      tones[1]!.span,
      'asset.texture.duplicate-tone',
      'Texture may declare tone voxel only once.',
    );
    return null;
  }
  return { palette: palettes[0]!, grain: grains[0]!, tone: tones.length === 1 };
};

export interface PreparedTexture {
  readonly background: string;
  readonly backgroundAlpha: 0 | 255;
  readonly palette: ReadonlyMap<string, PaletteRole>;
  readonly stamps: ReadonlyMap<string, TextureStamp>;
  readonly charts: readonly PreparedChart[];
  readonly grain: ProgramTextureGrain;
  readonly tone: boolean;
}

const readRequiredHeader = (
  payload: ProgramTextureDecl,
  context: TextureExpressionContext,
  contract: TypedSurfaceContract,
  report: TextureReporter,
): Readonly<{
  readonly background: ProgramProperty;
  readonly dimensions: readonly [number, number];
  readonly backgroundAlpha: 0 | 255;
}> | null => {
  const top = textureProperties(payload, report);
  if (top === null) return null;
  const atlas = top.get('atlas');
  const background = top.get('background');
  const alpha = top.get('background-alpha');
  if (atlas === undefined || background === undefined || alpha === undefined) {
    report.report(
      payload.span,
      'asset.texture.missing-property',
      'Texture requires atlas, background, and background-alpha properties.',
    );
    return null;
  }
  const dimensions = readAtlasDimensions(atlas, context, contract, report);
  if (dimensions === null) return null;
  const backgroundAlpha = readBackgroundAlpha(alpha, context, report);
  if (backgroundAlpha === null) return null;
  return { background, dimensions, backgroundAlpha };
};

/** Validate and lower a surface texture declaration into prepared charts, palette, and stamps. */
export const prepareTexture = (
  payload: ProgramTextureDecl,
  context: TextureExpressionContext,
  contract: TypedSurfaceContract,
  usages: readonly AssetTextureUsage[],
  report: TextureReporter,
): PreparedTexture | null => {
  if (!validateTopStatements(payload, report)) return null;
  const header = readRequiredHeader(payload, context, contract, report);
  if (header === null) return null;
  const blocks = readTextureBlocks(payload, report);
  if (blocks === null) return null;
  const palette = readPalette(blocks.palette, context, report.path, propertyIssue(report));
  if (palette === null) return null;
  const selectedBackground = readRole(
    header.background.value,
    palette,
    false,
    report.path,
    propertyIssue(report),
    header.background.span,
  );
  if (selectedBackground === null) return null;
  const declarations = payload.statements.filter(
    (entry): entry is ProgramTextureStampDecl => entry.kind === 'stamp-decl',
  );
  const stamps = prepareStamps(declarations, context, palette, report);
  if (stamps === null) return null;
  const charts = prepareCharts(
    payload,
    contract,
    header.dimensions[0],
    header.dimensions[1],
    usages,
    context,
    palette,
    report,
  );
  if (charts === null || report.bad) return null;
  const bg = selectedBackground.role;
  const background = bg.kind === 'ramp' ? bg.base : bg.color;
  return Object.freeze({
    background,
    backgroundAlpha: header.backgroundAlpha,
    palette,
    stamps,
    charts,
    grain: blocks.grain,
    tone: blocks.tone,
  });
};
