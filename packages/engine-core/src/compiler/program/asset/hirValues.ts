import { freeze } from '../../../immutable';
import type { ProgramExpr } from '../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../project/source/contract';
import type { AssetValueType } from '../../../project/program/asset/contract';
import {
  assetExactNumber,
  type AssetExpressionTypeEnvironment,
  type AssetExpressionValueEnvironment,
  type AssetExpectedType,
  type AssetValue,
  type AssetTypedExpression,
  type AssetValueDiagnostic,
} from './value/contract';
import { compileAssetExpression } from './value/compile';
import { evaluateAssetExpression } from './value/evaluate';
import type { AssetExactUnitVector } from './frame';

export type HirIssue = (
  path: string,
  span: SourceSpan,
  code: string,
  message: string,
  hint?: string,
) => void;

const report = (
  path: string,
  diagnostics: readonly AssetValueDiagnostic[],
  issue: HirIssue,
): void => {
  for (const item of diagnostics) issue(path, item.span, item.code, item.message);
};

export const compileHirExpression = (
  expression: ProgramExpr,
  expected: AssetExpectedType,
  environment: AssetExpressionTypeEnvironment,
  path: string,
  issue: HirIssue,
): AssetTypedExpression | null => {
  const result = compileAssetExpression(expression, environment, expected);
  if (!result.ok) {
    report(path, result.diagnostics, issue);
    return null;
  }
  return result.value;
};

export const evaluateHirExpression = (
  expression: AssetTypedExpression,
  environment: AssetExpressionValueEnvironment,
  path: string,
  issue: HirIssue,
): AssetValue | null => {
  const result = evaluateAssetExpression(expression, environment);
  if (!result.ok) {
    report(path, result.diagnostics, issue);
    return null;
  }
  return result.value;
};

export const compileAndEvaluateHirExpression = (
  expression: ProgramExpr,
  expected: AssetValueType,
  types: AssetExpressionTypeEnvironment,
  values: AssetExpressionValueEnvironment,
  path: string,
  issue: HirIssue,
): AssetValue | null => {
  const typed = compileHirExpression(expression, expected, types, path, issue);
  return typed === null ? null : evaluateHirExpression(typed, values, path, issue);
};

export const exactUnitVector = (value: AssetValue): AssetExactUnitVector | null => {
  if (value.kind !== 'vector' || value.type !== 'vec3<unit>' || value.values.length !== 3) {
    return null;
  }
  if (value.values.some((entry) => entry.type !== 'unit')) return null;
  return freeze([
    value.values[0]!.value,
    value.values[1]!.value,
    value.values[2]!.value,
  ]) as AssetExactUnitVector;
};

export const exactZeroUnitVector = (): AssetExactUnitVector =>
  freeze([
    assetExactNumber(0n, 1n, 'unit'),
    assetExactNumber(0n, 1n, 'unit'),
    assetExactNumber(0n, 1n, 'unit'),
  ]) as AssetExactUnitVector;
