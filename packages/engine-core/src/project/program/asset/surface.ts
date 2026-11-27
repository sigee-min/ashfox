import type { ProgramTextureDecl, ProgramTextureStatement } from '../syntax/contract';
import { parseProgramTextureStatement, type ProgramTextureReader } from '../syntax/texture';
import { docsHint, formatDidYouMean } from '../../source/suggest';
import type {
  AssetAtlasDecl,
  AssetChartAbiDecl,
  AssetPropertyDecl,
  AssetSlotDecl,
  AssetSurfaceContractDecl,
  AssetSurfaceDecl,
} from './contract';
import {
  checkClosedProperties,
  isOneOf,
  join,
  nameOr,
  propertyValue,
  readBraced,
  readProperties,
  readProperty,
  valueName,
  type AssetReader,
} from './parserSupport';

const textureReader = (reader: AssetReader): ProgramTextureReader => ({
  current: () => reader.current(),
  take: () => reader.take(),
  checkWord: (value) => reader.checkWord(value),
  expect: (value, message) => reader.expect(value, message),
  fail: (code, message, token, hint) =>
    reader.fail(code.replace(/^(?:model|program)\./, 'asset.'), message, token, hint),
  abort: () => reader.abort(),
  name: (message) => reader.name(message),
  word: (message) => reader.word(message),
  expression: () => reader.expression(),
  finish: () => reader.finish(),
  finishEnd: () => reader.finishEnd(),
  block: <T>(read: () => T): T[] => reader.block(read),
  blockEnd: () => reader.blockEnd(),
  property: () => readProperty(reader),
});

const readTexture = (reader: AssetReader): ProgramTextureDecl => {
  const start = reader.expectWord('texture', 'Expected texture.');
  const id = reader.name('Expected a texture name.');
  const statements = reader.block<ProgramTextureStatement>(() =>
    parseProgramTextureStatement(textureReader(reader)),
  );
  return Object.freeze({
    kind: 'texture',
    id,
    statements: Object.freeze(statements),
    span: join(start.span, reader.blockEnd()),
  });
};

const readSlot = (reader: AssetReader, contract: boolean): AssetSlotDecl => {
  const start = reader.expectWord('slot', 'Expected slot.');
  const id = reader.id('Expected a slot name.');
  if (contract) {
    reader.expect(':', 'Contract slots require a type.');
    const type = reader.valueType();
    reader.finish();
    return Object.freeze({
      kind: 'slot',
      id: id.value,
      type,
      value: null,
      span: join(start.span, id.span),
    });
  }
  reader.expect('=', 'Surface and material slots require a value.');
  const value = reader.expression();
  reader.finish();
  return Object.freeze({
    kind: 'slot',
    id: id.value,
    type: 'unit',
    value,
    span: join(start.span, value.span),
  });
};

const readAtlas = (reader: AssetReader): AssetAtlasDecl => {
  const start = reader.expectWord('atlas', 'Expected atlas.');
  const values = readProperties(reader, 'surface atlas');
  checkClosedProperties(reader, values, ['width', 'height'], 'surface atlas');
  return Object.freeze({
    kind: 'atlas',
    width: propertyValue(values, 'width') ?? null,
    height: propertyValue(values, 'height') ?? null,
    span: join(start.span, reader.prevSpan()),
  });
};

const readChartAbi = (reader: AssetReader): AssetChartAbiDecl => {
  const start = reader.expectWord('chart', 'Expected chart.');
  const id = reader.id('Expected chart name.');
  const layoutToken = reader.id('Expected chart layout box or flat.');
  const layout = layoutToken.value as AssetChartAbiDecl['layout'];
  if (layout !== 'box' && layout !== 'flat') {
    reader.fail(
      'asset.invalid-chart-layout',
      `Chart layout must be box or flat.${formatDidYouMean(layout, ['box', 'flat'])}`,
      layoutToken,
      docsHint('surface'),
    );
  }
  const values = readProperties(reader, 'surface chart');
  checkClosedProperties(reader, values, ['width', 'height', 'coverage'], 'surface chart');
  const coverageRaw = nameOr(propertyValue(values, 'coverage'), 'opaque');
  const coverage = isOneOf(['opaque', 'binary', 'optional'] as const, coverageRaw)
    ? coverageRaw
    : null;
  if (coverage === null) {
    reader.fail(
      'asset.invalid-coverage',
      `Chart coverage must be opaque, binary, or optional.${coverageRaw ? formatDidYouMean(coverageRaw, ['opaque', 'binary', 'optional']) : ''}`,
      id,
      docsHint('surface'),
    );
  }
  return Object.freeze({
    kind: 'chart-abi',
    id: id.value,
    layout: layout === 'flat' ? 'flat' : 'box',
    width: propertyValue(values, 'width') ?? null,
    height: propertyValue(values, 'height') ?? null,
    coverage,
    span: join(start.span, reader.prevSpan()),
  });
};

interface MaterialState {
  material: AssetSurfaceContractDecl['material'];
  materialSeen: boolean;
  materialProperties?: AssetPropertyDecl[];
}

const assignMaterialMode = (
  reader: AssetReader,
  state: MaterialState,
  raw: string,
  span: import('../../source/contract').SourceSpan,
): void => {
  if (isOneOf(['opaque', 'cutout', 'double'] as const, raw)) state.material = raw;
  else {
    reader.failSpan(
      'asset.invalid-material',
      `Surface material must be opaque, cutout, or double.${raw ? formatDidYouMean(raw, ['opaque', 'cutout', 'double']) : ''}`,
      span,
      docsHint('surface'),
    );
  }
};

const readMaterial = (
  reader: AssetReader,
  state: MaterialState,
  ownerLabel: string,
  allowPbrBlock = false,
): void => {
  const start = reader.expectWord('material', 'Expected material.');
  if (state.materialSeen) {
    reader.failSpan(
      'asset.duplicate-material',
      ownerLabel + ' may contain only one material.',
      start.span,
    );
  }
  state.materialSeen = true;
  if (allowPbrBlock && (reader.check('{') || reader.current().kind === 'identifier')) {
    if (reader.current().kind === 'identifier') {
      const mode = reader.id('Expected material mode opaque, cutout, or double.');
      assignMaterialMode(reader, state, mode.value, mode.span);
    }
    const props = readProperties(reader, 'surface material');
    checkClosedProperties(
      reader,
      props,
      ['roughness', 'metallic', 'roughness_variation'],
      'surface material',
    );
    state.materialProperties = [...props];
    return;
  }
  reader.expect('=', 'Expected = after material.');
  const value = reader.expression();
  reader.finish();
  assignMaterialMode(reader, state, valueName(value) ?? '', value.span);
};

interface SurfaceContractState extends MaterialState {
  readonly slots: AssetSlotDecl[];
  readonly charts: AssetChartAbiDecl[];
  atlas: AssetAtlasDecl | null;
  atlasSeen: boolean;
}

const readSurfaceContractEntry = (reader: AssetReader, state: SurfaceContractState): void => {
  if (reader.checkWord('slot')) state.slots.push(readSlot(reader, true));
  else if (reader.checkWord('atlas')) {
    if (state.atlasSeen) {
      reader.failSpan(
        'asset.duplicate-atlas',
        'A surface contract may contain only one atlas.',
        reader.current().span,
      );
    }
    state.atlasSeen = true;
    state.atlas = readAtlas(reader);
  } else if (reader.checkWord('chart')) state.charts.push(readChartAbi(reader));
  else if (reader.checkWord('material')) readMaterial(reader, state, 'A surface contract');
  else reader.scopeError('surface contract');
};

interface SurfaceState extends MaterialState {
  readonly slots: AssetSlotDecl[];
  texture: ProgramTextureDecl | null;
  textureSeen: boolean;
}

const readSurfaceEntry = (reader: AssetReader, state: SurfaceState): void => {
  if (reader.checkWord('slot')) state.slots.push(readSlot(reader, false));
  else if (reader.checkWord('texture')) {
    if (state.textureSeen) {
      reader.failSpan(
        'asset.duplicate-texture',
        'A surface may contain only one texture.',
        reader.current().span,
      );
    }
    state.textureSeen = true;
    state.texture = readTexture(reader);
  } else if (reader.checkWord('material')) readMaterial(reader, state, 'A surface', true);
  else reader.scopeError('surface');
};

export const parseSurfaceContract = (
  reader: AssetReader,
  exported: boolean,
): AssetSurfaceContractDecl => {
  const start = reader.expectWord('contract', 'Expected contract after surface.');
  const id = reader.id('Expected a surface contract name.');
  const state: SurfaceContractState = {
    slots: [],
    charts: [],
    atlas: null,
    atlasSeen: false,
    material: null,
    materialSeen: false,
  };
  const close = readBraced(
    reader,
    'Expected { to begin a surface contract.',
    'Expected } to close a surface contract.',
    () => readSurfaceContractEntry(reader, state),
  );
  return Object.freeze({
    kind: 'surface-contract',
    exported,
    id: id.value,
    atlas: state.atlas,
    charts: Object.freeze(state.charts),
    material: state.material,
    slots: Object.freeze(state.slots),
    span: join(start.span, close.span),
  });
};

export const parseSurface = (reader: AssetReader, exported: boolean): AssetSurfaceDecl => {
  const start = reader.expectWord('surface', 'Expected surface.');
  const id = reader.id('Expected a surface name.');
  reader.expect(':', 'Expected : and a surface contract.');
  const contract = reader.qualified('Expected surface contract name.');
  const state: SurfaceState = {
    slots: [],
    texture: null,
    textureSeen: false,
    material: null,
    materialSeen: false,
    materialProperties: [],
  };
  const close = readBraced(
    reader,
    'Expected { to begin a surface.',
    'Expected } to close a surface.',
    () => readSurfaceEntry(reader, state),
  );
  return Object.freeze({
    kind: 'surface',
    exported,
    id: id.value,
    contract,
    texture: state.texture,
    material: state.material,
    ...(state.materialProperties && state.materialProperties.length > 0
      ? { materialProperties: Object.freeze(state.materialProperties) }
      : {}),
    slots: Object.freeze(state.slots),
    span: join(start.span, close.span),
  });
};
