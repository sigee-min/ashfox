import { freeze } from '../../../../immutable';
import type { ProgramExpr } from '../../../../project/program/syntax/contract';
import {
  type AssetExpressionCompileResult,
  type AssetExpressionScalarType,
  type AssetExpressionType,
  type AssetExpressionTypeEnvironment,
  type AssetExpectedType,
  type AssetScalarUnit,
  type AssetTypedExpression,
  type AssetValueDiagnostic,
  type AssetVectorComponentType,
  isAssetColorLiteral,
} from './contract';
import { diagnostic, fitsExpected, immutableSpan } from './diagnostic';
import { typedBinary } from './typeBinary';
import { assetScalarInfo, assetVectorInfo, assetVectorType, isAssetExpressionType } from './types';
import { numberNode, typedCall, typedMember, typedVector } from './typing';

const MAX_EXPRESSION_NODES = 16384;

const CALL_EXPECTATIONS: ReadonlyMap<string, readonly (AssetExpressionType | undefined)[]> =
  new Map([
    ['texels', [undefined, undefined]],
    ['mirror_x', ['vec3<unit>', 'unit']],
    ['mirror_y', ['vec3<unit>', 'unit']],
    ['mirror_z', ['vec3<unit>', 'unit']],
    ['box_origin', ['vec3<unit>', 'vec3<unit>', 'vec3<ratio>']],
  ]);

type CompileWork = Readonly<{
  readonly expression: ProgramExpr;
  readonly expected: AssetExpressionType | undefined;
  readonly exit: boolean;
}>;

interface CompileState {
  readonly environment: AssetExpressionTypeEnvironment;
  readonly values: Map<ProgramExpr, Map<string, AssetTypedExpression>>;
  readonly failedNodes: Map<ProgramExpr, Set<string>>;
  readonly active: Map<ProgramExpr, Set<string>>;
  readonly diagnostics: AssetValueDiagnostic[];
  readonly pending: CompileWork[];
  visited: number;
}

const failed = (diagnostics: readonly AssetValueDiagnostic[]): AssetExpressionCompileResult =>
  freeze({
    ok: false,
    diagnostics: freeze([...diagnostics]),
  });

const succeeded = (value: AssetTypedExpression): AssetExpressionCompileResult =>
  freeze({ ok: true, value });

const expectedScalar = (
  expected: AssetExpressionType | undefined,
): AssetExpressionType | undefined => {
  if (expected === undefined) return undefined;
  return assetScalarInfo(expected) === null ? undefined : expected;
};

const expectedComponent = (
  expected: AssetExpressionType | undefined,
  arity: number,
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

const vectorComponent = (unit: AssetScalarUnit): AssetVectorComponentType | null =>
  unit === 'unit' || unit === 'texel' || unit === 'degree' || unit === 'ratio' ? unit : null;

const childrenOf = (expression: ProgramExpr): readonly ProgramExpr[] => {
  switch (expression.kind) {
    case 'unary':
      return [expression.operand];
    case 'binary':
      return [expression.left, expression.right];
    case 'member':
      return [expression.object];
    case 'vector':
      return Array.isArray(expression.values) ? expression.values : [];
    case 'call':
      return Array.isArray(expression.args) ? expression.args : [];
    default:
      return [];
  }
};

const expectedMemberChildren = (
  object: ProgramExpr,
  expected: AssetExpressionType | undefined,
): readonly (AssetExpressionType | undefined)[] => {
  const arity = vectorArity(object);
  const scalar = expected === undefined ? null : assetScalarInfo(expected);
  const component = scalar === null ? null : vectorComponent(scalar.unit);
  const inferred = arity === null || component === null ? null : assetVectorType(arity, component);
  return [inferred ?? undefined];
};

const expectedCallChildren = (
  expression: Extract<ProgramExpr, { readonly kind: 'call' }>,
  expected: AssetExpressionType | undefined,
): readonly (AssetExpressionType | undefined)[] => {
  const fixed = CALL_EXPECTATIONS.get(expression.name);
  if (fixed !== undefined) return fixed;
  const arity = expression.name === 'vec2' ? 2 : expression.name === 'vec3' ? 3 : null;
  const childExpected =
    arity === null ? expectedScalar(expected) : expectedComponent(expected, arity);
  return expression.args.map(() => childExpected);
};

const expectedVectorScaleChildren = (
  expression: Extract<ProgramExpr, { readonly kind: 'binary' }>,
  expected: AssetExpressionType | undefined,
): readonly (AssetExpressionType | undefined)[] => {
  const expectedInfo = expected === undefined ? null : assetVectorInfo(expected);
  if (expectedInfo === null || (expression.operator !== '*' && expression.operator !== '/')) {
    return [undefined, undefined];
  }
  const leftArity = vectorArity(expression.left);
  const rightArity = vectorArity(expression.right);
  if (leftArity !== null && rightArity === null) return [expected, undefined];
  if (rightArity !== null && leftArity === null) return [undefined, expected];
  return [undefined, undefined];
};

const expectedBinaryChildren = (
  expression: Extract<ProgramExpr, { readonly kind: 'binary' }>,
  expected: AssetExpressionType | undefined,
): readonly (AssetExpressionType | undefined)[] => {
  if (expression.operator === '+' || expression.operator === '-') return [expected, expected];
  if (expression.operator === '/') {
    const info = expected === undefined ? null : assetScalarInfo(expected);
    if (info !== null && info.unit !== 'plain') return [expected, undefined];
  }
  return expectedVectorScaleChildren(expression, expected);
};

const expectedChildren = (
  expression: ProgramExpr,
  expected: AssetExpressionType | undefined,
): readonly (AssetExpressionType | undefined)[] => {
  switch (expression.kind) {
    case 'unary':
      return [expectedScalar(expected)];
    case 'member':
      return expectedMemberChildren(expression.object, expected);
    case 'vector':
      return expression.values.map(() => expectedComponent(expected, expression.values.length));
    case 'call':
      return expectedCallChildren(expression, expected);
    case 'binary':
      return expectedBinaryChildren(expression, expected);
    default:
      return [];
  }
};

const addFailed = (
  failedNodes: Map<ProgramExpr, Set<string>>,
  expression: ProgramExpr,
  key: string,
): void => {
  const keys = failedNodes.get(expression) ?? new Set<string>();
  keys.add(key);
  failedNodes.set(expression, keys);
};

const setTyped = (
  values: Map<ProgramExpr, Map<string, AssetTypedExpression>>,
  expression: ProgramExpr,
  expected: AssetExpressionType | undefined,
  value: AssetTypedExpression,
): void => {
  const entries = values.get(expression) ?? new Map<string, AssetTypedExpression>();
  entries.set(expected ?? '', value);
  values.set(expression, entries);
};

const getTyped = (
  values: Map<ProgramExpr, Map<string, AssetTypedExpression>>,
  expression: ProgramExpr,
  expected: AssetExpressionType | undefined,
): AssetTypedExpression | undefined => values.get(expression)?.get(expected ?? '');

const lookupAssetType = (
  environment: AssetExpressionTypeEnvironment,
  name: string,
): Readonly<{
  readonly status: 'missing' | 'invalid' | 'bound';
  readonly value: AssetExpressionType | null;
}> => {
  try {
    if (
      environment === null ||
      typeof environment !== 'object' ||
      typeof environment.has !== 'function' ||
      typeof environment.get !== 'function'
    ) {
      return { status: 'invalid', value: null };
    }
    if (!environment.has(name)) return { status: 'missing', value: null };
    const type = environment.get(name);
    return type === undefined
      ? { status: 'invalid', value: null }
      : { status: 'bound', value: type };
  } catch {
    return { status: 'invalid', value: null };
  }
};

const compileColorNode = (
  current: Extract<ProgramExpr, { readonly kind: 'color' }>,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  if (!isAssetColorLiteral(current.value)) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-type',
        'Color literal must be a six-digit hexadecimal value.',
        current.span,
      ),
    );
    return null;
  }
  if (!fitsExpected('color', expected, current.span, diagnostics)) return null;
  return freeze({
    kind: 'color',
    type: 'color',
    value: current.value,
    span: immutableSpan(current.span),
  });
};

const compileNameNode = (
  current: Extract<ProgramExpr, { readonly kind: 'name' }>,
  expected: AssetExpressionType | undefined,
  state: CompileState,
): AssetTypedExpression | null => {
  const lookup = lookupAssetType(state.environment, current.value);
  const type = lookup.value;
  if (lookup.status === 'missing') {
    state.diagnostics.push(
      diagnostic(
        'asset.value.unknown-name',
        'Unknown expression name "' + current.value + '".',
        current.span,
      ),
    );
    return null;
  }
  if (lookup.status !== 'bound' || type === null || !isAssetExpressionType(type)) {
    state.diagnostics.push(
      diagnostic(
        'asset.value.invalid-environment',
        'Expression name "' + current.value + '" has an invalid closed type.',
        current.span,
      ),
    );
    return null;
  }
  if (!fitsExpected(type, expected, current.span, state.diagnostics)) return null;
  return freeze({
    kind: 'name',
    name: current.value,
    type,
    span: immutableSpan(current.span),
  });
};

const compileLeafNode = (
  current: ProgramExpr,
  expected: AssetExpressionType | undefined,
  state: CompileState,
): boolean => {
  let value: AssetTypedExpression | null;
  if (current.kind === 'number') value = numberNode(current, expected, state.diagnostics);
  else if (current.kind === 'boolean') {
    value = fitsExpected('bool', expected, current.span, state.diagnostics)
      ? freeze({
          kind: 'boolean',
          type: 'bool',
          value: current.value,
          span: immutableSpan(current.span),
        })
      : null;
  } else if (current.kind === 'color') {
    value = compileColorNode(current, expected, state.diagnostics);
  } else if (current.kind === 'string') {
    state.diagnostics.push(
      diagnostic(
        'asset.value.invalid-type',
        'String values are not part of the closed asset value ABI.',
        current.span,
      ),
    );
    value = null;
  } else if (current.kind === 'name') {
    value = compileNameNode(current, expected, state);
  } else return false;

  if (value === null) addFailed(state.failedNodes, current, expected ?? '');
  else setTyped(state.values, current, expected, value);
  return true;
};

const typedUnary = (
  current: Extract<ProgramExpr, { readonly kind: 'unary' }>,
  operandNode: AssetTypedExpression,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  const operand = assetScalarInfo(operandNode.type);
  if (operand === null) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-operator',
        'Unary operators require a numeric operand.',
        current.span,
      ),
    );
    return null;
  }
  if (!fitsExpected(operand.type, expected, current.span, diagnostics)) return null;
  return freeze({
    kind: 'unary',
    operator: current.operator,
    operand: operandNode,
    type: operand.type,
    span: immutableSpan(current.span),
  });
};

const typedCompound = (
  current: ProgramExpr,
  typed: readonly AssetTypedExpression[],
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  if (current.kind === 'unary') return typedUnary(current, typed[0]!, expected, diagnostics);
  if (current.kind === 'vector') return typedVector(current, typed, expected, diagnostics);
  if (current.kind === 'call') return typedCall(current, typed, expected, diagnostics);
  if (current.kind === 'member') return typedMember(current, typed[0]!, expected, diagnostics);
  if (current.kind === 'binary') {
    return typedBinary(current, typed[0]!, typed[1]!, expected, diagnostics);
  }
  return null;
};

const enterCompileNode = (work: CompileWork, state: CompileState): void => {
  const current = work.expression;
  const key = work.expected ?? '';
  const activeKeys = state.active.get(current) ?? new Set<string>();
  if (activeKeys.has(key)) {
    state.diagnostics.push(
      diagnostic(
        'asset.value.expression-cycle',
        'Expression graph contains a cycle.',
        current.span,
      ),
    );
    addFailed(state.failedNodes, current, key);
    return;
  }
  if (compileLeafNode(current, work.expected, state)) return;
  activeKeys.add(key);
  state.active.set(current, activeKeys);
  state.pending.push({ expression: current, expected: work.expected, exit: true });
  const children = childrenOf(current);
  const expectations = expectedChildren(current, work.expected);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    state.pending.push({
      expression: children[index]!,
      expected: expectations[index],
      exit: false,
    });
  }
};

const exitCompileNode = (work: CompileWork, state: CompileState): void => {
  const current = work.expression;
  const key = work.expected ?? '';
  state.active.get(current)?.delete(key);
  const children = childrenOf(current);
  const expectations = expectedChildren(current, work.expected);
  const typedChildren = children.map((child, index) =>
    getTyped(state.values, child, expectations[index]),
  );
  if (typedChildren.some((child) => child === undefined)) {
    addFailed(state.failedNodes, current, key);
    return;
  }
  const value = typedCompound(
    current,
    typedChildren as AssetTypedExpression[],
    work.expected,
    state.diagnostics,
  );
  if (value === null) addFailed(state.failedNodes, current, key);
  else setTyped(state.values, current, work.expected, value);
};

/** Compile a ProgramExpr without evaluating it or resolving global names. */
export const compileAssetExpression = (
  expression: ProgramExpr,
  environment: AssetExpressionTypeEnvironment,
  expected?: AssetExpectedType,
): AssetExpressionCompileResult => {
  const state: CompileState = {
    environment,
    values: new Map(),
    failedNodes: new Map(),
    active: new Map(),
    diagnostics: [],
    pending: [{ expression, expected, exit: false }],
    visited: 0,
  };
  while (state.pending.length > 0) {
    const work = state.pending.pop()!;
    const key = work.expected ?? '';
    if (!work.exit && ++state.visited > MAX_EXPRESSION_NODES) {
      state.diagnostics.push(
        diagnostic(
          'asset.value.expression-limit',
          'Expression exceeds the compiler node budget.',
          work.expression.span,
        ),
      );
      break;
    }
    if (
      getTyped(state.values, work.expression, work.expected) !== undefined ||
      state.failedNodes.get(work.expression)?.has(key)
    ) {
      continue;
    }
    if (work.exit) exitCompileNode(work, state);
    else enterCompileNode(work, state);
  }
  const result = getTyped(state.values, expression, expected);
  if (state.diagnostics.length > 0) return failed(state.diagnostics);
  if (result === undefined) {
    return failed([
      diagnostic('asset.value.invalid-type', 'Expression could not be typed.', expression.span),
    ]);
  }
  return succeeded(result);
};
