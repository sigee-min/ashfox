import type { HookEnclosure, HookParseResult, HookSourceUnit, HookUnitKind } from './contract';
import { lexHooksSource } from './lex';
import { buildEnclosure, readHookBody } from './parseBody';
import {
  fail,
  parseSchemaDecl,
  ParseRecoveryError,
  peek,
  readAstValue,
  readIdent,
  readQualified,
  spanFrom,
  take,
  type ParseState,
} from './parseHelpers';

export interface HookParseOptions {
  readonly allowHostStatements?: boolean;
}

const UNIT_KINDS = new Set<string>([
  'module',
  'structure',
  'model',
  'sprite',
  'sound',
  'compound',
  'vfx',
]);

const parseAnchorDecl = (state: ParseState): void => {
  const start = take(state, 'anchor');
  const id = readIdent(state, 'anchor id').value;
  take(state, ':');
  const schema = readQualified(state, 'schema id').value;
  const body = readHookBody(state);
  state.anchors.push(
    Object.freeze({
      kind: 'anchor',
      id,
      schema,
      ...(body.parent ? { parent: body.parent } : {}),
      ...(body.atVec ? { at: body.atVec } : {}),
      space: body.space,
      ...(body.facing ? { facing: body.facing } : {}),
      ...(body.normal ? { normal: body.normal } : {}),
      ...(body.rotate ? { rotate: body.rotate } : {}),
      ...(body.mcBlock ? { mcBlock: body.mcBlock } : {}),
      props: Object.freeze(body.props),
      span: spanFrom(start, body.end),
    }),
  );
};

const parseVolumeDecl = (state: ParseState): void => {
  const start = take(state, 'volume');
  const id = readIdent(state, 'volume id').value;
  take(state, ':');
  const schema = readQualified(state, 'schema id').value;
  const body = readHookBody(state);
  const enclosure = buildEnclosure(body);
  state.volumes.push(
    Object.freeze({
      kind: 'volume',
      id,
      schema,
      ...(body.parent ? { parent: body.parent } : {}),
      ...(body.fromVec ? { from: body.fromVec } : {}),
      ...(body.toVec ? { to: body.toVec } : {}),
      space: body.space,
      ...(body.rotate ? { rotate: body.rotate } : {}),
      ...(enclosure ? { enclosure } : {}),
      ...(body.mcBlock ? { mcBlock: body.mcBlock } : {}),
      props: Object.freeze(body.props),
      span: spanFrom(start, body.end),
    }),
  );
};

const parseCueDecl = (state: ParseState): void => {
  const start = take(state, 'cue');
  const id = readIdent(state, 'cue id').value;
  take(state, ':');
  const schema = readQualified(state, 'schema id').value;
  const body = readHookBody(state);
  state.cues.push(
    Object.freeze({
      kind: 'cue',
      id,
      schema,
      ...(body.clip ? { clip: body.clip } : {}),
      ...(body.atNum !== undefined ? { at: body.atNum } : {}),
      ...(body.fromNum !== undefined ? { from: body.fromNum } : {}),
      ...(body.toNum !== undefined ? { to: body.toNum } : {}),
      ...(body.frame !== undefined ? { frame: body.frame } : {}),
      props: Object.freeze(body.props),
      span: spanFrom(start, body.end),
    }),
  );
};

const parseMetaDecl = (state: ParseState): void => {
  const start = take(state, 'meta');
  const id = readIdent(state, 'meta id').value;
  take(state, ':');
  const schema = readQualified(state, 'schema id').value;
  const body = readHookBody(state, 'meta');
  state.meta.push(
    Object.freeze({
      kind: 'meta',
      id,
      schema,
      ...(body.target ? { target: body.target } : {}),
      props: Object.freeze(body.props),
      span: spanFrom(start, body.end),
    }),
  );
};

const parseZoneDecl = (state: ParseState): void => {
  const start = take(state, 'zone');
  const id = readIdent(state, 'zone id').value;
  let schema: string | undefined;
  if (peek(state).value === ':') {
    take(state, ':');
    schema = readQualified(state, 'schema id').value;
  }
  const body = readHookBody(state);
  const enclosure: HookEnclosure =
    buildEnclosure(body) ?? Object.freeze({ kind: 'enclosed', enclosed: true });
  state.zones.push(
    Object.freeze({
      kind: 'zone',
      id,
      ...(schema ? { schema } : {}),
      ...(body.parent ? { parent: body.parent } : {}),
      ...(body.fromVec ? { from: body.fromVec } : {}),
      ...(body.toVec ? { to: body.toVec } : {}),
      enclosure,
      ...(body.shape ? { shape: body.shape } : {}),
      props: Object.freeze(body.props),
      span: spanFrom(start, body.end),
    }),
  );
};

const parseMcBlockDecl = (state: ParseState): void => {
  const start = take(state, 'mc_block');
  const targetId = readIdent(state, 'mc_block target id').value;
  if (peek(state).value === '=') {
    take(state, '=');
    const val = readAstValue(state);
    if (val.kind !== 'string') {
      return fail(state, 'hooks.syntax', 'Expected block state string.');
    }
    const end = take(state, ';');
    state.mcBlocks.push(
      Object.freeze({
        kind: 'mc_block',
        targetId,
        blockState: val.value,
        span: spanFrom(start, end),
      }),
    );
    return;
  }
  const body = readHookBody(state);
  const stateProp = body.props.find((p) => p.name === 'state' || p.name === 'block');
  if (!stateProp || stateProp.value.kind !== 'string') {
    return fail(state, 'hooks.syntax', 'mc_block block requires string property `state`.', start);
  }
  state.mcBlocks.push(
    Object.freeze({
      kind: 'mc_block',
      targetId,
      blockState: stateProp.value.value,
      ...(body.facing ? { facing: body.facing } : {}),
      span: spanFrom(start, body.end),
    }),
  );
};

const skipOptionalImportParams = (state: ParseState, fallbackEnd: ReturnType<typeof peek>) => {
  if (peek(state).value !== '{') return take(state, ';');
  take(state, '{');
  let depth = 1;
  let end = fallbackEnd;
  while (peek(state).kind !== 'eof' && depth > 0) {
    const t = take(state);
    if (t.value === '{') depth += 1;
    else if (t.value === '}') {
      depth -= 1;
      if (depth === 0) end = t;
    }
  }
  return peek(state).value === ';' ? take(state, ';') : end;
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
  const end = skipOptionalImportParams(state, peek(state, -1));
  state.imports.push(Object.freeze({ path, alias, span: spanFrom(start, end) }));
};

const skipHostBlockBody = (state: ParseState): void => {
  take(state, '{');
  while (peek(state).kind !== 'eof' && peek(state).value !== '}') {
    parseStatement(state);
  }
  if (peek(state).value === '}') take(state, '}');
};

const skipHostStatement = (state: ParseState): void => {
  const first = peek(state);
  const isContainer = first.value === 'floor' || first.value === 'room';
  if (isContainer) {
    const kind = take(state).value as 'floor' | 'room';
    const idTok = peek(state);
    if (idTok.kind === 'identifier' && peek(state, 1).value === '{') {
      take(state);
      state.parentStack.push(Object.freeze({ kind, id: idTok.value }));
      skipHostBlockBody(state);
      state.parentStack.pop();
      return;
    }
  }
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
  if (peek(state).value === 'ashfox') {
    if (peek(state, 1).value === '-') {
      return fail(
        state,
        'hooks.legacy-header-forbidden',
        'Legacy hyphenated header is forbidden; use "ashfox 1".',
      );
    }
    take(state);
    const ver = peek(state);
    if (ver.kind !== 'number' || ver.value !== '1') {
      return fail(state, 'hooks.syntax', 'Expected version 1 after "ashfox".', ver);
    }
    state.header = `ashfox ${take(state).value}`;
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

/** Parse hooks declarations, schema exports, zones, and `mc_block` overrides from `ashfox 1` source. */
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
    parentStack: [],
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
