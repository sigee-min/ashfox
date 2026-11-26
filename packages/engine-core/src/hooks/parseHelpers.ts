import type { Vec2, Vec3 } from '../model/identity';
import type {
  HookAnchorDecl,
  HookAstValue,
  HookCueDecl,
  HookDiagnostic,
  HookFieldType,
  HookImportDecl,
  HookMcBlockDecl,
  HookMetaDecl,
  HookNumberUnit,
  HookParentRef,
  HookSchemaDecl,
  HookSchemaField,
  HookSourceSpan,
  HookTargetKind,
  HookUnitKind,
  HookVolumeDecl,
  HookZoneDecl,
} from './contract';
import type { HookToken } from './lex';

export interface ParseState {
  readonly file: string;
  readonly tokens: readonly HookToken[];
  readonly diagnostics: HookDiagnostic[];
  readonly allowHostStatements: boolean;
  readonly parentStack: HookParentRef[];
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

export class ParseRecoveryError extends Error {}

const TARGET_KINDS = new Set<string>(['anchor', 'volume', 'cue', 'meta']);

const NUMBER_UNIT_MAP: Readonly<Record<string, HookNumberUnit>> = {
  '': 'plain',
  s: 'second',
  ms: 'ms',
  deg: 'degree',
  px: 'texel',
  u: 'unit',
  b: 'block',
  hz: 'hz',
  khz: 'khz',
  db: 'db',
  lufs: 'lufs',
  st: 'st',
  cents: 'cents',
  '%': 'percent',
};

const FLOAT_TYPE_UNITS: Readonly<Record<string, HookNumberUnit | undefined>> = {
  float: undefined,
  number: undefined,
  second: 'second',
  ms: 'ms',
  unit: 'unit',
  deg: 'degree',
  px: 'texel',
  b: 'block',
  hz: 'hz',
  khz: 'khz',
  db: 'db',
  lufs: 'lufs',
  st: 'st',
  cents: 'cents',
  percent: 'percent',
};

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
  const match = /^(\d+(?:\.\d+)?)([A-Za-z%]*)$/.exec(raw);
  if (!match) return fail(state, 'hooks.syntax', `Invalid number "${raw}".`, token);
  const num = (negative ? -1 : 1) * Number(match[1]);
  const suffix = match[2] ?? '';
  const unit = NUMBER_UNIT_MAP[suffix];
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
  if (token.kind === 'string' || token.kind === 'color') {
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

const readEnumType = (state: ParseState): HookFieldType => {
  take(state, '(');
  const values: string[] = [readIdent(state, 'enum literal').value];
  while (peek(state).value === ',') {
    take(state, ',');
    values.push(readIdent(state, 'enum literal').value);
  }
  take(state, ')');
  return Object.freeze({ kind: 'union', values: Object.freeze(values) });
};

const readFieldType = (
  state: ParseState,
): { readonly type: HookFieldType; readonly unit?: HookNumberUnit } => {
  const kw = readIdent(state, 'field type');
  if (kw.value === 'enum') return { type: readEnumType(state) };
  if (
    kw.value === 'string' ||
    kw.value === 'bool' ||
    kw.value === 'vec2' ||
    kw.value === 'vec3' ||
    kw.value === 'asset'
  ) {
    return { type: Object.freeze({ kind: kw.value }) };
  }
  if (kw.value === 'int' || kw.value in FLOAT_TYPE_UNITS) {
    const kind = kw.value === 'int' ? 'int' : 'float';
    const unit = FLOAT_TYPE_UNITS[kw.value];
    if (peek(state).value !== '(')
      return { type: Object.freeze({ kind }), ...(unit ? { unit } : {}) };
    take(state, '(');
    const min = readNumberValue(state).value;
    take(state, '..');
    const max = readNumberValue(state).value;
    take(state, ')');
    return { type: Object.freeze({ kind, min, max }), ...(unit ? { unit } : {}) };
  }
  return fail(state, 'hooks.syntax', `Unknown schema field type "${kw.value}".`, kw);
};

const readSchemaTargets = (state: ParseState): readonly HookTargetKind[] => {
  if (peek(state).value !== ':') return Object.freeze(['anchor', 'volume', 'cue', 'meta']);
  take(state, ':');
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
  const start = take(state, 'field');
  const nameTok = readIdent(state, 'field name');
  let optional = false;
  if (peek(state).value === '?') {
    take(state, '?');
    optional = true;
  }
  take(state, ':');
  const parsedType = readFieldType(state);
  let defaultValue: HookAstValue | undefined;
  if (peek(state).value === '=') {
    take(state, '=');
    defaultValue = readAstValue(state);
  }
  const endTok = take(state, ';');
  return Object.freeze({
    name: nameTok.value,
    type: parsedType.type,
    optional,
    ...(parsedType.unit ? { unit: parsedType.unit } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    span: spanFrom(start, endTok),
  });
};

const readSchemaMcBlock = (state: ParseState): string | undefined => {
  take(state, 'mc_block');
  take(state, '=');
  const val = readAstValue(state);
  let out: string | undefined;
  if (val.kind !== 'string') fail(state, 'hooks.syntax', 'Expected mc_block string literal.');
  else out = val.value;
  take(state, ';');
  return out;
};

const resolveSchemaNames = (raw: string, unitKind: HookUnitKind, unitId: string) => {
  const dot = raw.lastIndexOf('.');
  if (dot >= 0) return { id: raw, namespace: raw.slice(0, dot), name: raw.slice(dot + 1) };
  const namespace = unitKind === 'module' ? unitId : '';
  return { id: namespace ? `${namespace}.${raw}` : raw, namespace, name: raw };
};

export const parseSchemaDecl = (state: ParseState, exported: boolean): void => {
  const startTok = take(state, 'schema');
  const raw = readQualified(state, 'schema name').value;
  const targets = readSchemaTargets(state);
  take(state, '{');
  const fields: HookSchemaField[] = [];
  let mcBlock: string | undefined;
  while (peek(state).value !== '}' && peek(state).kind !== 'eof') {
    if (peek(state).value === 'mc_block') mcBlock = readSchemaMcBlock(state);
    else fields.push(readSchemaField(state));
  }
  const endTok = take(state, '}');
  const names = resolveSchemaNames(raw, state.unitKind, state.unitId);
  state.schemas.push(
    Object.freeze({
      id: names.id,
      namespace: names.namespace,
      name: names.name,
      exported,
      inline: state.unitKind !== 'module',
      targets,
      fields: Object.freeze(fields),
      ...(mcBlock !== undefined ? { mcBlock } : {}),
      span: spanFrom(startTok, endTok),
    }),
  );
};
