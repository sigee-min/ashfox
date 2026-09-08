import type { ProgramExpr } from '../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../project/source/contract';
import {
  assetExactNumber,
  AssetValueNumericLimitError,
  isAssetExactNumberInput,
  isAssetExactNumberWithinBudget,
  type AssetExactNumber,
  type AssetExpressionScalarType,
  type AssetExpressionType,
  type AssetScalarValueType,
  type AssetTypedExpression,
  type AssetValueDiagnostic,
  type AssetValueDiagnosticCode
} from './value/contract';
import {
  assetScalarInfo,
  assetTypeCompatible,
  assetVectorComponent,
  assetVectorInfo,
  assetVectorType,
  type AssetTypeInfo
} from './valueTypes';

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

const scalarNode = (
  node: AssetTypedExpression
): AssetExpressionScalarType | null => assetScalarInfo(node.type)?.type ?? null;

type ScalarInfo = Extract<AssetTypeInfo, { readonly kind: 'scalar' }>;

const scalarPair = (
  left: AssetTypedExpression,
  right: AssetTypedExpression
): Readonly<{ readonly left: ScalarInfo; readonly right: ScalarInfo }> | null => {
  const leftInfo = assetScalarInfo(left.type);
  const rightInfo = assetScalarInfo(right.type);
  return leftInfo !== null && rightInfo !== null
    ? freeze({ left: leftInfo, right: rightInfo }) : null;
};

export const numberNode = (
  expression: Extract<ProgramExpr, { readonly kind: 'number' }>,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[]
): AssetTypedExpression | null => {
  if (!isAssetExactNumberInput(expression.numerator, expression.denominator, expression.unit)) {
    diagnostics.push(diagnostic('asset.value.invalid-number',
      'Numeric literal has an invalid exact shape or unit.', expression.span));
    return null;
  }
  if (expression.denominator === 0n) {
    diagnostics.push(diagnostic('asset.value.invalid-number',
      'Numeric denominator cannot be zero.', expression.span));
    return null;
  }
  if (!isAssetExactNumberWithinBudget(expression.numerator, expression.denominator)) {
    diagnostics.push(diagnostic('asset.value.rational-limit',
      'Numeric literal exceeds the exact arithmetic budget.', expression.span));
    return null;
  }
  let value: AssetExactNumber;
  try {
    value = assetExactNumber(expression.numerator,
      expression.denominator, expression.unit);
  } catch (error) {
    diagnostics.push(diagnostic(error instanceof AssetValueNumericLimitError
      ? 'asset.value.rational-limit' : 'asset.value.invalid-number',
    error instanceof AssetValueNumericLimitError
      ? 'Numeric literal exceeds the exact arithmetic budget.'
      : 'Numeric literal has an invalid exact shape or unit.', expression.span));
    return null;
  }
  let type: AssetExpressionScalarType = value.unit === 'plain'
    ? value.denominator === 1n ? 'integer' : 'plain' : value.unit;
  const expectedInfo = expected === undefined ? null : assetScalarInfo(expected);
  if (expected !== undefined && expectedInfo === null) {
    diagnostics.push(diagnostic('asset.value.type-mismatch',
      'A scalar literal cannot satisfy a vector or aggregate type.', expression.span));
    return null;
  }
  if (expectedInfo !== null) {
    if (value.unit === 'plain' && expression.rawUnit === '' && expectedInfo.unit !== 'plain') {
      value = assetExactNumber(value.numerator, value.denominator, expectedInfo.unit);
      type = expectedInfo.type;
    } else if (value.unit === expectedInfo.unit &&
      (!expectedInfo.integral || value.denominator === 1n)) {
      type = expectedInfo.type;
    } else {
      diagnostics.push(diagnostic('asset.value.unit-mismatch',
        'Numeric literal unit does not satisfy expected type "' + expected + '".', expression.span));
      return null;
    }
  }
  return freeze({ kind: 'number', type, value, span: immutableSpan(expression.span) });
};

export const typedVector = (
  expression: ProgramExpr,
  children: readonly AssetTypedExpression[],
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[]
): AssetTypedExpression | null => {
  if (children.length !== 2 && children.length !== 3 && children.length !== 4) {
    diagnostics.push(diagnostic('asset.value.invalid-vector',
      'Vectors require exactly two, three, or four components.', expression.span));
    return null;
  }
  const components = children.map(scalarNode);
  if (components.some((component) => component === null)) {
    diagnostics.push(diagnostic('asset.value.invalid-vector',
      'Vector components must be numeric with one shared unit.', expression.span));
    return null;
  }
  const component = assetVectorComponent(components as AssetExpressionScalarType[]);
  const type = component === null || component === 'plain' ? null :
    assetVectorType(children.length, component);
  if (type === null) {
    diagnostics.push(diagnostic('asset.value.invalid-vector',
      'Only a four-component texel vector may have four components.', expression.span));
    return null;
  }
  if (!fitsExpected(type, expected, expression.span, diagnostics)) return null;
  return freeze({
    kind: 'vector', type, values: freeze([...children]), span: immutableSpan(expression.span)
  });
};

export const typedCall = (
  expression: Extract<ProgramExpr, { readonly kind: 'call' }>,
  children: readonly AssetTypedExpression[],
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[]
): AssetTypedExpression | null => {
  const relation = expression.name;
  if (relation === 'texels' || relation === 'mirror_x' || relation === 'mirror_y' ||
      relation === 'mirror_z' || relation === 'box_origin') {
    const inputs = relation === 'texels' ? ['unit', 'integer'] : relation === 'box_origin'
      ? ['vec3<unit>', 'vec3<unit>', 'vec3<ratio>'] : ['vec3<unit>', 'unit'];
    const type = relation === 'texels' ? 'texel' : 'vec3<unit>';
    if (children.length !== inputs.length || children.some((child, index) => child.type !== inputs[index])) {
      diagnostics.push(diagnostic('asset.value.invalid-call',
        relation + ' requires (' + inputs.join(', ') + ').', expression.span));
      return null;
    }
    if (!fitsExpected(type, expected, expression.span, diagnostics)) return null;
    return freeze({ kind: 'call', name: relation, args: freeze([...children]), type,
      span: immutableSpan(expression.span) });
  }
  if (expression.name !== 'vec2' && expression.name !== 'vec3' && expression.name !== 'abs' &&
    expression.name !== 'min' && expression.name !== 'max' && expression.name !== 'clamp') {
    diagnostics.push(diagnostic('asset.value.unknown-call',
      'Unknown expression function "' + expression.name + '".', expression.span));
    return null;
  }
  const arity = expression.name === 'vec2' ? 2 : expression.name === 'vec3' ? 3 : null;
  if (arity !== null) {
    if (children.length !== arity) {
      diagnostics.push(diagnostic('asset.value.invalid-call',
        expression.name + ' requires exactly ' + arity + ' arguments.', expression.span));
      return null;
    }
    const components = children.map(scalarNode);
    const component = components.some((entry) => entry === null) ? null :
      assetVectorComponent(components as AssetExpressionScalarType[]);
    const type = component === null || component === 'plain' ? null :
      assetVectorType(arity, component);
    if (type === null) {
      diagnostics.push(diagnostic('asset.value.invalid-vector',
        'Vector arguments must be numeric with one shared unit.', expression.span));
      return null;
    }
    if (!fitsExpected(type, expected, expression.span, diagnostics)) return null;
    return freeze({ kind: 'call', name: expression.name, args: freeze([...children]), type, span: immutableSpan(expression.span) });
  }
  const validCount = expression.name === 'abs' ? children.length === 1 :
    expression.name === 'clamp' ? children.length === 3 : children.length >= 1;
  if (!validCount) {
    diagnostics.push(diagnostic('asset.value.invalid-call',
      expression.name + ' received an invalid argument count.', expression.span));
    return null;
  }
  const components = children.map(scalarNode);
  const first = components[0];
  if (first === undefined || first === null || components.some((entry) => entry === null) ||
    children.some((child) => assetScalarInfo(child.type)?.unit !== assetScalarInfo(children[0]!.type)?.unit)) {
    diagnostics.push(diagnostic('asset.value.unit-mismatch',
      expression.name + ' arguments must use one shared numeric unit.', expression.span));
    return null;
  }
  if (!fitsExpected(first, expected, expression.span, diagnostics)) return null;
  return freeze({ kind: 'call', name: expression.name, args: freeze([...children]), type: first, span: immutableSpan(expression.span) });
};

export const typedMember = (
  expression: Extract<ProgramExpr, { readonly kind: 'member' }>,
  object: AssetTypedExpression,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[]
): AssetTypedExpression | null => {
  const info = assetVectorInfo(object.type);
  if (info === null) {
    diagnostics.push(diagnostic('asset.value.invalid-member',
      'Vector member access requires a vector value.', expression.span));
    return null;
  }
  const index = expression.member === 'x' ? 0 : expression.member === 'y' ? 1 : 2;
  if (index >= info.arity) {
    diagnostics.push(diagnostic('asset.value.invalid-member',
      'Vector member is outside the value component count.', expression.span));
    return null;
  }
  if (info.component === 'plain') {
    diagnostics.push(diagnostic('asset.value.invalid-member',
      'Vector member access requires a closed vector type.', expression.span));
    return null;
  }
  const type: AssetScalarValueType = info.component;
  if (!fitsExpected(type, expected, expression.span, diagnostics)) return null;
  return freeze({ kind: 'member', object, member: expression.member, type, span: immutableSpan(expression.span) });
};

export const typedBinary = (
  expression: Extract<ProgramExpr, { readonly kind: 'binary' }>,
  left: AssetTypedExpression,
  right: AssetTypedExpression,
  expected: AssetExpressionType | undefined,
  diagnostics: AssetValueDiagnostic[]
): AssetTypedExpression | null => {
  const operator = expression.operator;
  const comparison = operator === '==' || operator === '!=' || operator === '<' ||
    operator === '<=' || operator === '>' || operator === '>=';
  if (comparison) {
    const pair = scalarPair(left, right);
    const equality = operator === '==' || operator === '!=';
    const comparable = pair !== null ? pair.left.unit === pair.right.unit :
      equality && (left.type === right.type || assetTypeCompatible(left.type, right.type) ||
        assetTypeCompatible(right.type, left.type));
    if (!comparable || (!equality && pair === null)) {
      diagnostics.push(diagnostic('asset.value.type-mismatch',
        'Comparison operands must have compatible numeric or equality types.', expression.span));
      return null;
    }
    if (!fitsExpected('bool', expected, expression.span, diagnostics)) return null;
    return freeze({ kind: 'binary', operator, left, right, type: 'bool', span: immutableSpan(expression.span) });
  }
  const leftVector = assetVectorInfo(left.type);
  const rightVector = assetVectorInfo(right.type);
  if ((operator === '+' || operator === '-') && leftVector !== null && rightVector !== null) {
    if (leftVector.component === 'plain' || rightVector.component === 'plain' ||
      leftVector.arity !== rightVector.arity || leftVector.component !== rightVector.component) {
      diagnostics.push(diagnostic('asset.value.unit-mismatch',
        'Vector operands must have the same shape and unit.', expression.span));
      return null;
    }
    const type = assetVectorType(leftVector.arity, leftVector.component);
    if (type === null || !fitsExpected(type, expected, expression.span, diagnostics)) return null;
    return freeze({ kind: 'binary', operator, left, right, type, span: immutableSpan(expression.span) });
  }
  if (operator === '*' || operator === '/') {
    const vector = leftVector ?? rightVector;
    const scalar = leftVector !== null ? assetScalarInfo(right.type) :
      rightVector !== null ? assetScalarInfo(left.type) : null;
    const vectorOnLeft = leftVector !== null;
    if (vector !== null) {
      if (vector.component === 'plain' || scalar === null || scalar.unit !== 'plain' ||
        (operator === '/' && !vectorOnLeft)) {
        diagnostics.push(diagnostic('asset.value.invalid-operator',
          'Vector scaling requires a plain scalar operand.', expression.span));
        return null;
      }
      if (!fitsExpected(vector.type, expected, expression.span, diagnostics)) return null;
      return freeze({ kind: 'binary', operator, left, right, type: vector.type, span: immutableSpan(expression.span) });
    }
  }
  const pair = scalarPair(left, right);
  if (pair === null || (operator !== '+' && operator !== '-' && operator !== '*' &&
    operator !== '/' && operator !== '%')) {
    diagnostics.push(diagnostic('asset.value.invalid-operator',
      'Operator "' + operator + '" is not valid for these operand types.', expression.span));
    return null;
  }
  const { left: l, right: r } = pair;
  let type: AssetExpressionScalarType;
  if (operator === '+' || operator === '-') {
    if (l.unit !== r.unit) {
      diagnostics.push(diagnostic('asset.value.unit-mismatch',
        'Arithmetic operands must use compatible units.', expression.span));
      return null;
    }
    type = l.unit === 'plain' && l.integral && r.integral ? 'integer' : l.unit;
  } else if (operator === '*') {
    if (l.unit !== 'plain' && r.unit !== 'plain') {
      diagnostics.push(diagnostic('asset.value.invalid-operator',
        'Multiplication may have at most one dimensional operand.', expression.span));
      return null;
    }
    type = l.unit === 'plain' ? r.type : l.type;
  } else if (operator === '/') {
    if (r.unit !== 'plain' && l.unit !== r.unit) {
      diagnostics.push(diagnostic('asset.value.unit-mismatch',
        'Division requires a plain divisor or matching units.', expression.span));
      return null;
    }
    if (r.unit === l.unit) {
      const leftNumber = left.kind === 'number' ? left.value : null;
      const rightNumber = right.kind === 'number' ? right.value : null;
      if (leftNumber === null || rightNumber === null || rightNumber.numerator === 0n) {
        diagnostics.push(diagnostic('asset.value.invalid-type',
          'A plain division result requires an exact integral result or dimensional context.', expression.span));
        return null;
      }
      const exact = assetExactNumber(leftNumber.numerator * rightNumber.denominator,
        leftNumber.denominator * rightNumber.numerator, 'plain');
      if (exact.denominator !== 1n) {
        diagnostics.push(diagnostic('asset.value.invalid-type',
          'A plain division result must be an exact integer.', expression.span));
        return null;
      }
      type = 'integer';
    } else type = l.type;
  } else {
    if (l.unit !== 'plain' || r.unit !== 'plain' || !l.integral || !r.integral) {
      diagnostics.push(diagnostic('asset.value.invalid-operator',
        'Remainder requires exact integer plain operands.', expression.span));
      return null;
    }
    type = 'integer';
  }
  if (!fitsExpected(type, expected, expression.span, diagnostics)) return null;
  return freeze({ kind: 'binary', operator, left, right, type, span: immutableSpan(expression.span) });
};
