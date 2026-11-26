import type { HookEnclosure, HookParseResult, HookSourceUnit, HookUnitKind } from './contract';
import { lexHooksSource } from './lex';
import {
  buildEnclosure,
  fail,
  parseSchemaDecl,
  ParseRecoveryError,
  peek,
  readHeaderAttrs,
  readIdent,
  readPropsBlock,
  readQualified,
  spanFrom,
  take,
  type ParseState,
} from './parseHelpers';

export interface HookParseOptions {
  readonly allowHostStatements?: boolean;
}

const UNIT_KINDS = new Set<string>(['module', 'structure', 'model', 'sprite', 'sound', 'compound']);

const parseAnchorDecl = (state: ParseState): void => {
  const start = take(state, 'anchor');
  const id = readIdent(state, 'anchor id').value;
  take(state, 'as');
  const schema = readQualified(state, 'schema id').value;
  const attrs = readHeaderAttrs(state);
  const body = readPropsBlock(state);
  state.anchors.push(
    Object.freeze({
      kind: 'anchor',
      id,
      schema,
      ...(attrs.parent ? { parent: attrs.parent } : {}),
      ...(attrs.atVec ? { at: attrs.atVec } : {}),
      space: attrs.space,
      ...(attrs.facing ? { facing: attrs.facing } : {}),
      ...(attrs.normal ? { normal: attrs.normal } : {}),
      ...(attrs.rotate ? { rotate: attrs.rotate } : {}),
      ...(attrs.mcBlock ? { mcBlock: attrs.mcBlock } : {}),
      props: body.props,
      span: spanFrom(start, body.end),
    }),
  );
};

const parseVolumeDecl = (state: ParseState): void => {
  const start = take(state, 'volume');
  const id = readIdent(state, 'volume id').value;
  take(state, 'as');
  const schema = readQualified(state, 'schema id').value;
  const attrs = readHeaderAttrs(state);
  const body = readPropsBlock(state);
  const enclosure = buildEnclosure(attrs);
  state.volumes.push(
    Object.freeze({
      kind: 'volume',
      id,
      schema,
      ...(attrs.parent ? { parent: attrs.parent } : {}),
      ...(attrs.fromVec ? { from: attrs.fromVec } : {}),
      ...(attrs.toVec ? { to: attrs.toVec } : {}),
      space: attrs.space,
      ...(attrs.rotate ? { rotate: attrs.rotate } : {}),
      ...(enclosure ? { enclosure } : {}),
      ...(attrs.mcBlock ? { mcBlock: attrs.mcBlock } : {}),
      props: body.props,
      span: spanFrom(start, body.end),
    }),
  );
};

const parseCueDecl = (state: ParseState): void => {
  const start = take(state, 'cue');
  const id = readIdent(state, 'cue id').value;
  take(state, 'as');
  const schema = readQualified(state, 'schema id').value;
  const attrs = readHeaderAttrs(state);
  const body = readPropsBlock(state);
  state.cues.push(
    Object.freeze({
      kind: 'cue',
      id,
      schema,
      ...(attrs.clip ? { clip: attrs.clip } : {}),
      ...(attrs.atNum !== undefined ? { at: attrs.atNum } : {}),
      ...(attrs.fromNum !== undefined ? { from: attrs.fromNum } : {}),
      ...(attrs.toNum !== undefined ? { to: attrs.toNum } : {}),
      ...(attrs.frame !== undefined ? { frame: attrs.frame } : {}),
      props: body.props,
      span: spanFrom(start, body.end),
    }),
  );
};

const parseMetaDecl = (state: ParseState): void => {
  const start = take(state, 'meta');
  const id = readIdent(state, 'meta id').value;
  take(state, 'as');
  const schema = readQualified(state, 'schema id').value;
  const attrs = readHeaderAttrs(state);
  const body = readPropsBlock(state);
  state.meta.push(
    Object.freeze({
      kind: 'meta',
      id,
      schema,
      ...(attrs.target ? { target: attrs.target } : {}),
      props: body.props,
      span: spanFrom(start, body.end),
    }),
  );
};

const parseZoneDecl = (state: ParseState): void => {
  const start = take(state, 'zone');
  const id = readIdent(state, 'zone id').value;
  let schema: string | undefined;
  if (peek(state).value === 'as') {
    take(state, 'as');
    schema = readQualified(state, 'schema id').value;
  }
  const attrs = readHeaderAttrs(state);
  const body = readPropsBlock(state);
  const enclosure: HookEnclosure =
    buildEnclosure(attrs) ?? Object.freeze({ kind: 'enclosed', enclosed: true });
  state.zones.push(
    Object.freeze({
      kind: 'zone',
      id,
      ...(schema ? { schema } : {}),
      ...(attrs.parent ? { parent: attrs.parent } : {}),
      ...(attrs.fromVec ? { from: attrs.fromVec } : {}),
      ...(attrs.toVec ? { to: attrs.toVec } : {}),
      enclosure,
      ...(attrs.shape ? { shape: attrs.shape } : {}),
      props: body.props,
      span: spanFrom(start, body.end),
    }),
  );
};

const parseMcBlockDecl = (state: ParseState): void => {
  const start = take(state, 'mc_block');
  const targetId = readIdent(state, 'mc_block target id').value;
  const attrs = readHeaderAttrs(state);
  if (peek(state).value === '=') {
    take(state, '=');
    const strTok = peek(state);
    if (strTok.kind !== 'string') {
      return fail(state, 'hooks.syntax', 'Expected block state string.', strTok);
    }
    const blockState = take(state).value;
    const end = take(state, ';');
    state.mcBlocks.push(
      Object.freeze({
        kind: 'mc_block',
        targetId,
        blockState,
        ...(attrs.facing ? { facing: attrs.facing } : {}),
        span: spanFrom(start, end),
      }),
    );
    return;
  }
  const body = readPropsBlock(state);
  const stateProp = body.props.find((p) => p.name === 'state' || p.name === 'block');
  if (!stateProp || stateProp.value.kind !== 'string') {
    return fail(state, 'hooks.syntax', 'mc_block block requires string property `state`.', start);
  }
  state.mcBlocks.push(
    Object.freeze({
      kind: 'mc_block',
      targetId,
      blockState: stateProp.value.value,
      ...(attrs.facing ? { facing: attrs.facing } : {}),
      span: spanFrom(start, body.end),
    }),
  );
};

const parseImportDecl = (state: ParseState): void => {
  const start = take(state, 'import');
  const pathTok = peek(state);
  if (pathTok.kind !== 'string') {
    return fail(state, 'hooks.syntax', 'Expected import path string.', pathTok);
  }
  const path = take(state).value;
  take(state, 'as');
  const alias = readIdent(state, 'import alias').value;
  const end = take(state, ';');
  state.imports.push(Object.freeze({ path, alias, span: spanFrom(start, end) }));
};

const skipHostStatement = (state: ParseState): void => {
  let depth = 0;
  while (peek(state).kind !== 'eof') {
    const tok = take(state);
    if (tok.value === '{') depth += 1;
    else if (tok.value === '}') {
      if (depth <= 1) return;
      depth -= 1;
    } else if (tok.value === ';' && depth === 0) return;
  }
};

const recoverToBoundary = (state: ParseState, wrapped: boolean): void => {
  while (peek(state).kind !== 'eof') {
    const tok = peek(state);
    if (tok.value === ';') {
      take(state);
      return;
    }
    if (tok.value === '}' && wrapped) return;
    take(state);
  }
};

const DECL_PARSERS: Readonly<Record<string, (state: ParseState) => void>> = {
  import: parseImportDecl,
  schema: (s) => parseSchemaDecl(s, false),
  anchor: parseAnchorDecl,
  volume: parseVolumeDecl,
  cue: parseCueDecl,
  meta: parseMetaDecl,
  zone: parseZoneDecl,
  mc_block: parseMcBlockDecl,
};

const parseStatement = (state: ParseState): void => {
  const tok = peek(state);
  if (tok.value === 'export') {
    take(state, 'export');
    if (peek(state).value === 'schema') parseSchemaDecl(state, true);
    else if (state.allowHostStatements) skipHostStatement(state);
    else fail(state, 'hooks.syntax', `Expected schema after export, got "${peek(state).value}".`);
    return;
  }
  const handler = DECL_PARSERS[tok.value];
  if (handler) handler(state);
  else if (state.allowHostStatements) skipHostStatement(state);
  else fail(state, 'hooks.syntax', `Unexpected declaration "${tok.value || 'EOF'}".`, tok);
};

const parseHeaderAndUnit = (state: ParseState): boolean => {
  if (peek(state).value === 'ashfox-model') {
    take(state);
    const ver = peek(state);
    if (ver.kind !== 'number') {
      return fail(state, 'hooks.syntax', 'Expected model version after ashfox-model.', ver);
    }
    state.header = `ashfox-model ${take(state).value}`;
  }
  while (peek(state).value === 'import') parseImportDecl(state);
  const next = peek(state);
  if (next.kind === 'identifier' && UNIT_KINDS.has(next.value)) {
    state.unitKind = take(state).value as HookUnitKind;
    state.unitId = readIdent(state, 'unit id').value;
    take(state, '{');
    return true;
  }
  return false;
};

const parseUnitStatements = (state: ParseState, wrapped: boolean): void => {
  while (peek(state).kind !== 'eof' && !(wrapped && peek(state).value === '}')) {
    const before = state.offset;
    try {
      parseStatement(state);
    } catch (err) {
      if (!(err instanceof ParseRecoveryError)) throw err;
      recoverToBoundary(state, wrapped);
    }
    if (state.offset === before && peek(state).kind !== 'eof') take(state);
  }
  if (wrapped && peek(state).value === '}') take(state, '}');
};

const toHookSourceUnit = (state: ParseState): HookSourceUnit =>
  Object.freeze({
    header: state.header,
    unitKind: state.unitKind,
    id: state.unitId,
    file: state.file,
    imports: Object.freeze(state.imports),
    schemas: Object.freeze(state.schemas),
    anchors: Object.freeze(state.anchors),
    volumes: Object.freeze(state.volumes),
    cues: Object.freeze(state.cues),
    meta: Object.freeze(state.meta),
    zones: Object.freeze(state.zones),
    mcBlocks: Object.freeze(state.mcBlocks),
  });

/** Parse hooks declarations, schema exports, zones, and `mc_block` overrides from `.ashfox` source. */
export const parseHooksSource = (
  source: string,
  file = 'hooks.ashfox',
  options?: HookParseOptions,
): HookParseResult => {
  const lexed = lexHooksSource(source, file);
  const state: ParseState = {
    file,
    tokens: lexed.tokens,
    diagnostics: [...lexed.diagnostics],
    allowHostStatements: options?.allowHostStatements ?? false,
    offset: 0,
    header: null,
    unitKind: 'hooks',
    unitId: file.replace(/^.*\//, '').replace(/\.ashfox$/, ''),
    imports: [],
    schemas: [],
    anchors: [],
    volumes: [],
    cues: [],
    meta: [],
    zones: [],
    mcBlocks: [],
  };
  let wrapped = false;
  try {
    wrapped = parseHeaderAndUnit(state);
  } catch (err) {
    if (!(err instanceof ParseRecoveryError)) throw err;
  }
  parseUnitStatements(state, wrapped);
  return Object.freeze({
    ok: state.diagnostics.length === 0,
    unit: toHookSourceUnit(state),
    diagnostics: Object.freeze(state.diagnostics),
  });
};
