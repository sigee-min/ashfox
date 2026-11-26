import { deepFreeze } from '../../immutable';
import { lexProgramSource } from '../program/syntax/lex';
import { assertWellFormedSourceText } from '../workspace/path';
import {
  parseOutputsTokens,
  parsePreviewTokens,
  type RawDeclaredOutput,
  type RawDeclaredPreview,
} from '../directory/declarations';
import {
  DEFAULT_DATA_VERSION,
  DEFAULT_STRUCTURE_DENSITY,
  MAX_STRUCTURE_DIM,
  MAX_STRUCTURE_VOLUME,
  type Cursor,
  type IntVec3,
  type StructureDensity,
  type StructureImport,
  type StructureOp,
  type StructurePaletteEntry,
  type StructureParamValue,
  type StructurePrefab,
  type StructureSourceUnit,
} from './contract';
import { evaluateScalarExpr, parseScalarExpr } from './expr';
import {
  failSyntax,
  peek,
  readInt,
  readName,
  readNumberLiteral,
  readString,
  take,
} from './grammar';
import { parseOpBlock } from './ops';
import { formatBlockState, isValidMinecraftState, parseBlockState } from './state';

interface StructureDraft {
  readonly kind: 'structure' | 'module' | 'compound';
  readonly imports: StructureImport[];
  readonly aliases: Set<string>;
  readonly outputs: RawDeclaredOutput[];
  readonly previews: RawDeclaredPreview[];
  readonly params: Record<string, StructureParamValue>;
  readonly palette: Record<string, StructurePaletteEntry>;
  readonly prefabs: StructurePrefab[];
  readonly prefabNames: Set<string>;
  density: StructureDensity | null;
  seed: number | null;
  size: IntVec3 | null;
  dataVersion: number;
  ops: readonly StructureOp[] | null;
}

const readImport = (cursor: Cursor, draft: StructureDraft): void => {
  const path = readString(cursor);
  take(cursor, 'as');
  const alias = readName(cursor);
  take(cursor, ';');
  if (draft.aliases.has(alias)) failSyntax(cursor, 'unique import alias');
  draft.aliases.add(alias);
  draft.imports.push({ path, alias });
};

const readMixEntry = (cursor: Cursor): { readonly state: string; readonly weight: number } => {
  const raw = readString(cursor);
  if (!isValidMinecraftState(raw)) failSyntax(cursor, 'valid minecraft block state in mix');
  let weight = 1;
  if (peek(cursor).value === '*') {
    take(cursor, '*');
    weight = readNumberLiteral(cursor);
    if (!Number.isFinite(weight) || weight <= 0) failSyntax(cursor, 'positive mix weight');
  }
  return { state: formatBlockState(parseBlockState(raw)), weight };
};

const readMixPalette = (cursor: Cursor): StructurePaletteEntry => {
  take(cursor, 'mix');
  take(cursor, '(');
  const entries: { readonly state: string; readonly weight: number }[] = [readMixEntry(cursor)];
  while (peek(cursor).value === ',') {
    take(cursor, ',');
    entries.push(readMixEntry(cursor));
  }
  take(cursor, ')');
  return { kind: 'mix', entries };
};

const readPaletteEntry = (cursor: Cursor): StructurePaletteEntry => {
  if (peek(cursor).value === 'asset') {
    take(cursor, 'asset');
    const alias = readName(cursor);
    let fallback = 'minecraft:oak_planks';
    if (peek(cursor).value === 'as') {
      take(cursor, 'as');
      fallback = readString(cursor);
      if (!isValidMinecraftState(fallback)) failSyntax(cursor, 'valid minecraft fallback state');
    }
    return { kind: 'asset', alias, fallback: formatBlockState(parseBlockState(fallback)) };
  }
  if (peek(cursor).value === 'mix') return readMixPalette(cursor);
  const state = readString(cursor);
  if (!isValidMinecraftState(state)) failSyntax(cursor, 'valid minecraft block state');
  return { kind: 'block', state: formatBlockState(parseBlockState(state)) };
};

const readPalette = (cursor: Cursor, draft: StructureDraft): void => {
  take(cursor, '{');
  while (peek(cursor).value !== '}') {
    const key = readName(cursor);
    if (key in draft.palette) failSyntax(cursor, `unique palette key ${key}`);
    take(cursor, '=');
    draft.palette[key] = readPaletteEntry(cursor);
    take(cursor, ';');
  }
  take(cursor, '}');
};

const readParamValue = (cursor: Cursor, draft: StructureDraft): StructureParamValue => {
  const next = peek(cursor);
  if (next.kind === 'string') return take(cursor).value;
  if (next.kind === 'identifier' && (next.value === 'true' || next.value === 'false')) {
    return take(cursor).value === 'true';
  }
  const expr = parseScalarExpr(cursor);
  return evaluateScalarExpr(expr, draft.params, cursor.file, 'params');
};

const readParams = (cursor: Cursor, draft: StructureDraft): void => {
  take(cursor, '{');
  while (peek(cursor).value !== '}') {
    const key = readName(cursor);
    if (key in draft.params) failSyntax(cursor, `unique param ${key}`);
    take(cursor, '=');
    draft.params[key] = readParamValue(cursor, draft);
    take(cursor, ';');
  }
  take(cursor, '}');
};

const readSizeVec3 = (cursor: Cursor): IntVec3 => {
  take(cursor, '(');
  const w = readInt(cursor);
  take(cursor, ',');
  const h = readInt(cursor);
  take(cursor, ',');
  const d = readInt(cursor);
  take(cursor, ')');
  if (
    w < 1 ||
    h < 1 ||
    d < 1 ||
    w > MAX_STRUCTURE_DIM ||
    h > MAX_STRUCTURE_DIM ||
    d > MAX_STRUCTURE_DIM ||
    w * h * d > MAX_STRUCTURE_VOLUME
  ) {
    failSyntax(cursor, `size within 1..${MAX_STRUCTURE_DIM} and volume <= ${MAX_STRUCTURE_VOLUME}`);
  }
  return [w, h, d];
};

const readPrefab = (cursor: Cursor, exported: boolean, draft: StructureDraft): void => {
  const id = readName(cursor);
  if (draft.prefabNames.has(id)) failSyntax(cursor, `unique prefab ${id}`);
  draft.prefabNames.add(id);
  draft.prefabs.push({ id, exported, ops: parseOpBlock(cursor, 0) });
};

const readScalarField = (cursor: Cursor, keyword: string, draft: StructureDraft): boolean => {
  if (keyword === 'size') {
    if (draft.size !== null) failSyntax(cursor, 'single size declaration');
    take(cursor, '=');
    draft.size = readSizeVec3(cursor);
    take(cursor, ';');
    return true;
  }
  if (keyword === 'density') {
    if (draft.density !== null) failSyntax(cursor, 'single density declaration');
    take(cursor, '=');
    const val = readInt(cursor);
    if (val !== 1 && val !== 2) failSyntax(cursor, 'density = 1 or 2');
    draft.density = val as StructureDensity;
    take(cursor, ';');
    return true;
  }
  if (keyword === 'seed') {
    if (draft.seed !== null) failSyntax(cursor, 'single seed declaration');
    take(cursor, '=');
    draft.seed = readInt(cursor);
    take(cursor, ';');
    return true;
  }
  if (keyword === 'data_version') {
    take(cursor, '=');
    draft.dataVersion = readInt(cursor);
    take(cursor, ';');
    return true;
  }
  return false;
};

const readStructureField = (cursor: Cursor, keyword: string, draft: StructureDraft): void => {
  if (readScalarField(cursor, keyword, draft)) return;
  if (keyword === 'outputs') {
    const res = parseOutputsTokens(cursor.tokens, cursor.offset, cursor.file);
    cursor.offset = res.nextIndex;
    draft.outputs.push(...res.outputs);
  } else if (keyword === 'preview') {
    const res = parsePreviewTokens(cursor.tokens, cursor.offset, cursor.file);
    cursor.offset = res.nextIndex;
    draft.previews.push(res.preview);
  } else if (keyword === 'build') {
    if (draft.ops !== null) failSyntax(cursor, 'single build block');
    draft.ops = parseOpBlock(cursor, 0);
  } else {
    failSyntax(cursor, 'size, density, seed, data_version, params, palette, prefab, or build');
  }
};

const readMember = (cursor: Cursor, draft: StructureDraft): void => {
  const exported = peek(cursor).value === 'export';
  if (exported) take(cursor, 'export');
  const keyword = readName(cursor);
  if (keyword === 'import' && !exported) return readImport(cursor, draft);
  if (keyword === 'params' && !exported) return readParams(cursor, draft);
  if (keyword === 'palette' && !exported) return readPalette(cursor, draft);
  if (keyword === 'prefab') {
    if (draft.kind === 'module' && !exported) failSyntax(cursor, 'export prefab inside module');
    return readPrefab(cursor, exported, draft);
  }
  if (exported || draft.kind === 'module') failSyntax(cursor, 'export prefab declaration');
  readStructureField(cursor, keyword, draft);
};

export const parseStructureSource = (source: string, file: string): StructureSourceUnit => {
  assertWellFormedSourceText(source);
  const lexical = lexProgramSource(source);
  const cursor: Cursor = { tokens: lexical.tokens, file, offset: 0 };
  if (lexical.diagnostics.length > 0 || lexical.tokens.length > 32_000) {
    failSyntax(cursor, 'valid .ashfox tokens within budget');
  }
  take(cursor, 'ashfox-model');
  take(cursor, '1');
  const rawKind = take(cursor).value;
  if (rawKind !== 'structure' && rawKind !== 'module' && rawKind !== 'compound') {
    failSyntax(cursor, 'structure, module, or compound');
  }
  const kind = rawKind as StructureSourceUnit['kind'];
  const id = readName(cursor);
  take(cursor, '{');
  const draft: StructureDraft = {
    kind,
    imports: [],
    aliases: new Set(),
    outputs: [],
    previews: [],
    params: {},
    palette: {},
    prefabs: [],
    prefabNames: new Set(),
    density: null,
    seed: null,
    size: null,
    dataVersion: DEFAULT_DATA_VERSION,
    ops: null,
  };
  while (peek(cursor).value !== '}') readMember(cursor, draft);
  take(cursor, '}');
  if (peek(cursor).kind !== 'eof') failSyntax(cursor, 'end of file');
  if (kind !== 'module' && (draft.size === null || draft.ops === null)) {
    failSyntax(cursor, 'size and build blocks');
  }
  return deepFreeze({
    kind,
    id,
    imports: draft.imports,
    outputs: draft.outputs,
    previews: draft.previews,
    params: draft.params,
    density: draft.density ?? DEFAULT_STRUCTURE_DENSITY,
    seed: draft.seed ?? 1,
    size: draft.size,
    dataVersion: draft.dataVersion,
    palette: draft.palette,
    prefabs: draft.prefabs,
    ops: draft.ops ?? [],
  });
};
