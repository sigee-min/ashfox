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
  readTexelVector,
  type TextureExpressionContext,
} from './expressions';
import { readPalette, readRole, type PaletteRole } from './palette';
import type { TextureStamp } from './raster';
import { prepareStamps, MAX_STAMP_PIXELS } from './stamps';
import { integerContract, propertyIssue, type TextureReporter } from './report';

export const MAX_PIXELS = 4096 * 4096;
export { MAX_STAMP_PIXELS };

const ALLOWED_TOP_STATEMENTS = new Set([
  'property',
  'palette',
  'chart',
  'grain',
  'tone',
  'stamp-decl',
]);

const textureProperties = (
  payload: ProgramTextureDecl,
  report: TextureReporter,
): ReadonlyMap<string, ProgramProperty> | null => {
  const entries = payload.statements.filter(
    (statement): statement is ProgramProperty => statement.kind === 'property',
  );
  return properties(
    entries,
    ['atlas', 'background', 'background_alpha', 'density', 'render_mode'],
    payload.span,
    report.path,
    propertyIssue(report),
  );
};

const readTextureDensity = (
  entry: ProgramProperty | undefined,
  context: TextureExpressionContext,
  report: TextureReporter,
): 1 | 2 | 4 | null => {
  if (entry === undefined) return 1;
  const val = readInteger(
    entry.value,
    context,
    'plain',
    report.path,
    propertyIssue(report),
    entry.span,
  );
  if (val === 1n) return 1;
  if (val === 2n) return 2;
  if (val === 4n) return 4;
  report.report(
    entry.value.span,
    'asset.texture.invalid-density',
    'Texture density must be 1, 2, or 4.',
  );
  return null;
};

const readRenderMode = (
  entry: ProgramProperty | undefined,
  report: TextureReporter,
): 'default' | 'emissive' | null => {
  if (entry === undefined) return 'default';
  if (
    entry.value.kind === 'name' &&
    (entry.value.value === 'default' || entry.value.value === 'emissive')
  ) {
    return entry.value.value;
  }
  report.report(
    entry.value.span,
    'asset.texture.invalid-render-mode',
    'Texture render_mode must be default or emissive.',
  );
  return null;
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

const readContractAtlas = (
  contract: TypedSurfaceContract,
  report: TextureReporter,
): readonly [number, number] | null => {
  if (contract.atlas === null) return null;
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
  return [contractWidth, contractHeight] as const;
};

const readAtlasDimensions = (
  atlas: ProgramProperty | undefined,
  context: TextureExpressionContext,
  contract: TypedSurfaceContract,
  report: TextureReporter,
): Readonly<{ readonly explicit: readonly [number, number] | null }> | null => {
  const fromContract = readContractAtlas(contract, report);
  if (contract.atlas !== null && fromContract === null) return null;
  if (atlas === undefined) return { explicit: fromContract };
  const atlasValue = readTexelVector(
    atlas.value,
    context,
    2,
    report.path,
    propertyIssue(report),
    atlas.span,
  );
  if (
    atlasValue === null ||
    atlasValue[0]! <= 0 ||
    atlasValue[1]! <= 0 ||
    atlasValue[0]! * atlasValue[1]! > MAX_PIXELS
  ) {
    report.report(
      atlas.value.span,
      'asset.texture.invalid-atlas',
      'Texture atlas dimensions must be positive texels within bounds.',
    );
    return null;
  }
  if (
    fromContract !== null &&
    (atlasValue[0] !== fromContract[0] || atlasValue[1] !== fromContract[1])
  ) {
    report.report(
      atlas.value.span,
      'asset.texture.atlas-mismatch',
      'Texture atlas dimensions must equal the surface contract.',
    );
    return null;
  }
  return { explicit: [atlasValue[0]!, atlasValue[1]!] as const };
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

const readGrainBlock = (
  payload: ProgramTextureDecl,
  grains: readonly ProgramTextureGrain[],
  report: TextureReporter,
): ProgramTextureGrain | null => {
  if (grains.length > 1) {
    report.report(
      grains[1]!.span,
      'asset.texture.grain-count',
      'Texture may declare at most one grain block.',
    );
    return null;
  }
  if (grains.length === 0) {
    return { kind: 'grain', algorithm: 'none', seed: null, span: payload.span };
  }
  const grain = grains[0]!;
  if (grain.seed !== null && grain.seed.name !== 'seed') {
    report.report(
      grain.seed.span,
      'asset.texture.invalid-grain',
      'Grain accepts only the seed property.',
    );
    return null;
  }
  return grain;
};

const readTextureBlocks = (
  payload: ProgramTextureDecl,
  report: TextureReporter,
): Readonly<{
  readonly palette: ProgramTexturePalette;
  readonly grain: ProgramTextureGrain;
  readonly tone: 'none' | 'voxel' | 'painterly';
}> | null => {
  const palettes = payload.statements.filter(
    (entry): entry is ProgramTexturePalette => entry.kind === 'palette',
  );
  const grains = payload.statements.filter(
    (entry): entry is ProgramTextureGrain => entry.kind === 'grain',
  );
  const tones = payload.statements.filter(
    (entry): entry is Extract<ProgramTextureDecl['statements'][number], { kind: 'tone' }> =>
      entry.kind === 'tone',
  );
  if (palettes.length !== 1) {
    report.report(
      payload.span,
      'asset.texture.palette-count',
      'Texture requires exactly one palette block.',
    );
    return null;
  }
  const grain = readGrainBlock(payload, grains, report);
  if (grain === null) return null;
  if (tones.length > 1) {
    report.report(
      tones[1]!.span,
      'asset.texture.duplicate-tone',
      'Texture may declare tone only once.',
    );
    return null;
  }
  const tone = tones[0]?.mode ?? 'none';
  return { palette: palettes[0]!, grain, tone };
};

export interface PreparedTexture {
  readonly width: number;
  readonly height: number;
  readonly density: 1 | 2 | 4;
  readonly renderMode: 'default' | 'emissive';
  readonly background: string;
  readonly backgroundAlpha: 0 | 255;
  readonly palette: ReadonlyMap<string, PaletteRole>;
  readonly stamps: ReadonlyMap<string, TextureStamp>;
  readonly charts: readonly PreparedChart[];
  readonly grain: ProgramTextureGrain;
  readonly tone: 'none' | 'voxel' | 'painterly';
}

const readRequiredHeader = (
  payload: ProgramTextureDecl,
  context: TextureExpressionContext,
  contract: TypedSurfaceContract,
  report: TextureReporter,
): Readonly<{
  readonly background: ProgramProperty;
  readonly explicitAtlas: readonly [number, number] | null;
  readonly backgroundAlpha: 0 | 255;
  readonly density: 1 | 2 | 4;
  readonly renderMode: 'default' | 'emissive';
}> | null => {
  const top = textureProperties(payload, report);
  if (top === null) return null;
  const atlas = top.get('atlas');
  const background = top.get('background');
  const alpha = top.get('background_alpha');
  if (background === undefined || alpha === undefined) {
    report.report(
      payload.span,
      'asset.texture.missing-property',
      'Texture requires background and background_alpha properties.',
    );
    return null;
  }
  const dimensions = readAtlasDimensions(atlas, context, contract, report);
  const backgroundAlpha = readBackgroundAlpha(alpha, context, report);
  const density = readTextureDensity(top.get('density'), context, report);
  const renderMode = readRenderMode(top.get('render_mode'), report);
  if (dimensions === null || backgroundAlpha === null || density === null || renderMode === null) {
    return null;
  }
  return {
    background,
    explicitAtlas: dimensions.explicit,
    backgroundAlpha,
    density,
    renderMode,
  };
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
  const layout = prepareCharts(
    payload,
    contract,
    header.explicitAtlas,
    header.density,
    usages,
    context,
    palette,
    report,
  );
  if (layout === null || report.bad) return null;
  const bg = selectedBackground.role;
  const background = bg.kind === 'ramp' ? bg.base : bg.color;
  return Object.freeze({
    width: layout.atlas[0],
    height: layout.atlas[1],
    density: header.density,
    renderMode: header.renderMode,
    background,
    backgroundAlpha: header.backgroundAlpha,
    palette,
    stamps,
    charts: layout.charts,
    grain: blocks.grain,
    tone: blocks.tone,
  });
};
