import type {
  AshfoxAssignStmt,
  AshfoxBlock,
  AshfoxExpr,
  AshfoxNamedBlock,
} from '../program/syntax/blockAst';
import type { SourceSpan } from '../source/contract';
import {
  StructureInputError,
  type BlockRotation,
  type CardinalFacing,
  type ExprVec2,
  type ExprVec3,
  type IntVec2,
  type StructureScalarExpr,
} from './contract';

export const failAst = (
  file: string,
  span: SourceSpan,
  expected: string,
  actual: string,
): never => {
  throw new StructureInputError({
    code: 'structure.syntax',
    file,
    pointer: `line:${span.start.line}:${span.start.column}`,
    expected,
    actual: actual || 'EOF',
  });
};

export interface AttrEntry {
  readonly value: unknown;
  readonly span: SourceSpan;
}

const formatBinaryExpr = (op: string, left: AshfoxExpr, right: AshfoxExpr, file: string): string =>
  `(${exprToScalar(left, file)} ${op} ${exprToScalar(right, file)})`;

export const exprToScalar = (expr: AshfoxExpr, file: string): StructureScalarExpr => {
  if (expr.kind === 'number') {
    if (expr.unit !== 'plain' && expr.unit !== 'block') {
      failAst(file, expr.span, 'integer or block unit (b)', expr.rawUnit);
    }
    return Number(expr.numerator) / Number(expr.denominator);
  }
  if (expr.kind === 'unary') {
    const inner = exprToScalar(expr.operand, file);
    if (typeof inner === 'number') return expr.operator === '-' ? -inner : inner;
    return `${expr.operator}${inner}`;
  }
  if (expr.kind === 'path') return expr.value;
  if (expr.kind === 'call') {
    return `${expr.callee}(${expr.args.map((a) => exprToScalar(a, file)).join(', ')})`;
  }
  if (expr.kind === 'binary') return formatBinaryExpr(expr.operator, expr.left, expr.right, file);
  return failAst(file, expr.span, 'scalar expression', expr.kind);
};

export const exprToNumber = (expr: AshfoxExpr, file: string, allowPercent = false): number => {
  if (expr.kind === 'unary' && expr.operand.kind === 'number') {
    const val = exprToNumber(expr.operand, file, allowPercent);
    return expr.operator === '-' ? -val : val;
  }
  if (expr.kind !== 'number') return failAst(file, expr.span, 'number', expr.kind);
  const val = Number(expr.numerator) / Number(expr.denominator);
  if (expr.unit === 'ratio' && expr.rawUnit === '%' && allowPercent) return val / 100;
  if (expr.unit === 'plain' || expr.unit === 'block' || expr.unit === 'degree') return val;
  return failAst(file, expr.span, 'numeric literal', expr.rawUnit);
};

const BINARY_OPS: Readonly<Partial<Record<string, (a: number, b: number) => number | null>>> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => (b !== 0 ? a / b : null),
};

const evalBinaryConst = (
  op: string,
  left: AshfoxExpr,
  right: AshfoxExpr,
  file: string,
): number | null => {
  const fn = BINARY_OPS[op];
  if (!fn) return null;
  const l = evalConstNum(left, file);
  const r = evalConstNum(right, file);
  if (l === null || r === null) return null;
  return fn(l, r);
};

const evalConstNum = (expr: AshfoxExpr, file: string): number | null => {
  if (expr.kind === 'number') {
    const valid = expr.unit === 'plain' || expr.unit === 'block' || expr.unit === 'degree';
    return valid ? Number(expr.numerator) / Number(expr.denominator) : null;
  }
  if (expr.kind === 'unary') {
    const inner = evalConstNum(expr.operand, file);
    if (inner === null) return null;
    return expr.operator === '-' ? -inner : inner;
  }
  if (expr.kind === 'binary') return evalBinaryConst(expr.operator, expr.left, expr.right, file);
  return null;
};

export const exprToAttrValue = (expr: AshfoxExpr, file: string): unknown => {
  if (expr.kind === 'string' || expr.kind === 'boolean' || expr.kind === 'color') return expr.value;
  if (expr.kind === 'tuple' || expr.kind === 'list') {
    return expr.elements.map((e) => exprToAttrValue(e, file));
  }
  if (expr.kind === 'map') {
    const out: Record<string, unknown> = {};
    for (const entry of expr.entries) out[entry.key] = exprToAttrValue(entry.value, file);
    return out;
  }
  if (expr.kind === 'number') {
    if (expr.unit === 'ratio' && expr.rawUnit === '%') {
      return Number(expr.numerator) / (Number(expr.denominator) * 100);
    }
    if (expr.unit === 'degree') return Number(expr.numerator) / Number(expr.denominator);
  }
  const num = evalConstNum(expr, file);
  if (num !== null) return num;
  return exprToScalar(expr, file);
};

export const readAssignEntry = (stmt: AshfoxAssignStmt, file: string): AttrEntry => {
  if (stmt.easing !== null || stmt.segments.length !== 1) {
    failAst(file, stmt.span, 'simple assignment', stmt.path);
  }
  return { value: exprToAttrValue(stmt.value, file), span: stmt.span };
};

export const readBlockAssigns = (block: AshfoxBlock, file: string): Record<string, AttrEntry> => {
  const attrs: Record<string, AttrEntry> = {};
  for (const stmt of block.statements) {
    if (stmt.kind !== 'assign') return failAst(file, stmt.span, 'property assignment', stmt.kind);
    if (Object.hasOwn(attrs, stmt.path)) {
      return failAst(file, stmt.span, `unique attribute ${stmt.path}`, stmt.path);
    }
    attrs[stmt.path] = readAssignEntry(stmt, file);
  }
  return attrs;
};

export const splitBlockParts = (
  block: AshfoxBlock,
  file: string,
): { readonly attrs: Record<string, AttrEntry>; readonly blocks: readonly AshfoxNamedBlock[] } => {
  const attrs: Record<string, AttrEntry> = {};
  const blocks: AshfoxNamedBlock[] = [];
  for (const stmt of block.statements) {
    if (stmt.kind === 'assign') {
      if (Object.hasOwn(attrs, stmt.path)) {
        return failAst(file, stmt.span, `unique attribute ${stmt.path}`, stmt.path);
      }
      attrs[stmt.path] = readAssignEntry(stmt, file);
    } else if (stmt.kind === 'named-block') {
      blocks.push(stmt);
    } else {
      return failAst(file, stmt.span, 'attribute or nested block', stmt.kind);
    }
  }
  return { attrs, blocks };
};

export const assertAllowedAttrs = (
  file: string,
  span: SourceSpan,
  attrs: Record<string, AttrEntry>,
  allowed: ReadonlySet<string>,
): void => {
  for (const key of Object.keys(attrs)) {
    if (!allowed.has(key)) {
      failAst(file, attrs[key]?.span ?? span, `allowed attribute`, key);
    }
  }
};

export const asScalar = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
  name: string,
): StructureScalarExpr => {
  const val = entry?.value;
  return (typeof val === 'number' && Number.isFinite(val)) ||
    (typeof val === 'string' && val.length > 0)
    ? val
    : failAst(file, entry?.span ?? span, `${name} = <scalar_expr>`, String(val));
};

export const asVec2 = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
  name: string,
): ExprVec2 => {
  const val = entry?.value;
  if (!Array.isArray(val) || val.length !== 2) {
    failAst(file, entry?.span ?? span, `${name} = (x, z)`, String(val));
  }
  const arr = val as readonly unknown[];
  const s = (x: unknown): StructureScalarExpr =>
    (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && x.length > 0)
      ? x
      : failAst(file, entry?.span ?? span, `${name} component`, String(x));
  return [s(arr[0]), s(arr[1])];
};

export const asVec3 = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
  name: string,
): ExprVec3 => {
  const val = entry?.value;
  if (!Array.isArray(val) || val.length !== 3) {
    failAst(file, entry?.span ?? span, `${name} = (x, y, z)`, String(val));
  }
  const arr = val as readonly unknown[];
  const s = (x: unknown): StructureScalarExpr =>
    (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && x.length > 0)
      ? x
      : failAst(file, entry?.span ?? span, `${name} component`, String(x));
  return [s(arr[0]), s(arr[1]), s(arr[2])];
};

export const asIntVec2 = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
  name: string,
): IntVec2 => {
  const val = entry?.value;
  if (!Array.isArray(val) || val.length !== 2) {
    failAst(file, entry?.span ?? span, `${name} = (x, z)`, String(val));
  }
  const [a, b] = val as readonly unknown[];
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    failAst(file, entry?.span ?? span, `${name} = (int, int)`, String(val));
  }
  return [a as number, b as number];
};

export const asStr = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
  expected: string,
): string => {
  const val = entry?.value;
  return typeof val === 'string' && val.length > 0
    ? val
    : failAst(file, entry?.span ?? span, expected, String(val));
};

export const asOptStr = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
  expected: string,
): string | undefined => (entry === undefined ? undefined : asStr(file, span, entry, expected));

export const asInt = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
  name: string,
): number => {
  const val = entry?.value;
  return typeof val === 'number' && Number.isSafeInteger(val)
    ? val
    : failAst(file, entry?.span ?? span, `${name} = <int>`, String(val));
};

export const asNum = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
  name: string,
): number => {
  const val = entry?.value;
  return typeof val === 'number' && Number.isFinite(val)
    ? val
    : failAst(file, entry?.span ?? span, `${name} = <number>`, String(val));
};

export const asFacing = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
): CardinalFacing => {
  const val = entry?.value;
  return val === 'north' || val === 'south' || val === 'east' || val === 'west'
    ? val
    : failAst(file, entry?.span ?? span, 'north|south|east|west', String(val));
};

export const asOptFacing = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
): CardinalFacing | undefined =>
  entry === undefined ? undefined : asFacing(file, entry.span ?? span, entry);

export const asRotate = (
  file: string,
  _span: SourceSpan,
  entry: AttrEntry | undefined,
): BlockRotation => {
  if (entry === undefined) return 0;
  const val = entry.value;
  return val === 0 || val === 90 || val === 180 || val === 270
    ? val
    : failAst(file, entry.span, 'rotate = 0|90|180|270', String(val));
};

export const pickOptStrs = (
  file: string,
  span: SourceSpan,
  attrs: Record<string, AttrEntry>,
  keys: readonly (readonly [string, string])[],
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [src, dst] of keys) {
    if (attrs[src] !== undefined) out[dst] = asStr(file, span, attrs[src], src);
  }
  return out;
};

const JETTY_ATTR_DIRS: readonly (readonly [string, CardinalFacing])[] = [
  ['jetty_n', 'north'],
  ['jetty_e', 'east'],
  ['jetty_s', 'south'],
  ['jetty_w', 'west'],
];

const readJettyAmount = (file: string, span: SourceSpan, entry: AttrEntry, key: string): number => {
  const n = asInt(file, span, entry, key);
  if (n < 0 || n > 2) failAst(file, entry.span, `${key} within 0..2`, String(n));
  return n;
};

export const parseFloorJetty = (
  file: string,
  span: SourceSpan,
  attrs: Record<string, AttrEntry>,
): Readonly<Partial<Record<CardinalFacing, number>>> | undefined => {
  const out: Partial<Record<CardinalFacing, number>> = {};
  if (attrs.jetty !== undefined) {
    const base = readJettyAmount(file, span, attrs.jetty, 'jetty');
    if (base > 0) {
      out.north = base;
      out.east = base;
      out.south = base;
      out.west = base;
    }
  }
  for (const [key, dir] of JETTY_ATTR_DIRS) {
    const entry = attrs[key];
    if (entry === undefined) continue;
    const val = readJettyAmount(file, span, entry, key);
    if (val > 0) out[dir] = val;
    else delete out[dir];
  }
  return Object.keys(out).length > 0 ? out : undefined;
};
