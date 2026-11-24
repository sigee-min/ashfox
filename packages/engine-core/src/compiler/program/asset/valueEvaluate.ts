import { freeze } from '../../../immutable';
import type { SourceSpan } from '../../../project/source/contract';
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
  type AssetValue,
  type AssetValueDiagnostic,
  type AssetValueResult,
  type AssetTypedExpression,
  isAssetColorLiteral,
  isAssetExactNumberInput,
  isAssetExactNumberWithinBudget,
  isAssetScalarUnit
} from './value/contract';
import { diagnostic } from './value/diagnostic';
import { succeed, type AssetOperationResult } from './valueArithmetic';
import {
  assetTypeCompatible,
  assetVectorInfo
} from './valueTypes';
import {
  cloneAssetValue,
  exactValueError,
  lookupAssetValue,
  valueFromExact
} from './valueRuntime';
import { evaluateAssetBinary, evaluateAssetCall } from './valueOperation';
const MAX_EXPRESSION_NODES = 16384;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const isBooleanPayload = (value: boolean): boolean => typeof value === 'boolean';

const failed = (
  diagnostics: readonly AssetValueDiagnostic[]
): AssetValueResult<never> => freeze({
  ok: false as const,
  diagnostics: freeze([...diagnostics])
});

const succeeded = (value: AssetValue): AssetExpressionEvaluationResult =>
  freeze({ ok: true, value });

const childrenOf = (expression: AssetTypedExpression): readonly AssetTypedExpression[] => {
  switch (expression.kind) {
    case 'unary': return [expression.operand];
    case 'binary': return [expression.left, expression.right];
    case 'member': return [expression.object];
    case 'vector': return Array.isArray(expression.values) ? expression.values : [];
    case 'call': return Array.isArray(expression.args) ? expression.args : [];
    default: return [];
  }
};

const fits = (
  actual: AssetExpressionType,
  expected: AssetExpressionType
): boolean => assetTypeCompatible(actual, expected);

/** Evaluate a typed tree with only the exact values supplied by its caller. */
export const evaluateAssetExpression = (
  expression: AssetTypedExpression,
  environment: AssetExpressionValueEnvironment
): AssetExpressionEvaluationResult => {
  const values = new Map<AssetTypedExpression, AssetValue>();
  const active = new Set<AssetTypedExpression>();
  const diagnostics: AssetValueDiagnostic[] = [];
  type Work = Readonly<{ readonly expression: AssetTypedExpression; readonly exit: boolean }>;
  const pending: Work[] = [{ expression, exit: false }];
  let visited = 0;
  while (pending.length > 0) {
    const work = pending.pop()!;
    const current = work.expression;
    if (!work.exit && ++visited > MAX_EXPRESSION_NODES) {
      diagnostics.push(diagnostic('asset.value.expression-limit',
        'Expression exceeds the compiler node budget.', current.span));
      break;
    }
    if (values.has(current)) continue;
    if (!work.exit) {
      if (active.has(current)) {
        diagnostics.push(diagnostic('asset.value.expression-cycle',
          'Expression graph contains a cycle.', current.span));
        break;
      }
      if (current.kind === 'number') {
        const value = valueFromExact(current.value);
        if (value === null) {
          const code = exactValueError(current.value) ?? 'asset.value.invalid-type';
          diagnostics.push(diagnostic(code,
            code === 'asset.value.rational-limit'
              ? 'Numeric node exceeds the exact arithmetic budget.'
              : 'Numeric node is outside the closed value ABI.', current.span));
        } else if (!fits(value.type, current.type)) diagnostics.push(diagnostic(
          'asset.value.invalid-type', 'Numeric node is outside the closed value ABI.', current.span));
        else values.set(current, value);
        continue;
      }
      if (current.kind === 'boolean') {
        if (current.type !== 'bool' || !isBooleanPayload(current.value)) diagnostics.push(diagnostic(
          'asset.value.invalid-type', 'Boolean node is outside the closed value ABI.', current.span));
        else values.set(current, assetBooleanValue(current.value));
        continue;
      }
      if (current.kind === 'color') {
        if (current.type !== 'color' || !isAssetColorLiteral(current.value)) diagnostics.push(diagnostic(
          'asset.value.invalid-type', 'Color node is outside the closed value ABI.', current.span));
        else values.set(current, assetColorValue(current.value));
        continue;
      }
      if (current.kind === 'name') {
        const lookup = lookupAssetValue(environment, current.name);
        if (lookup.status === 'missing') diagnostics.push(diagnostic(
          'asset.value.unknown-name', 'Unknown expression name "' + current.name + '".', current.span));
        else {
          const value = lookup.status === 'bound' && lookup.value !== null
            ? cloneAssetValue(lookup.value) : null;
          if (value === null || !fits(value.type, current.type)) diagnostics.push(diagnostic(
            'asset.value.invalid-environment',
            'Bound value for "' + current.name + '" does not satisfy its typed name.', current.span));
          else values.set(current, value);
        }
        continue;
      }
      active.add(current); pending.push({ expression: current, exit: true });
      const children = childrenOf(current);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({ expression: children[index]!, exit: false });
      }
      continue;
    }
    active.delete(current);
    const children = childrenOf(current);
    const childValues = children.map((child) => values.get(child));
    if (childValues.some((value) => value === undefined)) continue;
    let result: AssetOperationResult<AssetValue>;
    if (current.kind === 'unary') {
      const operand = childValues[0]!;
      if (operand.kind !== 'number') {
        diagnostics.push(diagnostic('asset.value.invalid-operator',
          'Unary operators require a number.', current.span));
        continue;
      }
      let exact: AssetExactNumber;
      try {
        exact = current.operator === '+' ? operand.value : assetExactNumber(
          -operand.value.numerator, operand.value.denominator, operand.value.unit);
      } catch {
        diagnostics.push(diagnostic('asset.value.rational-limit',
          'Unary arithmetic exceeds the exact numeric budget.', current.span));
        continue;
      }
      const value = valueFromExact(exact);
      if (value === null) {
        diagnostics.push(diagnostic('asset.value.invalid-type',
          'Unary result is outside the closed value ABI.', current.span));
        continue;
      }
      result = succeed(value);
    } else if (current.kind === 'vector') {
      const numberValues = childValues as AssetValue[];
      if (numberValues.some((value) => value.kind !== 'number')) {
        diagnostics.push(diagnostic('asset.value.invalid-vector',
          'Vector components must be numeric.', current.span));
        continue;
      }
      const info = assetVectorInfo(current.type);
      if (info === null || numberValues.length !== info.arity ||
        numberValues.some((value) => value.kind !== 'number' || value.type !== info.component)) {
        diagnostics.push(diagnostic('asset.value.invalid-vector',
          'Vector node has an unsupported type.', current.span));
        continue;
      }
      try {
        result = succeed(assetVectorValue(numberValues as AssetNumberValue[], info.type));
      } catch {
        diagnostics.push(diagnostic('asset.value.invalid-vector',
          'Vector node has an invalid closed value shape.', current.span));
        continue;
      }
    } else if (current.kind === 'call') {
      result = evaluateAssetCall(current.name, childValues as AssetValue[]);
    } else if (current.kind === 'member') {
      const object = childValues[0]!;
      if (object.kind !== 'vector') {
        diagnostics.push(diagnostic('asset.value.invalid-member',
          'Vector member access requires a vector.', current.span));
        continue;
      }
      const index = current.member === 'x' ? 0 : current.member === 'y' ? 1 : 2;
      const selected = object.values[index];
      if (selected === undefined) {
        diagnostics.push(diagnostic('asset.value.invalid-member',
          'Vector member is outside the value component count.', current.span));
        continue;
      }
      result = succeed(selected);
    } else if (current.kind === 'binary') {
      result = evaluateAssetBinary(
        current.operator, childValues[0]!, childValues[1]!);
    } else {
      diagnostics.push(diagnostic('asset.value.invalid-type',
        'Expression node cannot be evaluated.', current.span));
      continue;
    }
    if (!result.ok) diagnostics.push(diagnostic(result.code, result.message, current.span));
    else if (!fits(result.value.type, current.type)) diagnostics.push(diagnostic(
      'asset.value.invalid-type', 'Evaluation result does not satisfy the typed expression.', current.span));
    else values.set(current, result.value);
  }
  const result = values.get(expression);
  if (diagnostics.length > 0) return failed(diagnostics);
  if (result === undefined) return failed([diagnostic('asset.value.invalid-type',
    'Expression could not be evaluated.', expression.span)]);
  return succeeded(result);
};
export const toAssetCanonicalNumber = (
  value: AssetExactNumber,
  boundary: AssetCanonicalNumberBoundary,
  span: SourceSpan
): AssetCanonicalNumberResult => {
  if (boundary === null || typeof boundary !== 'object' ||
    typeof boundary.minimum !== 'number' || typeof boundary.maximum !== 'number' ||
    typeof boundary.integral !== 'boolean' ||
    !Number.isFinite(boundary.minimum) || !Number.isFinite(boundary.maximum) ||
    boundary.minimum > boundary.maximum) return failed([diagnostic(
    'asset.value.invalid-boundary',
    'Canonical numeric range must be finite and ordered.', span)]);
  if (value === null || typeof value !== 'object' ||
    !isAssetExactNumberInput(value.numerator, value.denominator, value.unit) ||
    !isAssetScalarUnit(value.unit)) return failed([diagnostic(
    'asset.value.invalid-number', 'Exact number has an invalid shape or unit.', span)]);
  if (value.denominator <= 0n) return failed([diagnostic(
    'asset.value.unsafe-number', 'Exact denominator must be positive.', span)]);
  if (!isAssetExactNumberWithinBudget(value.numerator, value.denominator)) return failed([diagnostic(
    'asset.value.rational-limit', 'Exact number exceeds the arithmetic budget.', span)]);
  if (boundary.integral && value.denominator !== 1n) return failed([diagnostic(
    'asset.value.unsafe-number', 'Canonical integer output requires an exact integer.', span)]);
  if (value.numerator > MAX_SAFE || value.numerator < -MAX_SAFE ||
    value.denominator > MAX_SAFE) return failed([diagnostic(
    'asset.value.unsafe-number',
    'Exact number exceeds the canonical safe numeric range.', span)]);
  const result = Number(value.numerator) / Number(value.denominator);
  if (!Number.isFinite(result)) return failed([diagnostic(
    'asset.value.non-finite', 'Canonical number conversion must remain finite.', span)]);
  if (boundary.integral && !Number.isSafeInteger(result)) return failed([diagnostic(
    'asset.value.unsafe-number', 'Canonical integer output must be a safe integer.', span)]);
  if (result < boundary.minimum || result > boundary.maximum) return failed([diagnostic(
    'asset.value.out-of-range', 'Canonical number is outside the permitted range.', span)]);
  return freeze({ ok: true, value: result });
};
