import { freeze } from '../../../../immutable';
import type { ProgramExpr } from '../../../../project/program/syntax/contract';
import {
  assetExactNumber,
  AssetValueNumericLimitError,
  isAssetExactNumberInput,
  isAssetExactNumberWithinBudget,
  type AssetExactNumber,
  type AssetExpressionScalarType,
  type AssetExpressionType,
  type AssetScalarValueType,
  type AssetTypedCallExpression,
  type AssetTypedExpression,
  type AssetValueDiagnostic,
} from './contract';
import { diagnostic, fitsExpected, immutableSpan } from './diagnostic';
import { assetScalarInfo, assetVectorComponent, assetVectorInfo, assetVectorType } from './types';

type NumberExpr = Extract<ProgramExpr, { readonly kind: 'number' }>;
type CallExpr = Extract<ProgramExpr, { readonly kind: 'call' }>;
type MemberExpr = Extract<ProgramExpr, { readonly kind: 'member' }>;
type RelationName = 'texels' | 'mirror_x' | 'mirror_y' | 'mirror_z' | 'box_origin';

interface RelationSignature {
  readonly inputs: readonly AssetExpressionType[];
  readonly type: AssetExpressionType;
}

const RELATION_SIGNATURES: ReadonlyMap<RelationName, RelationSignature> = new Map([
  ['texels', { inputs: ['unit', 'integer'], type: 'texel' }],
  ['mirror_x', { inputs: ['vec3<unit>', 'unit'], type: 'vec3<unit>' }],
  ['mirror_y', { inputs: ['vec3<unit>', 'unit'], type: 'vec3<unit>' }],
  ['mirror_z', { inputs: ['vec3<unit>', 'unit'], type: 'vec3<unit>' }],
  ['box_origin', { inputs: ['vec3<unit>', 'vec3<unit>', 'vec3<ratio>'], type: 'vec3<unit>' }],
]);

const NUMERIC_CALLS: ReadonlySet<string> = new Set(['abs', 'min', 'max', 'clamp']);

const scalarNode = (node: AssetTypedExpression): AssetExpressionScalarType | null =>
  assetScalarInfo(node.type)?.type ?? null;

const validateNumberLiteral = (
  expression: NumberExpr,
  diagnostics: AssetValueDiagnostic[],
): AssetExactNumber | null => {
  if (!isAssetExactNumberInput(expression.numerator, expression.denominator, expression.unit)) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-number',
        'Numeric literal has an invalid exact shape or unit.',
        expression.span,
      ),
    );
    return null;
  }
  if (expression.denominator === 0n) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-number',
        'Numeric denominator cannot be zero.',
        expression.span,
      ),
    );
    return null;
  }
  if (!isAssetExactNumberWithinBudget(expression.numerator, expression.denominator)) {
    diagnostics.push(
      diagnostic(
        'asset.value.rational-limit',
        'Numeric literal exceeds the exact arithmetic budget.',
        expression.span,
      ),
    );
    return null;
  }
  try {
    return assetExactNumber(expression.numerator, expression.denominator, expression.unit);
  } catch (error) {
    const limited = error instanceof AssetValueNumericLimitError;
    diagnostics.push(
      diagnostic(
        limited ? 'asset.value.rational-limit' : 'asset.value.invalid-number',
        limited
          ? 'Numeric literal exceeds the exact arithmetic budget.'
          : 'Numeric literal has an invalid exact shape or unit.',
        expression.span,
      ),
    );
    return null;
  }
};

const resolveNumberType = (
  expression: NumberExpr,
  initial: AssetExactNumber,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): Readonly<{
  readonly value: AssetExactNumber;
  readonly type: AssetExpressionScalarType;
}> | null => {
  const defaultType: AssetExpressionScalarType =
    initial.unit === 'plain' ? (initial.denominator === 1n ? 'integer' : 'plain') : initial.unit;
  if (expected === undefined) return { value: initial, type: defaultType };
  const expectedInfo = assetScalarInfo(expected);
  if (expectedInfo === null) {
    diagnostics.push(
      diagnostic(
        'asset.value.type-mismatch',
        'A scalar literal cannot satisfy a vector or aggregate type.',
        expression.span,
      ),
    );
    return null;
  }
  if (initial.unit === 'plain' && expression.rawUnit === '' && expectedInfo.unit !== 'plain') {
    return {
      value: assetExactNumber(initial.numerator, initial.denominator, expectedInfo.unit),
      type: expectedInfo.type,
    };
  }
  if (
    initial.unit === expectedInfo.unit &&
    (!expectedInfo.integral || initial.denominator === 1n)
  ) {
    return { value: initial, type: expectedInfo.type };
  }
  diagnostics.push(
    diagnostic(
      'asset.value.unit-mismatch',
      'Numeric literal unit does not satisfy expected type "' + expected + '".',
      expression.span,
    ),
  );
  return null;
};

export const numberNode = (
  expression: NumberExpr,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  const validated = validateNumberLiteral(expression, diagnostics);
  if (validated === null) return null;
  const resolved = resolveNumberType(expression, validated, expected, diagnostics);
  if (resolved === null) return null;
  return freeze({
    kind: 'number',
    type: resolved.type,
    value: resolved.value,
    span: immutableSpan(expression.span),
  });
};

export const typedVector = (
  expression: ProgramExpr,
  children: readonly AssetTypedExpression[],
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  if (children.length !== 2 && children.length !== 3 && children.length !== 4) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-vector',
        'Vectors require exactly two, three, or four components.',
        expression.span,
      ),
    );
    return null;
  }
  const components = children.map(scalarNode);
  if (components.some((component) => component === null)) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-vector',
        'Vector components must be numeric with one shared unit.',
        expression.span,
      ),
    );
    return null;
  }
  const component = assetVectorComponent(components as AssetExpressionScalarType[]);
  const type =
    component === null || component === 'plain'
      ? null
      : assetVectorType(children.length, component);
  if (type === null) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-vector',
        'Only a four-component texel vector may have four components.',
        expression.span,
      ),
    );
    return null;
  }
  if (!fitsExpected(type, expected, expression.span, diagnostics)) return null;
  return freeze({
    kind: 'vector',
    type,
    values: freeze([...children]),
    span: immutableSpan(expression.span),
  });
};

const typedRelationCall = (
  expression: CallExpr,
  relation: RelationName,
  signature: RelationSignature,
  children: readonly AssetTypedExpression[],
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  const { inputs, type } = signature;
  if (
    children.length !== inputs.length ||
    children.some((child, index) => child.type !== inputs[index])
  ) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-call',
        relation + ' requires (' + inputs.join(', ') + ').',
        expression.span,
      ),
    );
    return null;
  }
  if (!fitsExpected(type, expected, expression.span, diagnostics)) return null;
  return freeze({
    kind: 'call',
    name: relation,
    args: freeze([...children]),
    type,
    span: immutableSpan(expression.span),
  });
};

const typedVectorCall = (
  expression: CallExpr,
  name: 'vec2' | 'vec3',
  arity: 2 | 3,
  children: readonly AssetTypedExpression[],
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  if (children.length !== arity) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-call',
        expression.name + ' requires exactly ' + arity + ' arguments.',
        expression.span,
      ),
    );
    return null;
  }
  const components = children.map(scalarNode);
  const component = components.some((entry) => entry === null)
    ? null
    : assetVectorComponent(components as AssetExpressionScalarType[]);
  const type =
    component === null || component === 'plain' ? null : assetVectorType(arity, component);
  if (type === null) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-vector',
        'Vector arguments must be numeric with one shared unit.',
        expression.span,
      ),
    );
    return null;
  }
  if (!fitsExpected(type, expected, expression.span, diagnostics)) return null;
  return freeze({
    kind: 'call',
    name,
    args: freeze([...children]),
    type,
    span: immutableSpan(expression.span),
  });
};

const hasValidNumericCallArity = (name: string, count: number): boolean => {
  if (name === 'abs') return count === 1;
  if (name === 'clamp') return count === 3;
  return count >= 1;
};

const typedNumericCall = (
  expression: CallExpr,
  name: Extract<AssetTypedCallExpression['name'], 'abs' | 'min' | 'max' | 'clamp'>,
  children: readonly AssetTypedExpression[],
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  if (!hasValidNumericCallArity(name, children.length)) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-call',
        name + ' received an invalid argument count.',
        expression.span,
      ),
    );
    return null;
  }
  const first = scalarNode(children[0]!);
  const firstUnit = assetScalarInfo(children[0]!.type)?.unit;
  const mismatched =
    first === null ||
    children.some((child) => scalarNode(child) === null) ||
    children.some((child) => assetScalarInfo(child.type)?.unit !== firstUnit);
  if (mismatched) {
    diagnostics.push(
      diagnostic(
        'asset.value.unit-mismatch',
        name + ' arguments must use one shared numeric unit.',
        expression.span,
      ),
    );
    return null;
  }
  if (!fitsExpected(first, expected, expression.span, diagnostics)) return null;
  return freeze({
    kind: 'call',
    name,
    args: freeze([...children]),
    type: first,
    span: immutableSpan(expression.span),
  });
};

export const typedCall = (
  expression: CallExpr,
  children: readonly AssetTypedExpression[],
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  const signature = RELATION_SIGNATURES.get(expression.name as RelationName);
  if (signature !== undefined) {
    return typedRelationCall(
      expression,
      expression.name as RelationName,
      signature,
      children,
      expected,
      diagnostics,
    );
  }
  if (expression.name === 'vec2' || expression.name === 'vec3') {
    const arity = expression.name === 'vec2' ? 2 : 3;
    return typedVectorCall(expression, expression.name, arity, children, expected, diagnostics);
  }
  if (NUMERIC_CALLS.has(expression.name)) {
    return typedNumericCall(
      expression,
      expression.name as 'abs' | 'min' | 'max' | 'clamp',
      children,
      expected,
      diagnostics,
    );
  }
  diagnostics.push(
    diagnostic(
      'asset.value.unknown-call',
      'Unknown expression function "' + expression.name + '".',
      expression.span,
    ),
  );
  return null;
};

export const typedMember = (
  expression: MemberExpr,
  object: AssetTypedExpression,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[],
): AssetTypedExpression | null => {
  const info = assetVectorInfo(object.type);
  if (info === null) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-member',
        'Vector member access requires a vector value.',
        expression.span,
      ),
    );
    return null;
  }
  const index = expression.member === 'x' ? 0 : expression.member === 'y' ? 1 : 2;
  if (index >= info.arity) {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-member',
        'Vector member is outside the value component count.',
        expression.span,
      ),
    );
    return null;
  }
  if (info.component === 'plain') {
    diagnostics.push(
      diagnostic(
        'asset.value.invalid-member',
        'Vector member access requires a closed vector type.',
        expression.span,
      ),
    );
    return null;
  }
  const type: AssetScalarValueType = info.component;
  if (!fitsExpected(type, expected, expression.span, diagnostics)) return null;
  return freeze({
    kind: 'member',
    object,
    member: expression.member,
    type,
    span: immutableSpan(expression.span),
  });
};
