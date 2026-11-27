import { freeze } from '../../../../immutable';
import type {
  ProgramBinaryOperator,
  ProgramExpr,
} from '../../../../project/program/syntax/contract';
import {
  assetExactNumber,
  type AssetExpressionScalarType,
  type AssetExpressionType,
  type AssetTypedExpression,
  type AssetValueDiagnostic,
} from './contract';
import { diagnostic, fitsExpected, immutableSpan } from './diagnostic';
import {
  assetScalarInfo,
  assetTypeCompatible,
  assetVectorInfo,
  assetVectorType,
  type AssetTypeInfo,
} from './types';

type ScalarInfo = Extract<AssetTypeInfo, { readonly kind: 'scalar' }>;
type VectorInfo = Extract<AssetTypeInfo, { readonly kind: 'vector' }>;
type BinaryExpr = Extract<ProgramExpr, { readonly kind: 'binary' }>;

const COMPARISON_OPERATORS: ReadonlySet<ProgramBinaryOperator> = new Set([
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
]);

const ARITHMETIC_OPERATORS: ReadonlySet<ProgramBinaryOperator> = new Set(['+', '-', '*', '/', '%']);

const scalarPair = (
  left: AssetTypedExpression,
  right: AssetTypedExpression,
): Readonly<{ readonly left: ScalarInfo; readonly right: ScalarInfo }> | null => {
  const leftInfo = assetScalarInfo(left.type);
  const rightInfo = assetScalarInfo(right.type);
  return leftInfo !== null && rightInfo !== null
    ? freeze({ left: leftInfo, right: rightInfo })
    : null;
};

const typedComparison = (
  expression: BinaryExpr,
  left: AssetTypedExpression,
  right: AssetTypedExpression,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  const operator = expression.operator;
  const pair = scalarPair(left, right);
  const equality = operator === '==' || operator === '!=';
  const equalityCompatible =
    equality &&
    (left.type === right.type ||
      assetTypeCompatible(left.type, right.type) ||
      assetTypeCompatible(right.type, left.type));
  const comparable = pair !== null ? pair.left.unit === pair.right.unit : equalityCompatible;
  if (!comparable || (!equality && pair === null)) {
    diagnostics.push(
      diagnostic(
        'asset.value.type-mismatch',
        'Comparison operands must have compatible numeric or equality types.',
        expression.span,
      ),
    );
    return null;
  }
  if (!fitsExpected('bool', expected, expression.span, diagnostics)) return null;
  return freeze({
    kind: 'binary',
    operator,
    left,
    right,
    type: 'bool',
    span: immutableSpan(expression.span),
  });
};

const typedVectorPair = (
  expression: BinaryExpr,
  left: AssetTypedExpression,
  right: AssetTypedExpression,
  leftVector: VectorInfo,
  rightVector: VectorInfo,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  if (
    leftVector.component === 'plain' ||
    rightVector.component === 'plain' ||
    leftVector.arity !== rightVector.arity ||
    leftVector.component !== rightVector.component
  ) {
    diagnostics.push(
      diagnostic(
        'asset.value.unit-mismatch',
        'Vector operands must have the same shape and unit.',
        expression.span,
      ),
    );
    return null;
  }
  const type = assetVectorType(leftVector.arity, leftVector.component);
  if (type === null || !fitsExpected(type, expected, expression.span, diagnostics)) return null;
  return freeze({
    kind: 'binary',
    operator: expression.operator,
    left,
    right,
    type,
    span: immutableSpan(expression.span),
  });
};

const typedVectorScale = (
  expression: BinaryExpr,
  left: AssetTypedExpression,
  right: AssetTypedExpression,
  leftVector: VectorInfo | null,
  rightVector: VectorInfo | null,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  const vector = leftVector ?? rightVector!;
  const scalar = leftVector !== null ? assetScalarInfo(right.type) : assetScalarInfo(left.type);
  if (
    vector.component === 'plain' ||
    scalar === null ||
    (scalar.unit !== 'plain' && scalar.unit !== 'ratio') ||
    (expression.operator === '/' && leftVector === null)
  ) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-operator',
        'Vector scaling requires a plain or ratio scalar operand.',
        expression.span,
      ),
    );
    return null;
  }
  if (!fitsExpected(vector.type, expected, expression.span, diagnostics)) return null;
  return freeze({
    kind: 'binary',
    operator: expression.operator,
    left,
    right,
    type: vector.type,
    span: immutableSpan(expression.span),
  });
};

const typedScalarDivision = (
  expression: BinaryExpr,
  left: AssetTypedExpression,
  right: AssetTypedExpression,
  l: ScalarInfo,
  r: ScalarInfo,
  diagnostics: AssetValueDiagnostic[],
): AssetExpressionScalarType | null => {
  if (r.unit !== 'plain' && r.unit !== 'ratio' && l.unit !== r.unit) {
    diagnostics.push(
      diagnostic(
        'asset.value.unit-mismatch',
        'Division requires a plain divisor or matching units.',
        expression.span,
      ),
    );
    return null;
  }
  if (l.unit === 'plain' && r.unit === 'ratio') return 'ratio';
  if (r.unit !== l.unit || l.unit === 'ratio') return l.type;
  const leftNumber = left.kind === 'number' ? left.value : null;
  const rightNumber = right.kind === 'number' ? right.value : null;
  if (leftNumber === null || rightNumber === null || rightNumber.numerator === 0n) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-type',
        'A plain division result requires an exact integral result or dimensional context.',
        expression.span,
      ),
    );
    return null;
  }
  const exact = assetExactNumber(
    leftNumber.numerator * rightNumber.denominator,
    leftNumber.denominator * rightNumber.numerator,
    'plain',
  );
  if (exact.denominator !== 1n) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-type',
        'A plain division result must be an exact integer.',
        expression.span,
      ),
    );
    return null;
  }
  return 'integer';
};

const typedScalarAddSub = (
  span: BinaryExpr['span'],
  l: ScalarInfo,
  r: ScalarInfo,
  diagnostics: AssetValueDiagnostic[],
): AssetExpressionScalarType | null => {
  if (l.unit !== r.unit) {
    diagnostics.push(
      diagnostic(
        'asset.value.unit-mismatch',
        'Arithmetic operands must use compatible units.',
        span,
      ),
    );
    return null;
  }
  return l.unit === 'plain' && l.integral && r.integral ? 'integer' : l.unit;
};

const typedScalarProduct = (
  span: BinaryExpr['span'],
  l: ScalarInfo,
  r: ScalarInfo,
  diagnostics: AssetValueDiagnostic[],
): AssetExpressionScalarType | null => {
  const lDim = l.unit !== 'plain' && l.unit !== 'ratio';
  const rDim = r.unit !== 'plain' && r.unit !== 'ratio';
  if (lDim && rDim) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-operator',
        'Multiplication may have at most one dimensional operand.',
        span,
      ),
    );
    return null;
  }
  if (l.unit === 'plain') return r.type;
  if (r.unit === 'plain') return l.type;
  return l.unit === 'ratio' ? r.type : l.type;
};

const resolveScalarBinaryType = (
  expression: BinaryExpr,
  left: AssetTypedExpression,
  right: AssetTypedExpression,
  l: ScalarInfo,
  r: ScalarInfo,
  diagnostics: AssetValueDiagnostic[],
): AssetExpressionScalarType | null => {
  const operator = expression.operator;
  if (operator === '+' || operator === '-') {
    return typedScalarAddSub(expression.span, l, r, diagnostics);
  }
  if (operator === '*') return typedScalarProduct(expression.span, l, r, diagnostics);
  if (operator === '/') return typedScalarDivision(expression, left, right, l, r, diagnostics);
  if (l.unit !== 'plain' || r.unit !== 'plain' || !l.integral || !r.integral) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-operator',
        'Remainder requires exact integer plain operands.',
        expression.span,
      ),
    );
    return null;
  }
  return 'integer';
};

const typedScalarArithmetic = (
  expression: BinaryExpr,
  left: AssetTypedExpression,
  right: AssetTypedExpression,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  const pair = scalarPair(left, right);
  if (pair === null || !ARITHMETIC_OPERATORS.has(expression.operator)) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-operator',
        'Operator "' + expression.operator + '" is not valid for these operand types.',
        expression.span,
      ),
    );
    return null;
  }
  const type = resolveScalarBinaryType(expression, left, right, pair.left, pair.right, diagnostics);
  if (type === null || !fitsExpected(type, expected, expression.span, diagnostics)) return null;
  return freeze({
    kind: 'binary',
    operator: expression.operator,
    left,
    right,
    type,
    span: immutableSpan(expression.span),
  });
};

export const typedBinary = (
  expression: BinaryExpr,
  left: AssetTypedExpression,
  right: AssetTypedExpression,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  const operator = expression.operator;
  if (COMPARISON_OPERATORS.has(operator)) {
    return typedComparison(expression, left, right, expected, diagnostics);
  }
  const leftVector = assetVectorInfo(left.type);
  const rightVector = assetVectorInfo(right.type);
  if ((operator === '+' || operator === '-') && leftVector !== null && rightVector !== null) {
    return typedVectorPair(expression, left, right, leftVector, rightVector, expected, diagnostics);
  }
  if ((operator === '*' || operator === '/') && (leftVector !== null || rightVector !== null)) {
    return typedVectorScale(
      expression,
      left,
      right,
      leftVector,
      rightVector,
      expected,
      diagnostics,
    );
  }
  return typedScalarArithmetic(expression, left, right, expected, diagnostics);
};
