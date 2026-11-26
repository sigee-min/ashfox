import type { Vec2, Vec3 } from '../model/identity';
import type {
  HookAnchorDecl,
  HookAstValue,
  HookCueDecl,
  HookDiagnostic,
  HookEnclosure,
  HookEnclosureKind,
  HookFacing,
  HookFieldType,
  HookImportDecl,
  HookMcBlockDecl,
  HookMetaDecl,
  HookNumberUnit,
  HookParentRef,
  HookPropAssignment,
  HookSchemaDecl,
  HookSchemaField,
  HookSourceSpan,
  HookTargetKind,
  HookUnitKind,
  HookVolumeDecl,
  HookZoneDecl,
  HookZoneShape,
} from './contract';
import type { HookToken } from './lex';

export interface ParseState {
  readonly file: string;
  readonly tokens: readonly HookToken[];
  readonly diagnostics: HookDiagnostic[];
  readonly allowHostStatements: boolean;
  offset: number;
  header: string | null;
  unitKind: HookUnitKind;
  unitId: string;
  readonly imports: HookImportDecl[];
  readonly schemas: HookSchemaDecl[];
  readonly anchors: HookAnchorDecl[];
  readonly volumes: HookVolumeDecl[];
  readonly cues: HookCueDecl[];
  readonly meta: HookMetaDecl[];
  readonly zones: HookZoneDecl[];
  readonly mcBlocks: HookMcBlockDecl[];
}

export interface HeaderAttrs {
  parent?: HookParentRef;
  atVec?: Vec3;
  fromVec?: Vec3;
  toVec?: Vec3;
  normal?: Vec3;
  rotate?: Vec3;
  facing?: HookFacing;
  space: '2d' | '3d';
  mcBlock?: string;
  enclosureKind?: HookEnclosureKind;
  acousticProfile?: string;
  shelterRatio?: number;
  shape?: HookZoneShape;
  clip?: string;
  atNum?: number;
  fromNum?: number;
  toNum?: number;
  frame?: number;
  target?: string;
}

export class ParseRecoveryError extends Error {}

const TARGET_KINDS = new Set<string>(['anchor', 'volume', 'cue', 'meta']);
const FACING_KINDS = new Set<string>(['north', 'south', 'east', 'west', 'up', 'down']);
const ENCLOSURE_KINDS = new Set<string>(['enclosed', 'semi_open', 'open', 'outdoor']);
const ZONE_SHAPES = new Set<string>(['rect', 'octagon', 'box']);

export const peek = (state: ParseState, delta = 0): HookToken =>
  state.tokens[state.offset + delta] ?? state.tokens[state.tokens.length - 1]!;

export const spanFrom = (start: HookToken, end: HookToken): HookSourceSpan =>
  Object.freeze({ file: start.span.file, start: start.span.start, end: end.span.end });

export const fail = (
  state: ParseState,
  code: string,
  message: string,
  token = peek(state),
): never => {
  state.diagnostics.push(
    Object.freeze({
      severity: 'error',
      code,
      message,
      file: state.file,
      line: token.span.start.line,
      column: token.span.start.column,
      token: token.value || 'EOF',
      span: token.span,
    }),
  );
  throw new ParseRecoveryError(message);
};

export const take = (state: ParseState, expected?: string): HookToken => {
  const token = peek(state);
  if (expected !== undefined && token.value !== expected) {
    return fail(
      state,
      'hooks.syntax',
      `Expected "${expected}", got "${token.value || 'EOF'}".`,
      token,
    );
  }
  if (token.kind === 'eof') {
    return fail(
      state,
      'hooks.syntax',
      `Unexpected end of file while expecting ${expected ?? 'token'}.`,
      token,
    );
  }
  state.offset += 1;
  return token;
};

export const readIdent = (state: ParseState, label: string): HookToken => {
  const token = peek(state);
  if (token.kind !== 'identifier') return fail(state, 'hooks.syntax', `Expected ${label}.`, token);
  return take(state);
};

export const readQualified = (
  state: ParseState,
  label: string,
): { readonly value: string; readonly token: HookToken } => {
  const first = readIdent(state, label);
  let value = first.value;
  let last = first;
  while (peek(state).value === '.') {
    take(state, '.');
    last = readIdent(state, `${label} segment`);
    value += `.${last.value}`;
  }
  return { value, token: { ...first, value, span: spanFrom(first, last) } };
};

const splitNumberUnit = (
  state: ParseState,
  raw: string,
  negative: boolean,
  token: HookToken,
): { readonly value: number; readonly unit: HookNumberUnit } => {
  const match = /^(\d+(?:\.\d+)?)([A-Za-z]*)$/.exec(raw);
  if (!match) return fail(state, 'hooks.syntax', `Invalid number "${raw}".`, token);
  const num = (negative ? -1 : 1) * Number(match[1]);
  const suffix = match[2] ?? '';
  const unitMap: Record<string, HookNumberUnit> = {
    '': 'plain',
    s: 'second',
    deg: 'degree',
    px: 'texel',
    u: 'unit',
  };
  const unit = unitMap[suffix];
  if (!unit) {
    return fail(state, 'hooks.syntax', `Unsupported unit "${suffix}" on number "${raw}".`, token);
  }
  return { value: num === 0 ? 0 : num, unit };
};

const readNumberValue = (
  state: ParseState,
): { readonly value: number; readonly unit: HookNumberUnit; readonly token: HookToken } => {
  let negative = false;
  const start = peek(state);
  if (start.value === '-' || start.value === '+') negative = take(state).value === '-';
  const numTok = peek(state);
  if (numTok.kind !== 'number') {
    return fail(state, 'hooks.syntax', 'Expected number literal.', numTok);
  }
  take(state);
  const parsed = splitNumberUnit(state, numTok.value, negative, numTok);
  return {
    value: parsed.value,
    unit: parsed.unit,
    token: { ...numTok, span: spanFrom(start, numTok) },
  };
};

const readParenVec = (state: ParseState): HookAstValue => {
  const start = take(state, '(');
  const first = readNumberValue(state).value;
  take(state, ',');
  const second = readNumberValue(state).value;
  if (peek(state).value === ',') {
    take(state, ',');
    const third = readNumberValue(state).value;
    const end = take(state, ')');
    const value: Vec3 = Object.freeze([first, second, third]);
    return Object.freeze({ kind: 'vec3', value, span: spanFrom(start, end) });
  }
  const end = take(state, ')');
  const value: Vec2 = Object.freeze([first, second]);
  return Object.freeze({ kind: 'vec2', value, span: spanFrom(start, end) });
};

export const readAstValue = (state: ParseState): HookAstValue => {
  const token = peek(state);
  if (token.kind === 'string') {
    take(state);
    return Object.freeze({ kind: 'string', value: token.value, span: token.span });
  }
  if (token.value === '(') return readParenVec(state);
  if (token.kind === 'number' || token.value === '-' || token.value === '+') {
    const num = readNumberValue(state);
    return Object.freeze({
      kind: 'number',
      value: num.value,
      unit: num.unit,
      span: num.token.span,
    });
  }
  if (token.kind === 'identifier') {
    if (token.value === 'true' || token.value === 'false') {
      take(state);
      return Object.freeze({ kind: 'bool', value: token.value === 'true', span: token.span });
    }
    const q = readQualified(state, 'identifier');
    return Object.freeze({ kind: 'ref', value: q.value, span: q.token.span });
  }
  return fail(state, 'hooks.syntax', `Unexpected value token "${token.value || 'EOF'}".`, token);
};

const readFieldType = (state: ParseState): HookFieldType => {
  const token = peek(state);
  if (token.kind === 'string') {
    const values = [take(state).value];
    while (peek(state).value === '|') {
      take(state, '|');
      const next = peek(state);
      if (next.kind !== 'string') {
        return fail(state, 'hooks.syntax', 'Expected string literal in union type.', next);
      }
      values.push(take(state).value);
    }
    return Object.freeze({ kind: 'union', values: Object.freeze(values) });
  }
  const kw = readIdent(state, 'field type');
  if (
    kw.value === 'string' ||
    kw.value === 'bool' ||
    kw.value === 'vec2' ||
    kw.value === 'vec3' ||
    kw.value === 'asset'
  ) {
    return Object.freeze({ kind: kw.value });
  }
  if (kw.value === 'int' || kw.value === 'float') {
    if (peek(state).value !== '(') return Object.freeze({ kind: kw.value });
    take(state, '(');
    const min = readNumberValue(state).value;
    take(state, '..');
    const max = readNumberValue(state).value;
    take(state, ')');
    return Object.freeze({ kind: kw.value, min, max });
  }
  return fail(state, 'hooks.syntax', `Unknown schema field type "${kw.value}".`, kw);
};

const readSchemaTargets = (state: ParseState): readonly HookTargetKind[] => {
  if (peek(state).value !== 'on') return Object.freeze(['anchor', 'volume', 'cue', 'meta']);
  take(state, 'on');
  const readOne = (): HookTargetKind => {
    const tok = readIdent(state, 'hook target');
    if (!TARGET_KINDS.has(tok.value)) {
      return fail(state, 'hooks.syntax', `Invalid schema target "${tok.value}".`, tok);
    }
    return tok.value as HookTargetKind;
  };
  const targets: HookTargetKind[] = [readOne()];
  while (peek(state).value === '|') {
    take(state, '|');
    targets.push(readOne());
  }
  return Object.freeze(targets);
};

const readSchemaField = (state: ParseState): HookSchemaField => {
  const nameTok = readIdent(state, 'field name');
  let optional = false;
  if (peek(state).value === '?') {
    take(state, '?');
    optional = true;
  }
  take(state, ':');
  const type = readFieldType(state);
  let defaultValue: HookAstValue | undefined;
  if (peek(state).value === '=') {
    take(state, '=');
    defaultValue = readAstValue(state);
  }
  const endTok = take(state, ';');
  return Object.freeze({
    name: nameTok.value,
    type,
    optional,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    span: spanFrom(nameTok, endTok),
  });
};

export const parseSchemaDecl = (state: ParseState, exported: boolean): void => {
  const startTok = take(state, 'schema');
  const raw = readQualified(state, 'schema name').value;
  const targets = readSchemaTargets(state);
  take(state, '{');
  const fields: HookSchemaField[] = [];
  while (peek(state).value !== '}' && peek(state).kind !== 'eof')
    fields.push(readSchemaField(state));
  const endTok = take(state, '}');
  const dot = raw.lastIndexOf('.');
  const namespace = dot >= 0 ? raw.slice(0, dot) : state.unitKind === 'module' ? state.unitId : '';
  const name = dot >= 0 ? raw.slice(dot + 1) : raw;
  const id = dot >= 0 ? raw : namespace ? `${namespace}.${name}` : name;
  state.schemas.push(
    Object.freeze({
      id,
      namespace,
      name,
      exported,
      inline: state.unitKind !== 'module',
      targets,
      fields: Object.freeze(fields),
      span: spanFrom(startTok, endTok),
    }),
  );
};

export const readPropsBlock = (
  state: ParseState,
): { readonly props: readonly HookPropAssignment[]; readonly end: HookToken } => {
  if (peek(state).value === ';') return { props: Object.freeze([]), end: take(state, ';') };
  if (peek(state).value !== '{') return { props: Object.freeze([]), end: peek(state, -1) };
  take(state, '{');
  const props: HookPropAssignment[] = [];
  while (peek(state).value !== '}' && peek(state).kind !== 'eof') {
    const keyTok = readIdent(state, 'property name');
    take(state, '=');
    const value = readAstValue(state);
    const semi = take(state, ';');
    props.push(Object.freeze({ name: keyTok.value, value, span: spanFrom(keyTok, semi) }));
  }
  return { props: Object.freeze(props), end: take(state, '}') };
};

const toVec3 = (
  val: HookAstValue,
  state: ParseState,
): { readonly vec: Vec3; readonly space: '2d' | '3d' } => {
  if (val.kind === 'vec3') return { vec: val.value, space: '3d' };
  if (val.kind === 'vec2')
    return { vec: Object.freeze([val.value[0], val.value[1], 0]), space: '2d' };
  return fail(state, 'hooks.syntax', 'Expected 2D or 3D vector.', peek(state, -1));
};

const asText = (val: HookAstValue, state: ParseState, label: string): string => {
  if (val.kind === 'string' || val.kind === 'ref') return val.value;
  return fail(state, 'hooks.syntax', `Expected ${label} identifier or string.`, peek(state, -1));
};

const asNumber = (val: HookAstValue, state: ParseState, label: string): number => {
  if (val.kind === 'number') return val.value;
  return fail(state, 'hooks.syntax', `Expected ${label} number.`, peek(state, -1));
};

const ATTR_SETTERS: Readonly<
  Record<string, (s: ParseState, a: HeaderAttrs, v: HookAstValue) => void>
> = {
  facing: (s, a, v) => {
    if (v.kind !== 'ref' || !FACING_KINDS.has(v.value)) {
      fail(s, 'hooks.syntax', 'Expected facing (north|south|east|west|up|down).', peek(s, -1));
    }
    a.facing = v.value as HookFacing;
  },
  normal: (s, a, v) => {
    a.normal = toVec3(v, s).vec;
  },
  rotate: (s, a, v) => {
    a.rotate = v.kind === 'vec3' ? v.value : Object.freeze([0, asNumber(v, s, 'rotate'), 0]);
  },
  mc_block: (s, a, v) => {
    if (v.kind !== 'string') fail(s, 'hooks.syntax', 'Expected mc_block string literal.');
    else a.mcBlock = v.value;
  },
  enclosure: (s, a, v) => {
    const text = asText(v, s, 'enclosure');
    if (!ENCLOSURE_KINDS.has(text)) fail(s, 'hooks.syntax', 'Invalid enclosure kind.');
    a.enclosureKind = text as HookEnclosureKind;
  },
  acoustic: (s, a, v) => {
    a.acousticProfile = asText(v, s, 'acoustic');
  },
  shelter: (s, a, v) => {
    a.shelterRatio = asNumber(v, s, 'shelter');
  },
  shape: (s, a, v) => {
    if (v.kind !== 'ref' || !ZONE_SHAPES.has(v.value))
      fail(s, 'hooks.syntax', 'Invalid zone shape.');
    else a.shape = v.value as HookZoneShape;
  },
  clip: (s, a, v) => {
    a.clip = asText(v, s, 'clip');
  },
  target: (s, a, v) => {
    a.target = asText(v, s, 'target');
  },
  frame: (s, a, v) => {
    a.frame = asNumber(v, s, 'frame');
  },
  at: (s, a, v) => {
    if (v.kind === 'number') a.atNum = v.value;
    else {
      const vec = toVec3(v, s);
      a.atVec = vec.vec;
      a.space = vec.space;
    }
  },
  from: (s, a, v) => {
    if (v.kind === 'number') a.fromNum = v.value;
    else {
      const vec = toVec3(v, s);
      a.fromVec = vec.vec;
      a.space = vec.space;
    }
  },
  to: (s, a, v) => {
    if (v.kind === 'number') a.toNum = v.value;
    else {
      const vec = toVec3(v, s);
      a.toVec = vec.vec;
      a.space = vec.space;
    }
  },
};

export const readHeaderAttrs = (state: ParseState): HeaderAttrs => {
  const attrs: HeaderAttrs = { space: '3d' };
  while (peek(state).kind === 'identifier') {
    const keyTok = take(state);
    take(state, '=');
    const val = readAstValue(state);
    if (
      keyTok.value === 'bone' ||
      keyTok.value === 'room' ||
      keyTok.value === 'floor' ||
      keyTok.value === 'surface' ||
      keyTok.value === 'compound'
    ) {
      attrs.parent = Object.freeze({ kind: keyTok.value, id: asText(val, state, keyTok.value) });
      continue;
    }
    const setter = ATTR_SETTERS[keyTok.value];
    if (!setter)
      fail(state, 'hooks.syntax', `Unsupported header attribute "${keyTok.value}".`, keyTok);
    setter(state, attrs, val);
  }
  return attrs;
};

export const buildEnclosure = (attrs: HeaderAttrs): HookEnclosure | undefined => {
  if (!attrs.enclosureKind) return undefined;
  return Object.freeze({
    kind: attrs.enclosureKind,
    enclosed: attrs.enclosureKind === 'enclosed',
    ...(attrs.acousticProfile ? { acousticProfile: attrs.acousticProfile } : {}),
    ...(attrs.shelterRatio !== undefined ? { shelterRatio: attrs.shelterRatio } : {}),
  });
};
