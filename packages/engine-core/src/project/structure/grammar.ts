import type { ProgramToken } from '../program/syntax/lex';
import {
  StructureInputError,
  type BlockRotation,
  type CardinalFacing,
  type Cursor,
  type ExprVec2,
  type ExprVec3,
  type IntVec2,
  type MirrorAxis,
  type RoofChimneySpec,
  type RoofDormerSpec,
  type RoofPitch,
  type RoofStyle,
  type StructureOp,
  type StructureScalarExpr,
  type WeatheringRule,
} from './contract';
import { parseScalarExpr } from './expr';

export const peek = (cursor: Cursor, offset = 0): ProgramToken =>
  cursor.tokens[cursor.offset + offset] ?? cursor.tokens[cursor.tokens.length - 1]!;

export const failSyntax = (cursor: Cursor, expected: string): never => {
  const token = peek(cursor);
  throw new StructureInputError({
    code: 'structure.syntax',
    file: cursor.file,
    pointer: `line:${token.span.start.line}:${token.span.start.column}`,
    expected,
    actual: token.value || 'EOF',
  });
};

export const take = (cursor: Cursor, expected?: string): ProgramToken => {
  const token = peek(cursor);
  if (expected !== undefined && token.value !== expected) failSyntax(cursor, expected);
  if (token.kind === 'eof') failSyntax(cursor, expected ?? 'token');
  cursor.offset += 1;
  return token;
};

export const readName = (cursor: Cursor): string => {
  const token = peek(cursor);
  if (token.kind !== 'identifier' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(token.value)) {
    failSyntax(cursor, 'identifier');
  }
  return take(cursor).value;
};

export const readQualified = (cursor: Cursor): string => {
  let out = readName(cursor);
  while (peek(cursor).value === '.') {
    take(cursor, '.');
    out += `.${readName(cursor)}`;
  }
  return out;
};

export const readNumberLiteral = (cursor: Cursor): number => {
  let sign = 1;
  if (peek(cursor).value === '-') {
    take(cursor, '-');
    sign = -1;
  }
  const token = peek(cursor);
  if (token.kind !== 'number' || !/^\d+(?:\.\d+)?$/u.test(token.value))
    failSyntax(cursor, 'number');
  take(cursor);
  const value = sign * Number(token.value);
  if (!Number.isFinite(value)) failSyntax(cursor, 'finite number');
  return value;
};

export const readInt = (cursor: Cursor): number => {
  const value = readNumberLiteral(cursor);
  if (!Number.isSafeInteger(value)) failSyntax(cursor, 'integer');
  return value;
};

export const readString = (cursor: Cursor): string => {
  if (peek(cursor).kind !== 'string') failSyntax(cursor, 'string literal');
  return take(cursor).value;
};

export const readCharKey = (cursor: Cursor): string => {
  const token = peek(cursor);
  if ((token.kind === 'identifier' || token.kind === 'number') && token.value.length === 1) {
    return take(cursor).value;
  }
  return failSyntax(cursor, 'single character key');
};

const EXPR_OP = new Set(['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=']);

const readParenOrExpr = (cursor: Cursor): unknown => {
  const saved = cursor.offset;
  take(cursor, '(');
  const first = parseScalarExpr(cursor);
  if (peek(cursor).value !== ',') {
    cursor.offset = saved;
    return parseScalarExpr(cursor);
  }
  const list: StructureScalarExpr[] = [first];
  while (peek(cursor).value === ',') {
    take(cursor, ',');
    list.push(parseScalarExpr(cursor));
  }
  take(cursor, ')');
  return list;
};

export const readAttrValue = (cursor: Cursor): unknown => {
  const next = peek(cursor);
  if (next.kind === 'string') return take(cursor).value;
  if (next.value === '(') return readParenOrExpr(cursor);
  if (next.kind === 'number' || next.value === '-' || next.value === '+')
    return parseScalarExpr(cursor);
  if (next.kind === 'identifier') {
    const after = peek(cursor, 1).value;
    if (after === '(' || EXPR_OP.has(after)) return parseScalarExpr(cursor);
    const qualified = readQualified(cursor);
    return qualified === 'true' ? true : qualified === 'false' ? false : qualified;
  }
  return failSyntax(cursor, 'attribute value');
};

export const readAttrsUntil = (
  cursor: Cursor,
  stopTokens: readonly string[],
): Record<string, unknown> => {
  const attrs: Record<string, unknown> = {};
  while (!stopTokens.includes(peek(cursor).value)) {
    const key = readName(cursor);
    if (key in attrs) failSyntax(cursor, `unique attribute ${key}`);
    take(cursor, '=');
    attrs[key] = readAttrValue(cursor);
  }
  return attrs;
};

export const assertAllowedAttrs = (
  cursor: Cursor,
  attrs: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void => {
  for (const key of Object.keys(attrs)) {
    if (!allowed.has(key)) failSyntax(cursor, `allowed attribute (got "${key}")`);
  }
};

export const asScalar = (cursor: Cursor, val: unknown, name: string): StructureScalarExpr =>
  (typeof val === 'number' && Number.isFinite(val)) || (typeof val === 'string' && val.length > 0)
    ? val
    : failSyntax(cursor, `${name} = <scalar_expr>`);

export const asVec2 = (cursor: Cursor, val: unknown, name: string): ExprVec2 => {
  if (!Array.isArray(val) || val.length !== 2) failSyntax(cursor, `${name} = (x, z)`);
  const arr = val as readonly unknown[];
  return [asScalar(cursor, arr[0], name), asScalar(cursor, arr[1], name)];
};

export const asVec3 = (cursor: Cursor, val: unknown, name: string): ExprVec3 => {
  if (!Array.isArray(val) || val.length !== 3) failSyntax(cursor, `${name} = (x, y, z)`);
  const arr = val as readonly unknown[];
  return [
    asScalar(cursor, arr[0], name),
    asScalar(cursor, arr[1], name),
    asScalar(cursor, arr[2], name),
  ];
};

export const asIntVec2 = (cursor: Cursor, val: unknown, name: string): IntVec2 => {
  if (!Array.isArray(val) || val.length !== 2) failSyntax(cursor, `${name} = (x, z)`);
  const [a, b] = val as readonly unknown[];
  if (
    typeof a !== 'number' ||
    !Number.isSafeInteger(a) ||
    typeof b !== 'number' ||
    !Number.isSafeInteger(b)
  ) {
    failSyntax(cursor, `${name} = (int, int)`);
  }
  return [a as number, b as number];
};

export const asStr = (cursor: Cursor, val: unknown, expected: string): string =>
  typeof val === 'string' && val.length > 0 ? val : failSyntax(cursor, expected);

export const asOptStr = (cursor: Cursor, val: unknown, expected: string): string | undefined =>
  val === undefined ? undefined : asStr(cursor, val, expected);

export const asInt = (cursor: Cursor, val: unknown, name: string): number =>
  typeof val === 'number' && Number.isSafeInteger(val)
    ? val
    : failSyntax(cursor, `${name} = <int>`);

export const asNum = (cursor: Cursor, val: unknown, name: string): number =>
  typeof val === 'number' && Number.isFinite(val) ? val : failSyntax(cursor, `${name} = <number>`);

export const asFacing = (cursor: Cursor, val: unknown): CardinalFacing =>
  val === 'north' || val === 'south' || val === 'east' || val === 'west'
    ? val
    : failSyntax(cursor, 'north|south|east|west');

export const asOptFacing = (cursor: Cursor, val: unknown): CardinalFacing | undefined =>
  val === undefined ? undefined : asFacing(cursor, val);

export const asRotate = (cursor: Cursor, val: unknown): BlockRotation =>
  val === undefined
    ? 0
    : val === 0 || val === 90 || val === 180 || val === 270
      ? val
      : failSyntax(cursor, 'rotate = 0|90|180|270');

export const pickOptStrs = (
  cursor: Cursor,
  attrs: Record<string, unknown>,
  keys: readonly (readonly [string, string])[],
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [src, dst] of keys)
    if (attrs[src] !== undefined) out[dst] = asStr(cursor, attrs[src], src);
  return out;
};

const parseRoofDormer = (cursor: Cursor): RoofDormerSpec => {
  const attrs = readAttrsUntil(cursor, [';']);
  take(cursor, ';');
  assertAllowedAttrs(cursor, attrs, new Set(['wall', 'offset', 'width', 'height', 'window']));
  const width = asInt(cursor, attrs.width, 'width');
  const height = asInt(cursor, attrs.height, 'height');
  if (width < 1 || height < 2) failSyntax(cursor, 'dormer width >= 1 and height >= 2');
  return {
    wall: asFacing(cursor, attrs.wall),
    offset: attrs.offset === undefined ? 0 : asInt(cursor, attrs.offset, 'offset'),
    width,
    height,
    ...pickOptStrs(cursor, attrs, [['window', 'windowBlock']]),
  };
};

const parseRoofChimney = (cursor: Cursor): RoofChimneySpec => {
  const attrs = readAttrsUntil(cursor, [';']);
  take(cursor, ';');
  assertAllowedAttrs(
    cursor,
    attrs,
    new Set(['room', 'corner', 'offset', 'width', 'rise', 'block', 'cap']),
  );
  const corner = asStr(cursor, attrs.corner ?? 'nw', 'corner');
  if (!['nw', 'ne', 'sw', 'se', 'center'].includes(corner))
    failSyntax(cursor, 'corner = nw|ne|sw|se|center');
  const width = asInt(cursor, attrs.width ?? 1, 'width');
  const rise = asInt(cursor, attrs.rise ?? 3, 'rise');
  if (width < 1 || width > 4 || rise < 1) failSyntax(cursor, 'chimney width 1..4, rise >= 1');
  return {
    ...pickOptStrs(cursor, attrs, [['room', 'room']]),
    corner: corner as RoofChimneySpec['corner'],
    offset: attrs.offset === undefined ? [0, 0] : asIntVec2(cursor, attrs.offset, 'offset'),
    width,
    rise,
    block: asStr(cursor, attrs.block, 'block'),
    cap: attrs.cap === undefined ? true : Boolean(attrs.cap),
  };
};

const parseRoofExtras = (
  cursor: Cursor,
): { readonly dormers: RoofDormerSpec[]; readonly chimneys: RoofChimneySpec[] } => {
  const dormers: RoofDormerSpec[] = [];
  const chimneys: RoofChimneySpec[] = [];
  if (peek(cursor).value === ';') {
    take(cursor, ';');
    return { dormers, chimneys };
  }
  take(cursor, '{');
  while (peek(cursor).value !== '}') {
    const item = readName(cursor);
    if (item === 'dormer') dormers.push(parseRoofDormer(cursor));
    else if (item === 'chimney') chimneys.push(parseRoofChimney(cursor));
    else failSyntax(cursor, 'dormer or chimney');
  }
  take(cursor, '}');
  return { dormers, chimneys };
};

const ROOF_KEYS = new Set([
  'on',
  'style',
  'axis',
  'from',
  'to',
  'overhang',
  'pitch',
  'stair',
  'trim',
  'ridge',
  'gable',
  'under_eave',
  'battlement',
]);

const ROOF_STYLES = new Set(['gable', 'hip', 'pyramid', 'spire']);

const validateRoofMeta = (cursor: Cursor, attrs: Record<string, unknown>) => {
  assertAllowedAttrs(cursor, attrs, ROOF_KEYS);
  const style = attrs.style;
  if (typeof style !== 'string' || !ROOF_STYLES.has(style)) failSyntax(cursor, 'roof style');
  const axis = attrs.axis ?? 'z';
  if (axis !== 'x' && axis !== 'z') failSyntax(cursor, 'roof axis = x|z');
  const pitch = (attrs.pitch ?? 'standard') as RoofPitch;
  if (!['shallow', 'standard', 'steep'].includes(pitch)) failSyntax(cursor, 'pitch');
  if (attrs.on === undefined && (attrs.from === undefined || attrs.to === undefined))
    failSyntax(cursor, 'roof on or from/to');
  const overhang = attrs.overhang === undefined ? 0 : asInt(cursor, attrs.overhang, 'overhang');
  if (overhang < 0 || overhang > 3) failSyntax(cursor, 'overhang 0..3');
  if (attrs.battlement !== undefined && typeof attrs.battlement !== 'boolean')
    failSyntax(cursor, 'battlement = true|false');
  return { style: style as RoofStyle, axis: axis as MirrorAxis, pitch, overhang };
};

export const parseRoofOp = (cursor: Cursor): StructureOp => {
  const attrs = readAttrsUntil(cursor, [';', '{']);
  const meta = validateRoofMeta(cursor, attrs);
  const { dormers, chimneys } = parseRoofExtras(cursor);
  return {
    op: 'roof',
    ...meta,
    stair: asStr(cursor, attrs.stair, 'stair'),
    ridge: asStr(cursor, attrs.ridge, 'ridge'),
    ...pickOptStrs(cursor, attrs, [
      ['on', 'on'],
      ['trim', 'trim'],
      ['gable', 'gable'],
    ]),
    ...(attrs.from !== undefined ? { from: asVec3(cursor, attrs.from, 'from') } : {}),
    ...(attrs.to !== undefined ? { to: asVec3(cursor, attrs.to, 'to') } : {}),
    ...(attrs.under_eave !== undefined ? { underEave: Boolean(attrs.under_eave) } : {}),
    ...(attrs.battlement !== undefined ? { battlement: Boolean(attrs.battlement) } : {}),
    ...(dormers.length > 0 ? { dormers } : {}),
    ...(chimneys.length > 0 ? { chimneys } : {}),
  };
};

const parseMossOrShadow = (
  cursor: Cursor,
  kind: 'ground_moss' | 'eave_shadow',
  attrs: Record<string, unknown>,
): WeatheringRule => {
  assertAllowedAttrs(
    cursor,
    attrs,
    new Set(
      kind === 'ground_moss' ? ['height', 'target', 'into', 'rate'] : ['target', 'into', 'rate'],
    ),
  );
  const rate = asNum(cursor, attrs.rate, 'rate');
  if (rate < 0 || rate > 1) failSyntax(cursor, 'rate within 0..1');
  const target = asStr(cursor, attrs.target, 'target');
  const into = asStr(cursor, attrs.into, 'into');
  if (kind === 'eave_shadow') return { kind, target, into, rate };
  const height = asInt(cursor, attrs.height ?? 2, 'height');
  if (height < 0 || height > 16) failSyntax(cursor, 'height 0..16');
  return { kind, height, target, into, rate };
};

export const parseWeatheringOp = (cursor: Cursor): StructureOp => {
  take(cursor, '{');
  const rules: WeatheringRule[] = [];
  while (peek(cursor).value !== '}') {
    const kind = readName(cursor);
    const attrs = readAttrsUntil(cursor, [';']);
    take(cursor, ';');
    if (kind === 'ground_moss' || kind === 'eave_shadow')
      rules.push(parseMossOrShadow(cursor, kind, attrs));
    else if (kind === 'corner_quoin') {
      assertAllowedAttrs(cursor, attrs, new Set(['target', 'corners']));
      rules.push({
        kind,
        target: asStr(cursor, attrs.target, 'target'),
        corners: asStr(cursor, attrs.corners, 'corners'),
      });
    } else if (kind === 'chimney_soot') {
      assertAllowedAttrs(cursor, attrs, new Set(['radius', 'rate']));
      const radius = asInt(cursor, attrs.radius ?? 2, 'radius');
      const rate = asNum(cursor, attrs.rate, 'rate');
      if (radius < 1 || radius > 8 || rate < 0 || rate > 1)
        failSyntax(cursor, 'radius 1..8, rate 0..1');
      rules.push({ kind, radius, rate });
    } else failSyntax(cursor, 'weathering rule');
  }
  take(cursor, '}');
  return { op: 'weathering', rules };
};

const JETTY_ATTR_DIRS: readonly (readonly [string, CardinalFacing])[] = [
  ['jetty_n', 'north'],
  ['jetty_e', 'east'],
  ['jetty_s', 'south'],
  ['jetty_w', 'west'],
];

const readJettyAmount = (cursor: Cursor, val: unknown, key: string): number => {
  const n = asInt(cursor, val, key);
  if (n < 0 || n > 2) failSyntax(cursor, `${key} within 0..2`);
  return n;
};

export const parseFloorJetty = (
  cursor: Cursor,
  attrs: Record<string, unknown>,
): Readonly<Partial<Record<CardinalFacing, number>>> | undefined => {
  const out: Partial<Record<CardinalFacing, number>> = {};
  if (attrs.jetty !== undefined) {
    const base = readJettyAmount(cursor, attrs.jetty, 'jetty');
    if (base > 0) {
      out.north = base;
      out.east = base;
      out.south = base;
      out.west = base;
    }
  }
  for (const [key, dir] of JETTY_ATTR_DIRS) {
    if (attrs[key] === undefined) continue;
    const val = readJettyAmount(cursor, attrs[key], key);
    if (val > 0) out[dir] = val;
    else delete out[dir];
  }
  return Object.keys(out).length > 0 ? out : undefined;
};
