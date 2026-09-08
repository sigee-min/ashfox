import type {
  ProgramBinaryOperator,
  ProgramUnit
} from '../../../../project/program/syntax/contract';
import type { AssetValueType as ContractAssetValueType } from '../../../../project/program/asset/contract';
import type { SourceSpan } from '../../../../project/source/contract';

/**
 * The asset compiler keeps source numbers exact until the canonical product
 * boundary.  `plain` is an intermediate dimension used while an expression
 * is being inferred; `integer` is the closed ABI type for an integral plain
 * number.
 */
export type AssetScalarUnit = ProgramUnit;
export type AssetScalarValueType = Extract<ContractAssetValueType,
  'unit' | 'texel' | 'degree' | 'second' | 'ratio' | 'integer'>;
export type AssetVectorComponentType = Extract<ContractAssetValueType,
  'unit' | 'texel' | 'degree' | 'ratio'>;
/** Plain is private expression metadata; it is not a HIR/AssetValue ABI type. */
export type AssetExpressionScalarType = AssetScalarValueType | 'plain';

export type AssetVectorValueType = Extract<ContractAssetValueType,
  | 'vec2<unit>'
  | 'vec3<unit>'
  | 'vec3<degree>'
  | 'vec3<ratio>'
  | 'vec2<texel>'
  | 'texel-rect'>;

/** Closed compiler expression types. */
export type AssetExpressionType = ContractAssetValueType | 'plain';

/** A source-facing root expectation is always a closed HIR value type. */
export type AssetExpectedType = ContractAssetValueType;

export interface AssetExactNumber {
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly unit: AssetScalarUnit;
}

/** Exact arithmetic is bounded before any target-side number conversion. */
export const ASSET_EXACT_INTEGER_BITS = 512;

export class AssetValueNumericLimitError extends Error {
  constructor() {
    super('Exact numeric value exceeds the asset arithmetic budget.');
    this.name = 'AssetValueNumericLimitError';
  }
}

export const assetIntegerBits = (value: bigint): number => {
  if (typeof value !== 'bigint') return ASSET_EXACT_INTEGER_BITS + 1;
  const absolute = value < 0n ? -value : value;
  if (absolute >= (1n << BigInt(ASSET_EXACT_INTEGER_BITS))) {
    return ASSET_EXACT_INTEGER_BITS + 1;
  }
  return absolute === 0n ? 1 : absolute.toString(2).length;
};

export const isAssetScalarUnit = (value: AssetScalarUnit): boolean =>
  value === 'plain' || value === 'unit' || value === 'texel' ||
  value === 'degree' || value === 'second' || value === 'ratio';

export const isAssetExactNumberInput = (
  numerator: bigint,
  denominator: bigint,
  unit: AssetScalarUnit
): boolean => typeof numerator === 'bigint' && typeof denominator === 'bigint' &&
  isAssetScalarUnit(unit);

export const isAssetExactNumberWithinBudget = (
  numerator: bigint,
  denominator: bigint
): boolean => typeof numerator === 'bigint' && typeof denominator === 'bigint' &&
  assetIntegerBits(numerator) <= ASSET_EXACT_INTEGER_BITS &&
  assetIntegerBits(denominator) <= ASSET_EXACT_INTEGER_BITS;

export interface AssetNumberValue {
  readonly kind: 'number';
  readonly type: AssetScalarValueType;
  readonly value: AssetExactNumber;
}

export interface AssetBooleanValue {
  readonly kind: 'boolean';
  readonly type: 'bool';
  readonly value: boolean;
}

export interface AssetColorValue {
  readonly kind: 'color';
  readonly type: 'color';
  readonly value: string;
}

export interface AssetVectorValue {
  readonly kind: 'vector';
  readonly type: AssetVectorValueType;
  readonly values: readonly AssetNumberValue[];
}

export interface AssetVectorDescriptor {
  readonly arity: 2 | 3 | 4;
  readonly component: AssetVectorComponentType;
}

export const assetVectorDescriptor = (
  type: AssetVectorValueType
): AssetVectorDescriptor | null => {
  if (type === 'vec2<unit>') return Object.freeze({ arity: 2, component: 'unit' });
  if (type === 'vec2<texel>') return Object.freeze({ arity: 2, component: 'texel' });
  if (type === 'vec3<unit>') return Object.freeze({ arity: 3, component: 'unit' });
  if (type === 'vec3<degree>') return Object.freeze({ arity: 3, component: 'degree' });
  if (type === 'vec3<ratio>') return Object.freeze({ arity: 3, component: 'ratio' });
  if (type === 'texel-rect') return Object.freeze({ arity: 4, component: 'texel' });
  return null;
};

export const isAssetColorLiteral = (value: string): boolean =>
  typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);

export const isAssetNumberValueShape = (
  value: AssetNumberValue
): boolean => {
  if (value === null || typeof value !== 'object' || value.kind !== 'number' ||
    value.value === null || typeof value.value !== 'object') return false;
  const exact = value.value;
  if (!isAssetExactNumberInput(exact.numerator, exact.denominator, exact.unit) ||
    exact.denominator <= 0n || !isAssetExactNumberWithinBudget(
      exact.numerator, exact.denominator)) return false;
  const expected = exact.unit === 'plain' ? 'integer' : exact.unit;
  return value.type === expected &&
    (exact.unit !== 'plain' || exact.denominator === 1n);
};

export type AssetValue = AssetNumberValue | AssetBooleanValue |
  AssetColorValue | AssetVectorValue;

export interface AssetTypedExpressionBase {
  readonly span: SourceSpan;
  readonly type: AssetExpressionType;
}

export interface AssetTypedNumberExpression extends AssetTypedExpressionBase {
  readonly kind: 'number';
  readonly type: AssetExpressionScalarType;
  readonly value: AssetExactNumber;
}

export interface AssetTypedBooleanExpression extends AssetTypedExpressionBase {
  readonly kind: 'boolean';
  readonly type: 'bool';
  readonly value: boolean;
}

export interface AssetTypedColorExpression extends AssetTypedExpressionBase {
  readonly kind: 'color';
  readonly type: 'color';
  readonly value: string;
}

export interface AssetTypedNameExpression extends AssetTypedExpressionBase {
  readonly kind: 'name';
  readonly name: string;
}

export interface AssetTypedUnaryExpression extends AssetTypedExpressionBase {
  readonly kind: 'unary';
  readonly operator: '+' | '-';
  readonly operand: AssetTypedExpression;
}

export interface AssetTypedBinaryExpression extends AssetTypedExpressionBase {
  readonly kind: 'binary';
  readonly operator: ProgramBinaryOperator;
  readonly left: AssetTypedExpression;
  readonly right: AssetTypedExpression;
}

export interface AssetTypedVectorExpression extends AssetTypedExpressionBase {
  readonly kind: 'vector';
  readonly values: readonly AssetTypedExpression[];
}

export interface AssetTypedCallExpression extends AssetTypedExpressionBase {
  readonly kind: 'call';
  readonly name: 'vec2' | 'vec3' | 'abs' | 'min' | 'max' | 'clamp' |
    'texels' | 'mirror_x' | 'mirror_y' | 'mirror_z' | 'box_origin';
  readonly args: readonly AssetTypedExpression[];
}

export interface AssetTypedMemberExpression extends AssetTypedExpressionBase {
  readonly kind: 'member';
  readonly object: AssetTypedExpression;
  readonly member: 'x' | 'y' | 'z';
}

export type AssetTypedExpression = AssetTypedNumberExpression |
  AssetTypedBooleanExpression | AssetTypedColorExpression |
  AssetTypedNameExpression | AssetTypedUnaryExpression |
  AssetTypedBinaryExpression | AssetTypedVectorExpression |
  AssetTypedCallExpression | AssetTypedMemberExpression;

export type AssetExpressionTypeEnvironment = ReadonlyMap<
  string,
  AssetExpressionType
>;

export type AssetExpressionValueEnvironment = ReadonlyMap<string, AssetValue>;

export type AssetValueDiagnosticCode =
  | 'asset.value.invalid-number'
  | 'asset.value.invalid-vector'
  | 'asset.value.invalid-type'
  | 'asset.value.type-mismatch'
  | 'asset.value.unit-mismatch'
  | 'asset.value.unknown-name'
  | 'asset.value.unknown-call'
  | 'asset.value.invalid-call'
  | 'asset.value.invalid-operator'
  | 'asset.value.invalid-member'
  | 'asset.value.division-by-zero'
  | 'asset.value.unsafe-number'
  | 'asset.value.expression-limit'
  | 'asset.value.expression-cycle'
  | 'asset.value.invalid-environment'
  | 'asset.value.invalid-boundary'
  | 'asset.value.out-of-range'
  | 'asset.value.rational-limit'
  | 'asset.value.non-finite';

export interface AssetValueDiagnostic {
  readonly code: AssetValueDiagnosticCode;
  readonly message: string;
  readonly span: SourceSpan;
}

export type AssetValueResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{
      readonly ok: false;
      readonly diagnostics: readonly AssetValueDiagnostic[];
    }>;

export type AssetExpressionCompileResult = AssetValueResult<AssetTypedExpression>;
export type AssetExpressionEvaluationResult = AssetValueResult<AssetValue>;
export type AssetCanonicalNumberResult = AssetValueResult<number>;

/** The only permitted exact-to-JavaScript-number boundary. */
export interface AssetCanonicalNumberBoundary {
  readonly minimum: number;
  readonly maximum: number;
  /** Integral boundaries require an exact safe integer result. */
  readonly integral: boolean;
}

/** Construct a normalized, immutable exact number. */
export const assetExactNumber = (
  numerator: bigint,
  denominator: bigint,
  unit: AssetScalarUnit
): AssetExactNumber => {
  if (!isAssetExactNumberInput(numerator, denominator, unit)) {
    throw new Error('Exact number has an invalid numeric shape or unit.');
  }
  if (denominator === 0n) throw new Error('Exact number denominator cannot be zero.');
  if (!isAssetExactNumberWithinBudget(numerator, denominator)) {
    throw new AssetValueNumericLimitError();
  }
  const positiveDenominator = denominator < 0n ? -denominator : denominator;
  const signedNumerator = denominator < 0n ? -numerator : numerator;
  let left = signedNumerator < 0n ? -signedNumerator : signedNumerator;
  let right = positiveDenominator;
  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  const divisor = left === 0n ? 1n : left;
  return Object.freeze({
    numerator: signedNumerator / divisor,
    denominator: positiveDenominator / divisor,
    unit
  });
};

export const assetNumberValue = (value: AssetExactNumber): AssetNumberValue => {
  if (value === null || typeof value !== 'object' ||
    !isAssetExactNumberInput(value.numerator, value.denominator, value.unit) ||
    value.denominator <= 0n || !isAssetExactNumberWithinBudget(
      value.numerator, value.denominator)) {
    throw new Error('Number value has an invalid exact numeric shape.');
  }
  if (value.unit === 'plain' && value.denominator !== 1n) {
    throw new Error('Non-integral plain numbers are expression-only values.');
  }
  const type: AssetScalarValueType = value.unit === 'plain' ? 'integer' : value.unit;
  return Object.freeze({
    kind: 'number',
    type,
    value: Object.freeze({
      numerator: value.numerator,
      denominator: value.denominator,
      unit: value.unit
    })
  });
};

export const assetBooleanValue = (value: boolean): AssetBooleanValue =>
  typeof value === 'boolean' ? Object.freeze({ kind: 'boolean', type: 'bool', value }) :
    (() => { throw new Error('Boolean value has an invalid shape.'); })();

export const assetColorValue = (value: string): AssetColorValue =>
  isAssetColorLiteral(value) ? Object.freeze({ kind: 'color', type: 'color', value }) :
    (() => { throw new Error('Color value has an invalid shape.'); })();

export const assetVectorValue = (
  values: readonly AssetNumberValue[],
  type: AssetVectorValueType
): AssetVectorValue => {
  const info = assetVectorDescriptor(type);
  if (info === null || !Array.isArray(values) || values.length !== info.arity) {
    throw new Error('Vector value has an invalid shape.');
  }
  const entries: AssetNumberValue[] = [];
  for (const entry of values) {
    if (!isAssetNumberValueShape(entry) || entry.type !== info.component) {
      throw new Error('Vector value has an invalid component.');
    }
    entries.push(assetNumberValue(assetExactNumber(
      entry.value.numerator, entry.value.denominator, entry.value.unit)));
  }
  return Object.freeze({
    kind: 'vector',
    type,
    values: Object.freeze(entries)
  });
};
