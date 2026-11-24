import { freeze } from '../../../../immutable';
import type { SourceSpan } from '../../../../project/source/contract';
import {
  assetBooleanValue,
  assetColorValue,
  assetExactNumber,
  assetVectorValue,
  type AssetCanonicalNumberBoundary,
  type AssetCanonicalNumberResult,
  type AssetExactNumber,
  type AssetExpressionEvaluationResult,
  type AssetExpressionType,
  type AssetExpressionValueEnvironment,
  type AssetNumberValue,
  type AssetTypedExpression,
  type AssetValue,
  type AssetValueDiagnostic,
  type AssetValueResult,
  isAssetColorLiteral,
  isAssetExactNumberInput,
  isAssetExactNumberWithinBudget,
  isAssetScalarUnit,
} from './contract';
import { succeed, type AssetOperationResult } from './arithmetic';
import { evaluateAssetBinary } from './binary';
import { evaluateAssetCall } from './call';
import { diagnostic } from './diagnostic';
import { cloneAssetValue, exactValueError, lookupAssetValue, valueFromExact } from './runtime';
import { assetTypeCompatible, assetVectorInfo } from './types';

const MAX_EXPRESSION_NODES = 16384;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const isBooleanPayload = (value: boolean): boolean => typeof value === 'boolean';

type EvaluateWork = Readonly<{ readonly expression: AssetTypedExpression; readonly exit: boolean }>;

interface EvaluateState {
  readonly environment: AssetExpressionValueEnvironment;
  readonly values: Map<AssetTypedExpression, AssetValue>;
  readonly active: Set<AssetTypedExpression>;
  readonly diagnostics: AssetValueDiagnostic[];
  readonly pending: EvaluateWork[];
  visited: number;
}

const failed = (diagnostics: readonly AssetValueDiagnostic[]): AssetValueResult<never> =>
  freeze({
    ok: false as const,
    diagnostics: freeze([...diagnostics]),
  });

const succeeded = (value: AssetValue): AssetExpressionEvaluationResult =>
  freeze({ ok: true, value });

const childrenOf = (expression: AssetTypedExpression): readonly AssetTypedExpression[] => {
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

const fits = (actual: AssetExpressionType, expected: AssetExpressionType): boolean =>
  assetTypeCompatible(actual, expected);

const evaluateNumberLeaf = (
  current: Extract<AssetTypedExpression, { readonly kind: 'number' }>,
  diagnostics: AssetValueDiagnostic[],
): AssetValue | null => {
  const value = valueFromExact(current.value);
  if (value === null) {
    const code = exactValueError(current.value) ?? 'asset.value.invalid-type';
    diagnostics.push(
      diagnostic(
        code,
        code === 'asset.value.rational-limit'
          ? 'Numeric node exceeds the exact arithmetic budget.'
          : 'Numeric node is outside the closed value ABI.',
        current.span,
      ),
    );
    return null;
  }
  if (!fits(value.type, current.type)) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-type',
        'Numeric node is outside the closed value ABI.',
        current.span,
      ),
    );
    return null;
  }
  return value;
};

const evaluateNameLeaf = (
  current: Extract<AssetTypedExpression, { readonly kind: 'name' }>,
  environment: AssetExpressionValueEnvironment,
  diagnostics: AssetValueDiagnostic[],
): AssetValue | null => {
  const lookup = lookupAssetValue(environment, current.name);
  if (lookup.status === 'missing') {
    diagnostics.push(
      diagnostic(
        'asset.value.unknown-name',
        'Unknown expression name "' + current.name + '".',
        current.span,
      ),
    );
    return null;
  }
  const value =
    lookup.status === 'bound' && lookup.value !== null ? cloneAssetValue(lookup.value) : null;
  if (value === null || !fits(value.type, current.type)) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-environment',
        'Bound value for "' + current.name + '" does not satisfy its typed name.',
        current.span,
      ),
    );
    return null;
  }
  return value;
};

const evaluateLeaf = (current: AssetTypedExpression, state: EvaluateState): boolean => {
  let value: AssetValue | null;
  if (current.kind === 'number') value = evaluateNumberLeaf(current, state.diagnostics);
  else if (current.kind === 'boolean') {
    if (current.type !== 'bool' || !isBooleanPayload(current.value)) {
      state.diagnostics.push(
        diagnostic(
          'asset.value.invalid-type',
          'Boolean node is outside the closed value ABI.',
          current.span,
        ),
      );
      value = null;
    } else value = assetBooleanValue(current.value);
  } else if (current.kind === 'color') {
    if (current.type !== 'color' || !isAssetColorLiteral(current.value)) {
      state.diagnostics.push(
        diagnostic(
          'asset.value.invalid-type',
          'Color node is outside the closed value ABI.',
          current.span,
        ),
      );
      value = null;
    } else value = assetColorValue(current.value);
  } else if (current.kind === 'name') {
    value = evaluateNameLeaf(current, state.environment, state.diagnostics);
  } else return false;

  if (value !== null) state.values.set(current, value);
  return true;
};

const enterEvaluateNode = (current: AssetTypedExpression, state: EvaluateState): boolean => {
  if (state.active.has(current)) {
    state.diagnostics.push(
      diagnostic(
        'asset.value.expression-cycle',
        'Expression graph contains a cycle.',
        current.span,
      ),
    );
    return false;
  }
  if (evaluateLeaf(current, state)) return true;
  state.active.add(current);
  state.pending.push({ expression: current, exit: true });
  const children = childrenOf(current);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    state.pending.push({ expression: children[index]!, exit: false });
  }
  return true;
};

const evaluateUnaryNode = (
  current: Extract<AssetTypedExpression, { readonly kind: 'unary' }>,
  operand: AssetValue,
  diagnostics: AssetValueDiagnostic[],
): AssetOperationResult<AssetValue> | null => {
  if (operand.kind !== 'number') {
    diagnostics.push(
      diagnostic('asset.value.invalid-operator', 'Unary operators require a number.', current.span),
    );
    return null;
  }
  let exact: AssetExactNumber;
  try {
    exact =
      current.operator === '+'
        ? operand.value
        : assetExactNumber(-operand.value.numerator, operand.value.denominator, operand.value.unit);
  } catch {
    diagnostics.push(
      diagnostic(
        'asset.value.rational-limit',
        'Unary arithmetic exceeds the exact numeric budget.',
        current.span,
      ),
    );
    return null;
  }
  const value = valueFromExact(exact);
  if (value === null) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-type',
        'Unary result is outside the closed value ABI.',
        current.span,
      ),
    );
    return null;
  }
  return succeed(value);
};

const evaluateVectorNode = (
  current: Extract<AssetTypedExpression, { readonly kind: 'vector' }>,
  childValues: readonly AssetValue[],
  diagnostics: AssetValueDiagnostic[],
): AssetOperationResult<AssetValue> | null => {
  if (childValues.some((value) => value.kind !== 'number')) {
    diagnostics.push(
      diagnostic('asset.value.invalid-vector', 'Vector components must be numeric.', current.span),
    );
    return null;
  }
  const info = assetVectorInfo(current.type);
  if (
    info === null ||
    childValues.length !== info.arity ||
    childValues.some((value) => value.kind !== 'number' || value.type !== info.component)
  ) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-vector',
        'Vector node has an unsupported type.',
        current.span,
      ),
    );
    return null;
  }
  try {
    return succeed(assetVectorValue(childValues as AssetNumberValue[], info.type));
  } catch {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-vector',
        'Vector node has an invalid closed value shape.',
        current.span,
      ),
    );
    return null;
  }
};

const evaluateMemberNode = (
  current: Extract<AssetTypedExpression, { readonly kind: 'member' }>,
  object: AssetValue,
  diagnostics: AssetValueDiagnostic[],
): AssetOperationResult<AssetValue> | null => {
  if (object.kind !== 'vector') {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-member',
        'Vector member access requires a vector.',
        current.span,
      ),
    );
    return null;
  }
  const index = current.member === 'x' ? 0 : current.member === 'y' ? 1 : 2;
  const selected = object.values[index];
  if (selected === undefined) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-member',
        'Vector member is outside the value component count.',
        current.span,
      ),
    );
    return null;
  }
  return succeed(selected);
};

const evaluateCompoundNode = (
  current: AssetTypedExpression,
  childValues: readonly AssetValue[],
  diagnostics: AssetValueDiagnostic[],
): AssetOperationResult<AssetValue> | null => {
  if (current.kind === 'unary') return evaluateUnaryNode(current, childValues[0]!, diagnostics);
  if (current.kind === 'vector') return evaluateVectorNode(current, childValues, diagnostics);
  if (current.kind === 'call') return evaluateAssetCall(current.name, childValues);
  if (current.kind === 'member') return evaluateMemberNode(current, childValues[0]!, diagnostics);
  if (current.kind === 'binary') {
    return evaluateAssetBinary(current.operator, childValues[0]!, childValues[1]!);
  }
  diagnostics.push(
    diagnostic('asset.value.invalid-type', 'Expression node cannot be evaluated.', current.span),
  );
  return null;
};

const exitEvaluateNode = (current: AssetTypedExpression, state: EvaluateState): void => {
  state.active.delete(current);
  const childValues = childrenOf(current).map((child) => state.values.get(child));
  if (childValues.some((value) => value === undefined)) return;
  const result = evaluateCompoundNode(current, childValues as AssetValue[], state.diagnostics);
  if (result === null) return;
  if (!result.ok) {
    state.diagnostics.push(diagnostic(result.code, result.message, current.span));
    return;
  }
  if (!fits(result.value.type, current.type)) {
    state.diagnostics.push(
      diagnostic(
        'asset.value.invalid-type',
        'Evaluation result does not satisfy the typed expression.',
        current.span,
      ),
    );
    return;
  }
  state.values.set(current, result.value);
};

/** Evaluate a typed tree with only the exact values supplied by its caller. */
export const evaluateAssetExpression = (
  expression: AssetTypedExpression,
  environment: AssetExpressionValueEnvironment,
): AssetExpressionEvaluationResult => {
  const state: EvaluateState = {
    environment,
    values: new Map(),
    active: new Set(),
    diagnostics: [],
    pending: [{ expression, exit: false }],
    visited: 0,
  };
  while (state.pending.length > 0) {
    const work = state.pending.pop()!;
    const current = work.expression;
    if (!work.exit && ++state.visited > MAX_EXPRESSION_NODES) {
      state.diagnostics.push(
        diagnostic(
          'asset.value.expression-limit',
          'Expression exceeds the compiler node budget.',
          current.span,
        ),
      );
      break;
    }
    if (state.values.has(current)) continue;
    if (work.exit) exitEvaluateNode(current, state);
    else if (!enterEvaluateNode(current, state)) break;
  }
  const result = state.values.get(expression);
  if (state.diagnostics.length > 0) return failed(state.diagnostics);
  if (result === undefined) {
    return failed([
      diagnostic('asset.value.invalid-type', 'Expression could not be evaluated.', expression.span),
    ]);
  }
  return succeeded(result);
};

const isValidBoundary = (boundary: AssetCanonicalNumberBoundary): boolean =>
  boundary !== null &&
  typeof boundary === 'object' &&
  typeof boundary.minimum === 'number' &&
  typeof boundary.maximum === 'number' &&
  typeof boundary.integral === 'boolean' &&
  Number.isFinite(boundary.minimum) &&
  Number.isFinite(boundary.maximum) &&
  boundary.minimum <= boundary.maximum;

const validateCanonicalInput = (
  value: AssetExactNumber,
  boundary: AssetCanonicalNumberBoundary,
  span: SourceSpan,
): AssetCanonicalNumberResult | null => {
  if (
    value === null ||
    typeof value !== 'object' ||
    !isAssetExactNumberInput(value.numerator, value.denominator, value.unit) ||
    !isAssetScalarUnit(value.unit)
  ) {
    return failed([
      diagnostic('asset.value.invalid-number', 'Exact number has an invalid shape or unit.', span),
    ]);
  }
  if (value.denominator <= 0n) {
    return failed([
      diagnostic('asset.value.unsafe-number', 'Exact denominator must be positive.', span),
    ]);
  }
  if (!isAssetExactNumberWithinBudget(value.numerator, value.denominator)) {
    return failed([
      diagnostic('asset.value.rational-limit', 'Exact number exceeds the arithmetic budget.', span),
    ]);
  }
  if (boundary.integral && value.denominator !== 1n) {
    return failed([
      diagnostic(
        'asset.value.unsafe-number',
        'Canonical integer output requires an exact integer.',
        span,
      ),
    ]);
  }
  if (value.numerator > MAX_SAFE || value.numerator < -MAX_SAFE || value.denominator > MAX_SAFE) {
    return failed([
      diagnostic(
        'asset.value.unsafe-number',
        'Exact number exceeds the canonical safe numeric range.',
        span,
      ),
    ]);
  }
  return null;
};

export const toAssetCanonicalNumber = (
  value: AssetExactNumber,
  boundary: AssetCanonicalNumberBoundary,
  span: SourceSpan,
): AssetCanonicalNumberResult => {
  if (!isValidBoundary(boundary)) {
    return failed([
      diagnostic(
        'asset.value.invalid-boundary',
        'Canonical numeric range must be finite and ordered.',
        span,
      ),
    ]);
  }
  const inputError = validateCanonicalInput(value, boundary, span);
  if (inputError !== null) return inputError;
  const result = Number(value.numerator) / Number(value.denominator);
  if (!Number.isFinite(result)) {
    return failed([
      diagnostic('asset.value.non-finite', 'Canonical number conversion must remain finite.', span),
    ]);
  }
  if (boundary.integral && !Number.isSafeInteger(result)) {
    return failed([
      diagnostic(
        'asset.value.unsafe-number',
        'Canonical integer output must be a safe integer.',
        span,
      ),
    ]);
  }
  if (result < boundary.minimum || result > boundary.maximum) {
    return failed([
      diagnostic(
        'asset.value.out-of-range',
        'Canonical number is outside the permitted range.',
        span,
      ),
    ]);
  }
  return freeze({ ok: true, value: result });
};
