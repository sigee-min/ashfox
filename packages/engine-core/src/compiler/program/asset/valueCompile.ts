import type { ProgramExpr } from '../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../project/source/contract';
import {
  type AssetExpressionCompileResult,
  type AssetExpressionScalarType,
  type AssetExpressionType,
  type AssetExpressionTypeEnvironment,
  type AssetExpectedType,
  type AssetScalarUnit,
  type AssetVectorComponentType,
  type AssetTypedExpression,
  type AssetValueDiagnostic,
  type AssetValueDiagnosticCode,
  isAssetColorLiteral
} from './value/contract';
import {
  assetScalarInfo,
  assetTypeCompatible,
  assetVectorInfo,
  assetVectorType,
  isAssetExpressionType
} from './valueTypes';
import {
  numberNode,
  typedBinary,
  typedCall,
  typedMember,
  typedVector
} from './valueCompileNodes';

const MAX_EXPRESSION_NODES = 16384;
const freeze = <T>(value: T): T => Object.freeze(value);

const immutableSpan = (span: SourceSpan): SourceSpan => freeze({
  start: freeze({ offset: span.start.offset, line: span.start.line, column: span.start.column }),
  end: freeze({ offset: span.end.offset, line: span.end.line, column: span.end.column })
});

const diagnostic = (
  code: AssetValueDiagnosticCode,
  message: string,
  span: SourceSpan
): AssetValueDiagnostic => freeze({ code, message, span: immutableSpan(span) });

const failed = (
  diagnostics: readonly AssetValueDiagnostic[]
): AssetExpressionCompileResult => freeze({
  ok: false,
  diagnostics: freeze([...diagnostics])
});

const succeeded = (value: AssetTypedExpression): AssetExpressionCompileResult =>
  freeze({ ok: true, value });

const fitsExpected = (
  actual: AssetExpressionType,
  expected: AssetExpressionType | undefined,
  span: SourceSpan,
  diagnostics: AssetValueDiagnostic[]
): boolean => {
  if (expected === undefined || assetTypeCompatible(actual, expected)) return true;
  diagnostics.push(diagnostic('asset.value.type-mismatch',
    'Expression type "' + actual + '" does not satisfy expected type "' + expected + '".', span));
  return false;
};

const expectedScalar = (
  expected: AssetExpressionType | undefined
): AssetExpressionType | undefined => {
  if (expected === undefined) return undefined;
  return assetScalarInfo(expected) === null ? undefined : expected;
};

const expectedComponent = (
  expected: AssetExpressionType | undefined,
  arity: number
): AssetExpressionScalarType | undefined => {
  if (expected === undefined) return undefined;
  const info = assetVectorInfo(expected);
  return info !== null && info.arity === arity ? info.component : undefined;
};

const vectorArity = (expression: ProgramExpr): number | null => {
  if (expression.kind === 'vector') return expression.values.length;
  if (expression.kind === 'call') {
    if (expression.name === 'vec2') return 2;
    if (expression.name === 'vec3') return 3;
  }
  return null;
};

const vectorComponent = (
  unit: AssetScalarUnit
): AssetVectorComponentType | null => unit === 'unit' || unit === 'texel' ||
  unit === 'degree' || unit === 'ratio' ? unit : null;

const childrenOf = (expression: ProgramExpr): readonly ProgramExpr[] => {
  switch (expression.kind) {
    case 'unary': return [expression.operand];
    case 'binary': return [expression.left, expression.right];
    case 'member': return [expression.object];
    case 'vector': return Array.isArray(expression.values) ? expression.values : [];
    case 'call': return Array.isArray(expression.args) ? expression.args : [];
    default: return [];
  }
};

const expectedChildren = (
  expression: ProgramExpr,
  expected: AssetExpressionType | undefined
): readonly (AssetExpressionType | undefined)[] => {
  switch (expression.kind) {
    case 'unary': return [expectedScalar(expected)];
    case 'member': {
      const arity = vectorArity(expression.object);
      const scalar = expected === undefined ? null : assetScalarInfo(expected);
      const component = scalar === null ? null : vectorComponent(scalar.unit);
      const inferred = arity === null || component === null ? null :
        assetVectorType(arity, component);
      return [inferred ?? undefined];
    }
    case 'vector': return expression.values.map(() =>
      expectedComponent(expected, expression.values.length));
    case 'call': {
      if (expression.name === 'texels') return [undefined, undefined];
      if (['mirror_x', 'mirror_y', 'mirror_z'].includes(expression.name)) {
        return ['vec3<unit>', 'unit'];
      }
      if (expression.name === 'box_origin') return ['vec3<unit>', 'vec3<unit>', 'vec3<ratio>'];
      const arity = expression.name === 'vec2' ? 2 : expression.name === 'vec3' ? 3 : null;
      const childExpected = arity === null ? expectedScalar(expected) :
        expectedComponent(expected, arity);
      return expression.args.map(() => childExpected);
    }
    case 'binary': {
      if (expression.operator === '+' || expression.operator === '-') {
        return [expected, expected];
      }
      if (expression.operator === '/') {
        const info = expected === undefined ? null : assetScalarInfo(expected);
        if (info !== null && info.unit !== 'plain') return [expected, undefined];
      }
      const expectedInfo = expected === undefined ? null : assetVectorInfo(expected);
      if (expectedInfo !== null && (expression.operator === '*' || expression.operator === '/')) {
        const leftArity = vectorArity(expression.left);
        const rightArity = vectorArity(expression.right);
        if (leftArity !== null && rightArity === null) return [expected, undefined];
        if (rightArity !== null && leftArity === null) return [undefined, expected];
      }
      return [undefined, undefined];
    }
    default: return [];
  }
};

const addFailed = (
  failedNodes: Map<ProgramExpr, Set<string>>,
  expression: ProgramExpr,
  key: string
): void => {
  const keys = failedNodes.get(expression) ?? new Set<string>();
  keys.add(key); failedNodes.set(expression, keys);
};

const setTyped = (
  values: Map<ProgramExpr, Map<string, AssetTypedExpression>>,
  expression: ProgramExpr,
  expected: AssetExpressionType | undefined,
  value: AssetTypedExpression
): void => {
  const entries = values.get(expression) ?? new Map<string, AssetTypedExpression>();
  entries.set(expected ?? '', value); values.set(expression, entries);
};

const getTyped = (
  values: Map<ProgramExpr, Map<string, AssetTypedExpression>>,
  expression: ProgramExpr,
  expected: AssetExpressionType | undefined
): AssetTypedExpression | undefined => values.get(expression)?.get(expected ?? '');

const lookupAssetType = (
  environment: AssetExpressionTypeEnvironment,
  name: string
): Readonly<{ readonly status: 'missing' | 'invalid' | 'bound'; readonly value: AssetExpressionType | null }> => {
  try {
    if (environment === null || typeof environment !== 'object' ||
      typeof environment.has !== 'function' || typeof environment.get !== 'function') {
      return { status: 'invalid', value: null };
    }
    if (!environment.has(name)) return { status: 'missing', value: null };
    const type = environment.get(name);
    return type === undefined ? { status: 'invalid', value: null } :
      { status: 'bound', value: type };
  } catch {
    return { status: 'invalid', value: null };
  }
};

/** Compile a ProgramExpr without evaluating it or resolving global names. */
export const compileAssetExpression = (
  expression: ProgramExpr,
  environment: AssetExpressionTypeEnvironment,
  expected?: AssetExpectedType
): AssetExpressionCompileResult => {
  const values = new Map<ProgramExpr, Map<string, AssetTypedExpression>>();
  const failedNodes = new Map<ProgramExpr, Set<string>>();
  const active = new Map<ProgramExpr, Set<string>>();
  const diagnostics: AssetValueDiagnostic[] = [];
  type Work = Readonly<{
    readonly expression: ProgramExpr;
    readonly expected: AssetExpressionType | undefined;
    readonly exit: boolean;
  }>;
  const pending: Work[] = [{ expression, expected, exit: false }];
  let visited = 0;
  while (pending.length > 0) {
    const work = pending.pop()!;
    const current = work.expression;
    const key = work.expected ?? '';
    if (!work.exit && ++visited > MAX_EXPRESSION_NODES) {
      diagnostics.push(diagnostic('asset.value.expression-limit',
        'Expression exceeds the compiler node budget.', current.span));
      break;
    }
    if (getTyped(values, current, work.expected) !== undefined || failedNodes.get(current)?.has(key)) continue;
    if (!work.exit) {
      const activeKeys = active.get(current) ?? new Set<string>();
      if (activeKeys.has(key)) {
        diagnostics.push(diagnostic('asset.value.expression-cycle',
          'Expression graph contains a cycle.', current.span));
        addFailed(failedNodes, current, key); continue;
      }
      if (current.kind === 'number') {
        const value = numberNode(current, work.expected, diagnostics);
        if (value === null) addFailed(failedNodes, current, key);
        else setTyped(values, current, work.expected, value);
        continue;
      }
      if (current.kind === 'boolean') {
        if (!fitsExpected('bool', work.expected, current.span, diagnostics)) addFailed(failedNodes, current, key);
        else setTyped(values, current, work.expected, freeze({ kind: 'boolean', type: 'bool', value: current.value, span: immutableSpan(current.span) }));
        continue;
      }
      if (current.kind === 'color') {
        if (!isAssetColorLiteral(current.value)) {
          diagnostics.push(diagnostic('asset.value.invalid-type',
            'Color literal must be a six-digit hexadecimal value.', current.span));
          addFailed(failedNodes, current, key);
        } else if (!fitsExpected('color', work.expected, current.span, diagnostics)) addFailed(failedNodes, current, key);
        else setTyped(values, current, work.expected, freeze({ kind: 'color', type: 'color', value: current.value, span: immutableSpan(current.span) }));
        continue;
      }
      if (current.kind === 'string') {
        diagnostics.push(diagnostic('asset.value.invalid-type',
          'String values are not part of the closed asset value ABI.', current.span));
        addFailed(failedNodes, current, key); continue;
      }
      if (current.kind === 'name') {
        const lookup = lookupAssetType(environment, current.value);
        const type = lookup.value;
        if (lookup.status === 'missing') {
          diagnostics.push(diagnostic('asset.value.unknown-name',
            'Unknown expression name "' + current.value + '".', current.span));
          addFailed(failedNodes, current, key);
        } else if (lookup.status !== 'bound' || type === null || !isAssetExpressionType(type)) {
          diagnostics.push(diagnostic('asset.value.invalid-environment',
            'Expression name "' + current.value + '" has an invalid closed type.', current.span));
          addFailed(failedNodes, current, key);
        } else if (!fitsExpected(type, work.expected, current.span, diagnostics)) addFailed(failedNodes, current, key);
        else setTyped(values, current, work.expected, freeze({ kind: 'name', name: current.value, type, span: immutableSpan(current.span) }));
        continue;
      }
      const keys = active.get(current) ?? new Set<string>(); keys.add(key); active.set(current, keys);
      pending.push({ expression: current, expected: work.expected, exit: true });
      const children = childrenOf(current);
      const expectations = expectedChildren(current, work.expected);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({ expression: children[index]!, expected: expectations[index], exit: false });
      }
      continue;
    }
    active.get(current)?.delete(key);
    const children = childrenOf(current);
    const expectations = expectedChildren(current, work.expected);
    const typedChildren = children.map((child, index) => getTyped(values, child, expectations[index]));
    if (typedChildren.some((child) => child === undefined)) {
      addFailed(failedNodes, current, key); continue;
    }
    const typed = typedChildren as AssetTypedExpression[];
    let value: AssetTypedExpression | null;
    if (current.kind === 'unary') {
      const operand = assetScalarInfo(typed[0]!.type);
      if (operand === null) {
        diagnostics.push(diagnostic('asset.value.invalid-operator',
          'Unary operators require a numeric operand.', current.span));
        value = null;
      } else value = fitsExpected(operand.type, work.expected, current.span, diagnostics)
        ? freeze({ kind: 'unary', operator: current.operator, operand: typed[0]!, type: operand.type, span: immutableSpan(current.span) }) : null;
    } else if (current.kind === 'vector') value = typedVector(current, typed, work.expected, diagnostics);
    else if (current.kind === 'call') value = typedCall(current, typed, work.expected, diagnostics);
    else if (current.kind === 'member') value = typedMember(current, typed[0]!, work.expected, diagnostics);
    else if (current.kind === 'binary') value = typedBinary(current, typed[0]!, typed[1]!, work.expected, diagnostics);
    else {
      addFailed(failedNodes, current, key);
      continue;
    }
    if (value === null) addFailed(failedNodes, current, key);
    else setTyped(values, current, work.expected, value);
  }
  const result = getTyped(values, expression, expected);
  if (diagnostics.length > 0) return failed(diagnostics);
  if (result === undefined) return failed([diagnostic('asset.value.invalid-type',
    'Expression could not be typed.', expression.span)]);
  return succeeded(result);
};
