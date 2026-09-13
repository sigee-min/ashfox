import type {
  ProgramProperty,
  ProgramTextureChart,
  ProgramTextureDecl,
  ProgramTextureGrain,
  ProgramTextureStampDecl
} from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import type { AssetTexelValue, TypedSurface, TypedSurfaceContract } from '../contract';
import type {
  AssetTextureIssue,
  AssetTextureUsage
} from './contract';
import {
  createTextureExpressionContext,
  properties,
  readInteger,
  readPalette,
  readRole,
  readStampPixels,
  readTexelVector,
  toSafeNumber,
  type PaletteRole,
  type TextureExpressionContext
} from './expressions';
import { hasChartOverlap } from './overlap';
import { boxRegions, type TextureRegion, type TextureStamp } from './raster';

export const MAX_PIXELS = 4096 * 4096;
export const MAX_STAMP_PIXELS = 16_384;

export type TextureReporter = {
  readonly path: string;
  readonly owner: SourceSpan;
  readonly issue: AssetTextureIssue;
  bad: boolean;
  sinkFailed: boolean;
  report: (span: SourceSpan, code: string, message: string) => void;
};

export const createTextureReporter = (
  path: string,
  owner: SourceSpan,
  issue: AssetTextureIssue
): TextureReporter => {
  const result = { path, owner, issue, bad: false, sinkFailed: false } as TextureReporter;
  result.report = (span, code, message): void => {
    result.bad = true;
    try { issue(path, span, code, message); }
    catch (error) { result.sinkFailed = true; throw error; }
  };
  return result;
};

export const propertyIssue = (report: TextureReporter): AssetTextureIssue =>
  (_path, span, code, message): void => report.report(span, code, message);

export const ownEntries = <T>(value: Readonly<Record<string, T>>): readonly [string, T][] =>
  Object.keys(value).sort().map((key) => [key, value[key]!] as [string, T]);

export const integerContract = (
  value: AssetTexelValue,
  report: TextureReporter,
  span: SourceSpan,
  label: string
): number | null => {
  const exact = value === null || typeof value !== 'object' ? null : value.value;
  if (exact === null || typeof exact !== 'object' || typeof exact.numerator !== 'bigint' ||
    typeof exact.denominator !== 'bigint' || typeof exact.unit !== 'string') {
    report.report(span, 'asset.texture.invalid-contract', label + ' is malformed.');
    return null;
  }
  if (exact.unit !== 'texel' || exact.denominator !== 1n) {
    report.report(span, 'asset.texture.invalid-contract', label + ' must be an integral texel.');
    return null;
  }
  const converted = toSafeNumber(exact.numerator);
  if (converted === null || converted <= 0 || converted > 4096) {
    report.report(span, 'asset.texture.invalid-contract', label + ' is outside the atlas limit.');
    return null;
  }
  return converted;
};

export const surfacePayload = (
  surface: TypedSurface,
  report: TextureReporter
): ProgramTextureDecl | null => {
  const source = surface.textureSource;
  if (source === null || typeof source !== 'object' || source.payload === null ||
    typeof source.payload !== 'object' || !Array.isArray(source.payload.statements)) {
    report.report(source?.span ?? surface.span, 'asset.missing-surface-texture',
      'A concrete surface must directly own a texture payload.');
    return null;
  }
  return source.payload;
};

const prepareStamp = (
  declaration: ProgramTextureStampDecl,
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter
): TextureStamp | null => {
  const pixels = readStampPixels(declaration, context, report.path, propertyIssue(report));
  if (pixels === null) return null;
  const rows = pixels.split('/'); const width = rows[0]?.length ?? 0;
  if (width < 1 || rows.length < 1 || width * rows.length > MAX_STAMP_PIXELS ||
    rows.some((row) => row.length !== width || !/^[.a-z0-9]+$/u.test(row))) {
    report.report(declaration.span, 'asset.texture.invalid-stamp',
      'Stamp pixels must be bounded equal-width rows using dot or lowercase symbols.');
    return null;
  }
  const mappings = new Map<string, string>(); let valid = true;
  for (const entry of declaration.properties) {
    if (entry.name === 'pixels') continue;
    if (!/^[a-z0-9]$/u.test(entry.name) || mappings.has(entry.name)) {
      report.report(entry.span, 'asset.texture.invalid-stamp',
        'Stamp mappings require one unique lowercase symbol.');
      valid = false; continue;
    }
    const role = readRole(entry.value, palette, false, report.path,
      propertyIssue(report), declaration.span);
    if (role === null) valid = false; else mappings.set(entry.name, role.name);
  }
  const symbols = new Set<string>([...rows.join('')].filter((symbol) => symbol !== '.'));
  for (const symbol of symbols) if (!mappings.has(symbol)) {
    report.report(declaration.span, 'asset.texture.invalid-stamp',
      'Stamp symbol "' + symbol + '" has no palette mapping.');
    valid = false;
  }
  for (const symbol of mappings.keys()) if (!symbols.has(symbol)) {
    report.report(declaration.span, 'asset.texture.invalid-stamp',
      'Stamp mapping "' + symbol + '" is unused.');
    valid = false;
  }
  if (!valid) return null;
  const cells = rows.flatMap((row) => [...row].map((symbol) => symbol === '.'
    ? null : Object.freeze({ role: mappings.get(symbol)! })));
  return Object.freeze({ id: declaration.id, width, height: rows.length,
    cells: Object.freeze(cells) });
};

const prepareStamps = (
  declarations: readonly ProgramTextureStampDecl[],
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter
): ReadonlyMap<string, TextureStamp> | null => {
  const result = new Map<string, TextureStamp>(); let valid = true;
  for (const declaration of [...declarations].sort((left, right) => left.id.localeCompare(right.id))) {
    if (typeof declaration.id !== 'string' || result.has(declaration.id)) {
      report.report(declaration.span, 'asset.texture.duplicate-stamp',
        'Texture stamp identifiers must be unique.');
      valid = false; continue;
    }
    const stamp = prepareStamp(declaration, context, palette, report);
    if (stamp === null) valid = false; else result.set(declaration.id, stamp);
  }
  return valid ? result : null;
};

const flatRegion = (width: number, height: number): TextureRegion => Object.freeze({
  x: 0, y: 0, width, height, pointAt: (x: number, y: number) => [x, y, 0] as const
});

const usageMatches = (left: AssetTextureUsage['shape'], right: AssetTextureUsage['shape']): boolean =>
  left.kind === right.kind && left.size.length === right.size.length &&
  left.size.every((value, index) => value === right.size[index]);

const usageRegions = (
  chart: ProgramTextureChart,
  width: number,
  height: number,
  usages: readonly AssetTextureUsage[],
  report: TextureReporter
): readonly TextureRegion[] | null => {
  const matches = usages; // Already grouped by chart within this preparation.
  if (matches.length === 0) {
    report.report(chart.span, 'asset.texture.unused-chart',
      'Every texture chart must have a geometry usage with exact dimensions.');
    return null;
  }
  const first = matches[0]!;
  if (matches.some((usage) => !usageMatches(first.shape, usage.shape))) {
    report.report(matches[1]!.span, 'asset.texture.usage-mismatch',
      'A chart may be used more than once only with identical geometry dimensions.');
    return null;
  }
  const shape = first.shape;
  if (shape.kind === 'flat') {
    if (shape.size[0] !== width || shape.size[1] !== height) {
      report.report(first.span, 'asset.texture.chart-size-mismatch',
        'Flat geometry size must equal its contract chart dimensions.');
      return null;
    }
    return Object.freeze([flatRegion(width, height)]);
  }
  const expectedWidth = 2 * shape.size[0] + 2 * shape.size[2];
  const expectedHeight = shape.size[1] + shape.size[2];
  if (expectedWidth !== width || expectedHeight !== height) {
    report.report(first.span, 'asset.texture.chart-size-mismatch',
      'Box geometry dimensions must equal the contract chart net dimensions.');
    return null;
  }
  const regions = boxRegions(shape.size);
  if (regions === null || regions.some((region) => region.x + region.width > width ||
    region.y + region.height > height)) {
    report.report(first.span, 'asset.texture.invalid-chart-layout',
      'Box chart face regions do not fit the declared chart rectangle.');
    return null;
  }
  return regions;
};

export interface PreparedChart {
  readonly chart: ProgramTextureChart;
  readonly abiWidth: number;
  readonly abiHeight: number;
  readonly origin: readonly [number, number];
  readonly regions: readonly TextureRegion[];
  readonly coverage: string | null;
}

const chartCoverage = (
  chart: ProgramTextureChart,
  width: number,
  height: number,
  policy: 'opaque' | 'binary' | 'optional',
  report: TextureReporter
): string | null => {
  const entries = chart.statements.filter((entry) => entry.kind === 'coverage');
  if (entries.length > 1) {
    report.report(entries[1]!.span, 'asset.texture.duplicate-coverage',
      'A chart may declare coverage only once.');
    return null;
  }
  const bits = entries[0]?.bits ?? null;
  if (policy === 'binary' && bits === null) {
    report.report(chart.span, 'asset.texture.missing-coverage', 'A binary chart requires a coverage payload.');
    return null;
  }
  if (bits !== null && (chart.layout !== 'flat' || !/^[01]+$/u.test(bits) || bits.length !== width * height)) {
    report.report(entries[0]?.span ?? chart.span, 'asset.texture.coverage-mismatch',
      'Coverage must be binary and contain exactly one bit per flat chart texel.');
    return null;
  }
  if (policy === 'opaque' && bits !== null) {
    report.report(entries[0]!.span, 'asset.texture.coverage-mismatch',
      'Opaque charts may not declare transparent coverage.');
    return null;
  }
  return bits;
};

const prepareChart = (
  chart: ProgramTextureChart,
  contractChart: TypedSurfaceContract['charts'][string],
  atlasWidth: number,
  atlasHeight: number,
  usages: readonly AssetTextureUsage[],
  context: TextureExpressionContext,
  palette: ReadonlyMap<string, PaletteRole>,
  report: TextureReporter
): PreparedChart | null => {
  if (chart.layout !== contractChart.layout) {
    report.report(chart.span, 'asset.texture.chart-layout-mismatch', 'Texture chart layout does not match its contract.');
    return null;
  }
  const width = integerContract(contractChart.width, report, contractChart.span, 'Chart width');
  const height = integerContract(contractChart.height, report, contractChart.span, 'Chart height');
  if (width === null || height === null) return null;
  const entries = properties(chart.statements.filter((entry): entry is ProgramProperty => entry.kind === 'property'),
    ['origin', 'fill'], chart.span, report.path, propertyIssue(report));
  if (entries === null) return null;
  const originEntry = entries.get('origin'); const fillEntry = entries.get('fill');
  if (originEntry === undefined || fillEntry === undefined) {
    report.report(chart.span, 'asset.texture.missing-property', 'Every chart requires origin and fill properties.');
    return null;
  }
  const origin = readTexelVector(originEntry.value, context, 2, report.path,
    propertyIssue(report), originEntry.span);
  if (origin === null || origin[0]! < 0 || origin[1]! < 0) {
    report.report(originEntry.value.span, 'asset.texture.invalid-origin',
      'Chart origin must be a non-negative integral texel coordinate.');
    return null;
  }
  const regions = usageRegions(chart, width, height, usages, report);
  const selected = readRole(fillEntry.value, palette, true, report.path,
    propertyIssue(report), fillEntry.span);
  if (regions === null || selected === null) return null;
  if (origin[0]! + width > atlasWidth || origin[1]! + height > atlasHeight) {
    report.report(originEntry.value.span, 'asset.texture.out-of-bounds', 'Chart lies outside the permitted texture atlas.');
    return null;
  }
  const coverage = chartCoverage(chart, width, height, contractChart.coverage, report);
  if (coverage === null && contractChart.coverage === 'binary') return null;
  return Object.freeze({ chart, abiWidth: width, abiHeight: height,
    origin: [origin[0]!, origin[1]!] as const, regions, coverage });
};

const textureProperties = (
  payload: ProgramTextureDecl,
  report: TextureReporter
): ReadonlyMap<string, ProgramProperty> | null => {
  const entries: ProgramProperty[] = [];
  for (const statement of payload.statements) if (statement.kind === 'property') entries.push(statement);
  return properties(entries, ['atlas', 'background', 'background-alpha'], payload.span,
    report.path, propertyIssue(report));
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

export const prepareTexture = (
  payload: ProgramTextureDecl,
  context: TextureExpressionContext,
  contract: TypedSurfaceContract,
  usages: readonly AssetTextureUsage[],
  report: TextureReporter
): PreparedTexture | null => {
  const allowedKinds = new Set(['property', 'palette', 'chart', 'grain', 'tone', 'stamp-decl']);
  for (const statement of payload.statements) {
    if (!allowedKinds.has(statement.kind)) {
      report.report(payload.span, 'asset.texture.invalid-statement',
        'Texture contains an unsupported top-level statement.');
    }
  }
  if (report.bad) return null;
  const top = textureProperties(payload, report);
  if (top === null) return null;
  const atlas = top.get('atlas'); const background = top.get('background'); const alpha = top.get('background-alpha');
  if (atlas === undefined || background === undefined || alpha === undefined) {
    report.report(payload.span, 'asset.texture.missing-property',
      'Texture requires atlas, background, and background-alpha properties.');
    return null;
  }
  const contractWidth = integerContract(contract.atlas.width, report, contract.atlas.span, 'Atlas width');
  const contractHeight = integerContract(contract.atlas.height, report, contract.atlas.span, 'Atlas height');
  if (contractWidth === null || contractHeight === null || contractWidth * contractHeight > MAX_PIXELS) return null;
  const atlasValue = readTexelVector(atlas.value, context, 2, report.path, propertyIssue(report), atlas.span);
  if (atlasValue === null || atlasValue[0] !== contractWidth || atlasValue[1] !== contractHeight) {
    report.report(atlas.value.span, 'asset.texture.atlas-mismatch', 'Texture atlas dimensions must equal the surface contract.');
    return null;
  }
  const alphaValue = readInteger(alpha.value, context, 'plain', report.path, propertyIssue(report), alpha.span);
  if (alphaValue !== 0n && alphaValue !== 255n) {
    report.report(alpha.value.span, 'asset.texture.invalid-alpha', 'Texture background alpha must be exactly zero or 255.');
    return null;
  }
  const palettes = payload.statements.filter((entry) => entry.kind === 'palette');
  const grains = payload.statements.filter((entry): entry is ProgramTextureGrain => entry.kind === 'grain');
  const tones = payload.statements.filter((entry) => entry.kind === 'tone');
  if (palettes.length !== 1) {
    report.report(payload.span, 'asset.texture.palette-count', 'Texture requires exactly one palette block.');
    return null;
  }
  if (grains.length !== 1 || grains[0]!.algorithm !== 'clustered') {
    report.report(payload.span, 'asset.texture.grain-count', 'Texture requires exactly one clustered grain block.');
    return null;
  }
  if (grains[0]!.seed !== null && grains[0]!.seed.name !== 'seed') {
    report.report(grains[0]!.seed.span, 'asset.texture.invalid-grain',
      'Clustered grain accepts only the seed property.');
    return null;
  }
  if (tones.length > 1) {
    report.report(tones[1]!.span, 'asset.texture.duplicate-tone', 'Texture may declare tone voxel only once.');
    return null;
  }
  const palette = readPalette(palettes[0]!, context, report.path, propertyIssue(report));
  if (palette === null) return null;
  const selectedBackground = readRole(background.value, palette, false, report.path,
    propertyIssue(report), background.span);
  if (selectedBackground === null) return null;
  const declarations = payload.statements.filter((entry): entry is ProgramTextureStampDecl => entry.kind === 'stamp-decl');
  const stamps = prepareStamps(declarations, context, palette, report);
  if (stamps === null) return null;
  const sources = payload.statements.filter((entry): entry is ProgramTextureChart => entry.kind === 'chart');
  const sourcesById = new Map<string, ProgramTextureChart[]>();
  for (const source of sources) {
    const entries = sourcesById.get(source.id);
    if (entries) entries.push(source); else sourcesById.set(source.id, [source]);
  }
  const usagesByChart = new Map<string, AssetTextureUsage[]>();
  for (const usage of usages) {
    const entries = usagesByChart.get(usage.chart);
    if (entries) entries.push(usage); else usagesByChart.set(usage.chart, [usage]);
  }
  const entries = ownEntries(contract.charts); const charts: PreparedChart[] = [];
  for (const [id, abi] of entries) {
    const matches = sourcesById.get(id) ?? [];
    if (matches.length !== 1) {
      report.report(matches[1]?.span ?? payload.span, 'asset.texture.chart-count', 'Texture must declare each contract chart exactly once.');
      continue;
    }
    const chart = prepareChart(matches[0]!, abi, contractWidth, contractHeight,
      usagesByChart.get(id) ?? [], context, palette, report);
    if (chart !== null) charts.push(chart);
  }
  for (const chart of sources) if (contract.charts[chart.id] === undefined) {
    report.report(chart.span, 'asset.texture.unknown-chart', 'Texture chart is not declared by the surface contract.');
  }
  if (charts.length !== entries.length) return null;
  charts.sort((left, right) => left.chart.id.localeCompare(right.chart.id));
  if (charts.length < 32 || hasChartOverlap(charts)) {
    for (let left = 0; left < charts.length; left += 1) for (let right = left + 1; right < charts.length; right += 1) {
      const a = charts[left]!; const b = charts[right]!;
      if (a.origin[0] < b.origin[0] + b.abiWidth && b.origin[0] < a.origin[0] + a.abiWidth &&
        a.origin[1] < b.origin[1] + b.abiHeight && b.origin[1] < a.origin[1] + a.abiHeight) {
        report.report(b.chart.span, 'asset.texture.overlap', 'Texture chart rectangles may not overlap.');
      }
    }
  }
  if (report.bad) return null;
  return Object.freeze({ background: selectedBackground.role.kind === 'ramp'
    ? selectedBackground.role.base : selectedBackground.role.color,
    backgroundAlpha: alphaValue === 0n ? 0 : 255,
    palette, stamps, charts: Object.freeze(charts), grain: grains[0]!, tone: tones.length === 1 });
};

export const expressionContextFor = (
  surface: TypedSurface,
  contract: TypedSurfaceContract,
  path: string,
  report: TextureReporter
): TextureExpressionContext | null => createTextureExpressionContext(
  surface.slots, contract.slots, path, surface.span, propertyIssue(report));
