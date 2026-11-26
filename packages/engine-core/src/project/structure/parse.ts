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
  MAX_STRUCTURE_DIM,
  MAX_STRUCTURE_VOLUME,
  type Cursor,
  type IntVec3,
  type StructureImport,
  type StructureOp,
  type StructurePaletteEntry,
  type StructurePrefab,
  type StructureSourceUnit,
} from './contract';
import { failSyntax, parseOpBlock, peek, readInt, readName, readVec3, take } from './ops';
import { isValidMinecraftState, parseBlockState, formatBlockState } from './state';

interface StructureDraft {
  readonly kind: 'structure' | 'module';
  readonly imports: StructureImport[];
  readonly aliases: Set<string>;
  readonly outputs: RawDeclaredOutput[];
  readonly previews: RawDeclaredPreview[];
  readonly palette: Record<string, StructurePaletteEntry>;
  readonly prefabs: StructurePrefab[];
  readonly prefabNames: Set<string>;
  size: IntVec3 | null;
  dataVersion: number;
  ops: readonly StructureOp[] | null;
}

const readStringLiteral = (cursor: Cursor): string => {
  if (peek(cursor).kind !== 'string') failSyntax(cursor, 'string literal');
  return take(cursor).value;
};

const readImport = (cursor: Cursor, draft: StructureDraft): void => {
  const path = readStringLiteral(cursor);
  take(cursor, 'as');
  const alias = readName(cursor);
  take(cursor, ';');
  if (draft.aliases.has(alias)) failSyntax(cursor, 'unique import alias');
  draft.aliases.add(alias);
  draft.imports.push({ path, alias });
};

const readPaletteEntry = (cursor: Cursor): StructurePaletteEntry => {
  if (peek(cursor).value === 'asset') {
    take(cursor, 'asset');
    const alias = readName(cursor);
    let fallback = 'minecraft:oak_planks';
    if (peek(cursor).value === 'as') {
      take(cursor, 'as');
      fallback = readStringLiteral(cursor);
      if (!isValidMinecraftState(fallback)) failSyntax(cursor, 'valid minecraft fallback state');
    }
    return { kind: 'asset', alias, fallback: formatBlockState(parseBlockState(fallback)) };
  }
  const state = readStringLiteral(cursor);
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

const readPrefab = (cursor: Cursor, exported: boolean, draft: StructureDraft): void => {
  const id = readName(cursor);
  if (draft.prefabNames.has(id)) failSyntax(cursor, `unique prefab ${id}`);
  draft.prefabNames.add(id);
  draft.prefabs.push({ id, exported, ops: parseOpBlock(cursor, 0) });
};

const validateDimensions = (cursor: Cursor, size: IntVec3): IntVec3 => {
  const [w, h, d] = size;
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
  return size;
};

const readStructureField = (cursor: Cursor, keyword: string, draft: StructureDraft): void => {
  if (keyword === 'size') {
    take(cursor, '=');
    draft.size = validateDimensions(cursor, readVec3(cursor));
    take(cursor, ';');
  } else if (keyword === 'data_version') {
    take(cursor, '=');
    draft.dataVersion = readInt(cursor);
    take(cursor, ';');
  } else if (keyword === 'outputs') {
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
    failSyntax(cursor, 'size, data_version, palette, prefab, or build');
  }
};

const readMember = (cursor: Cursor, draft: StructureDraft): void => {
  const exported = peek(cursor).value === 'export';
  if (exported) take(cursor, 'export');
  const keyword = readName(cursor);
  if (keyword === 'import' && !exported) {
    readImport(cursor, draft);
    return;
  }
  if (keyword === 'prefab') {
    if (draft.kind === 'module' && !exported) failSyntax(cursor, 'export prefab inside module');
    readPrefab(cursor, exported, draft);
    return;
  }
  if (keyword === 'palette' && !exported) {
    readPalette(cursor, draft);
    return;
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
  if (rawKind !== 'structure' && rawKind !== 'module') failSyntax(cursor, 'structure or module');
  const kind: 'structure' | 'module' = rawKind === 'structure' ? 'structure' : 'module';
  const id = readName(cursor);
  take(cursor, '{');
  const draft: StructureDraft = {
    kind,
    imports: [],
    aliases: new Set(),
    outputs: [],
    previews: [],
    palette: {},
    prefabs: [],
    prefabNames: new Set(),
    size: null,
    dataVersion: DEFAULT_DATA_VERSION,
    ops: null,
  };
  while (peek(cursor).value !== '}') readMember(cursor, draft);
  take(cursor, '}');
  if (peek(cursor).kind !== 'eof') failSyntax(cursor, 'end of file');
  if (kind === 'structure' && (draft.size === null || draft.ops === null)) {
    failSyntax(cursor, 'size and build blocks');
  }
  return deepFreeze({
    kind,
    id,
    imports: draft.imports,
    outputs: draft.outputs,
    previews: draft.previews,
    params: {},
    density: 2,
    seed: 1,
    size: draft.size,
    dataVersion: draft.dataVersion,
    palette: draft.palette,
    prefabs: draft.prefabs,
    ops: draft.ops ?? [],
  });
};
