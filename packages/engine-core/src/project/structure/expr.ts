import { lexProgramSource } from '../program/syntax/lex';
import {
  StructureInputError,
  type Cursor,
  type ExprVec2,
  type ExprVec3,
  type StructureParamValue,
  type StructureScalarExpr,
} from './contract';

const peek = (
  cursor: Cursor,
): {
  readonly kind: string;
  readonly value: string;
  readonly span: { readonly start: { readonly line: number; readonly column: number } };
} => cursor.tokens[cursor.offset] ?? cursor.tokens[cursor.tokens.length - 1]!;

const failExprSyntax = (cursor: Cursor, expected: string): never => {
  const token = peek(cursor);
  throw new StructureInputError({
    code: 'structure.syntax',
    file: cursor.file,
    pointer: `line:${token.span.start.line}:${token.span.start.column}`,
    expected,
    actual: token.value || 'EOF',
  });
};

const take = (cursor: Cursor, expected?: string) => {
  const token = peek(cursor);
  if (expected !== undefined && token.value !== expected) failExprSyntax(cursor, expected);
  if (token.kind === 'eof') failExprSyntax(cursor, expected ?? 'token');
  cursor.offset += 1;
  return token;
};

const readIdent = (cursor: Cursor): string => {
  const token = peek(cursor);
  if (token.kind !== 'identifier' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(token.value)) {
    failExprSyntax(cursor, 'identifier');
  }
  return take(cursor).value;
};

type ExprNode =
  | { readonly kind: 'lit'; readonly value: number }
  | { readonly kind: 'ref'; readonly name: string }
  | { readonly kind: 'unary'; readonly op: '+' | '-'; readonly inner: ExprNode }
  | {
      readonly kind: 'binary';
      readonly op: string;
      readonly left: ExprNode;
      readonly right: ExprNode;
    }
  | { readonly kind: 'call'; readonly fn: string; readonly args: readonly ExprNode[] };

const EXPR_FNS = new Set(['floor', 'ceil', 'round', 'min', 'max', 'abs', 'clamp']);
const PRECEDENCE: Readonly<Record<string, number>> = {
  '==': 1,
  '!=': 1,
  '<': 2,
  '<=': 2,
  '>': 2,
  '>=': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '%': 4,
};

const parseCallArgs = (cursor: Cursor, depth: number): ExprNode[] => {
  const args: ExprNode[] = [];
  if (peek(cursor).value !== ')') {
    args.push(parseBinary(cursor, 0, depth + 1));
    while (peek(cursor).value === ',') {
      take(cursor, ',');
      args.push(parseBinary(cursor, 0, depth + 1));
    }
  }
  take(cursor, ')');
  return args;
};

const parsePrimary = (cursor: Cursor, depth: number): ExprNode => {
  if (depth > 24) failExprSyntax(cursor, 'expression depth <= 24');
  const tok = peek(cursor);
  if (tok.value === '(') {
    take(cursor, '(');
    const inner = parseBinary(cursor, 0, depth + 1);
    take(cursor, ')');
    return inner;
  }
  if (tok.kind === 'number') {
    if (!/^\d+(?:\.\d+)?$/u.test(tok.value)) failExprSyntax(cursor, 'numeric literal');
    take(cursor);
    return { kind: 'lit', value: Number(tok.value) };
  }
  if (tok.kind === 'identifier') {
    const name = readIdent(cursor);
    if (peek(cursor).value !== '(') return { kind: 'ref', name };
    if (!EXPR_FNS.has(name)) failExprSyntax(cursor, `math function`);
    take(cursor, '(');
    const args = parseCallArgs(cursor, depth);
    if (args.length === 0) failExprSyntax(cursor, `arguments for ${name}()`);
    return { kind: 'call', fn: name, args };
  }
  return failExprSyntax(cursor, 'scalar expression');
};

const parseUnary = (cursor: Cursor, depth: number): ExprNode => {
  const tok = peek(cursor);
  if (tok.value === '+' || tok.value === '-') {
    take(cursor);
    return { kind: 'unary', op: tok.value as '+' | '-', inner: parseUnary(cursor, depth + 1) };
  }
  return parsePrimary(cursor, depth);
};

const parseBinary = (cursor: Cursor, minPrec: number, depth: number): ExprNode => {
  let left = parseUnary(cursor, depth);
  while (true) {
    const tok = peek(cursor);
    const prec = tok.kind === 'symbol' ? PRECEDENCE[tok.value] : undefined;
    if (prec === undefined || prec < minPrec) break;
    const op = take(cursor).value;
    left = { kind: 'binary', op, left, right: parseBinary(cursor, prec + 1, depth + 1) };
  }
  return left;
};

const formatExpr = (node: ExprNode): string => {
  if (node.kind === 'lit') return String(node.value);
  if (node.kind === 'ref') return node.name;
  if (node.kind === 'unary') return `${node.op}${formatExpr(node.inner)}`;
  if (node.kind === 'call') return `${node.fn}(${node.args.map(formatExpr).join(', ')})`;
  return `(${formatExpr(node.left)} ${node.op} ${formatExpr(node.right)})`;
};

const tryStaticNumber = (node: ExprNode): number | null => {
  if (node.kind === 'lit') return node.value;
  if (node.kind === 'unary' && node.inner.kind === 'lit') {
    return node.op === '-' ? -node.inner.value : node.inner.value;
  }
  return null;
};

export const parseScalarExpr = (cursor: Cursor): StructureScalarExpr => {
  const node = parseBinary(cursor, 0, 0);
  const literal = tryStaticNumber(node);
  return literal !== null ? literal : formatExpr(node);
};

export const parseExprVec2 = (cursor: Cursor): ExprVec2 => {
  take(cursor, '(');
  const x = parseScalarExpr(cursor);
  take(cursor, ',');
  const z = parseScalarExpr(cursor);
  take(cursor, ')');
  return [x, z];
};

const failExpr = (file: string, pointer: string, message: string): never => {
  throw new StructureInputError({
    code: 'structure.bad-expr',
    file,
    pointer,
    expected: 'finite scalar expression',
    actual: message,
  });
};

const evalCall = (fn: string, vals: readonly number[], file: string, ptr: string): number => {
  if (fn === 'floor' && vals.length === 1) return Math.floor(vals[0]!);
  if (fn === 'ceil' && vals.length === 1) return Math.ceil(vals[0]!);
  if (fn === 'round' && vals.length === 1) return Math.round(vals[0]!);
  if (fn === 'abs' && vals.length === 1) return Math.abs(vals[0]!);
  if (fn === 'min' && vals.length >= 1) return Math.min(...vals);
  if (fn === 'max' && vals.length >= 1) return Math.max(...vals);
  if (fn === 'clamp' && vals.length === 3) return Math.min(vals[2]!, Math.max(vals[1]!, vals[0]!));
  return failExpr(file, ptr, `Invalid arguments for ${fn}()`);
};

const evalBinary = (op: string, a: number, b: number, file: string, ptr: string): number => {
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  if (op === '/') return b === 0 ? failExpr(file, ptr, 'Division by zero') : a / b;
  if (op === '%') return b === 0 ? failExpr(file, ptr, 'Modulo by zero') : a % b;
  const cmp: Readonly<Record<string, boolean>> = {
    '==': a === b,
    '!=': a !== b,
    '<': a < b,
    '<=': a <= b,
    '>': a > b,
    '>=': a >= b,
  };
  return cmp[op] ? 1 : 0;
};

const evalNode = (
  node: ExprNode,
  params: Readonly<Record<string, StructureParamValue>>,
  file: string,
  ptr: string,
): number => {
  if (node.kind === 'lit') return node.value;
  if (node.kind === 'ref') {
    const v = params[node.name];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return failExpr(file, ptr, `Undefined or non-numeric param "${node.name}"`);
  }
  if (node.kind === 'unary') {
    const v = evalNode(node.inner, params, file, ptr);
    return node.op === '-' ? -v : v;
  }
  if (node.kind === 'call')
    return evalCall(
      node.fn,
      node.args.map((a) => evalNode(a, params, file, ptr)),
      file,
      ptr,
    );
  return evalBinary(
    node.op,
    evalNode(node.left, params, file, ptr),
    evalNode(node.right, params, file, ptr),
    file,
    ptr,
  );
};

export const evaluateScalarExpr = (
  expr: StructureScalarExpr,
  params: Readonly<Record<string, StructureParamValue>>,
  file: string,
  ptr = 'expr',
): number => {
  if (typeof expr === 'number') {
    if (!Number.isFinite(expr)) failExpr(file, ptr, String(expr));
    return expr;
  }
  const lex = lexProgramSource(expr);
  if (lex.diagnostics.length > 0) failExpr(file, ptr, expr);
  const cursor: Cursor = { tokens: lex.tokens, file, offset: 0 };
  const ast = parseBinary(cursor, 0, 0);
  if (peek(cursor).kind !== 'eof') failExpr(file, ptr, expr);
  const val = evalNode(ast, params, file, ptr);
  if (!Number.isFinite(val)) failExpr(file, ptr, `${expr} -> ${val}`);
  return val;
};

export const evaluateScalarInt = (
  expr: StructureScalarExpr,
  params: Readonly<Record<string, StructureParamValue>>,
  file: string,
  ptr = 'expr',
): number => {
  const val = evaluateScalarExpr(expr, params, file, ptr);
  if (!Number.isInteger(val)) failExpr(file, ptr, `Expected integer from "${expr}", got ${val}`);
  return val;
};

export const evaluateExprVec2 = (
  vec: ExprVec2,
  params: Readonly<Record<string, StructureParamValue>>,
  file: string,
  ptr = 'vec2',
): readonly [number, number] => [
  evaluateScalarInt(vec[0], params, file, ptr),
  evaluateScalarInt(vec[1], params, file, ptr),
];

export const evaluateExprVec3 = (
  vec: ExprVec3,
  params: Readonly<Record<string, StructureParamValue>>,
  file: string,
  ptr = 'vec3',
): readonly [number, number, number] => [
  evaluateScalarInt(vec[0], params, file, ptr),
  evaluateScalarInt(vec[1], params, file, ptr),
  evaluateScalarInt(vec[2], params, file, ptr),
];
