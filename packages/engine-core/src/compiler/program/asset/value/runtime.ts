import {
  assetBooleanValue,
  assetColorValue,
  assetExactNumber,
  assetNumberValue,
  assetVectorValue,
  isAssetColorLiteral,
  isAssetExactNumberInput,
  isAssetExactNumberWithinBudget,
  isAssetNumberValueShape,
  type AssetBooleanValue,
  type AssetColorValue,
  type AssetExactNumber,
  type AssetExpressionValueEnvironment,
  type AssetNumberValue,
  type AssetValue,
  type AssetValueDiagnosticCode,
  type AssetVectorValue,
} from './contract';
import { assetVectorInfo } from './types';

const cloneNumber = (value: AssetNumberValue): AssetValue | null => {
  if (!isAssetNumberValueShape(value)) return null;
  return assetNumberValue(
    assetExactNumber(value.value.numerator, value.value.denominator, value.value.unit),
  );
};

const cloneBoolean = (value: AssetBooleanValue): AssetValue | null =>
  value.type === 'bool' && typeof value.value === 'boolean' ? assetBooleanValue(value.value) : null;

const cloneColor = (value: AssetColorValue): AssetValue | null =>
  value.type === 'color' && isAssetColorLiteral(value.value) ? assetColorValue(value.value) : null;

const cloneVector = (value: AssetVectorValue, seen: Set<AssetValue>): AssetValue | null => {
  const info = assetVectorInfo(value.type);
  if (
    info === null ||
    !Array.isArray(value.values) ||
    value.values.length !== info.arity ||
    seen.has(value)
  )
    return null;
  seen.add(value);
  try {
    const entries: AssetNumberValue[] = [];
    for (const entry of value.values) {
      const cloned = cloneAssetValue(entry, seen);
      if (cloned === null || cloned.kind !== 'number' || cloned.type !== info.component)
        return null;
      entries.push(cloned);
    }
    return assetVectorValue(entries, info.type);
  } finally {
    seen.delete(value);
  }
};

/** Clone only values that satisfy the closed runtime ABI. */
export const cloneAssetValue = (
  value: AssetValue,
  seen = new Set<AssetValue>(),
): AssetValue | null => {
  try {
    if (value === null || typeof value !== 'object') return null;
    switch (value.kind) {
      case 'number':
        return cloneNumber(value);
      case 'boolean':
        return cloneBoolean(value);
      case 'color':
        return cloneColor(value);
      default:
        return cloneVector(value, seen);
    }
  } catch {
    return null;
  }
};

export const valueFromExact = (value: AssetExactNumber): AssetNumberValue | null => {
  try {
    if (
      value === null ||
      typeof value !== 'object' ||
      !isAssetExactNumberInput(value.numerator, value.denominator, value.unit) ||
      value.denominator <= 0n ||
      !isAssetExactNumberWithinBudget(value.numerator, value.denominator) ||
      (value.unit === 'plain' && value.denominator !== 1n)
    )
      return null;
    return assetNumberValue(value);
  } catch {
    return null;
  }
};

export const exactValueError = (value: AssetExactNumber): AssetValueDiagnosticCode | null => {
  if (
    value === null ||
    typeof value !== 'object' ||
    !isAssetExactNumberInput(value.numerator, value.denominator, value.unit) ||
    value.denominator === 0n ||
    value.denominator < 0n
  ) {
    return 'asset.value.invalid-number';
  }
  if (!isAssetExactNumberWithinBudget(value.numerator, value.denominator)) {
    return 'asset.value.rational-limit';
  }
  return value.unit === 'plain' && value.denominator !== 1n ? 'asset.value.invalid-type' : null;
};

export type AssetEnvironmentLookup = Readonly<{
  readonly status: 'missing' | 'invalid' | 'bound';
  readonly value: AssetValue | null;
}>;

export const lookupAssetValue = (
  environment: AssetExpressionValueEnvironment,
  name: string,
): AssetEnvironmentLookup => {
  try {
    if (
      environment === null ||
      typeof environment !== 'object' ||
      typeof environment.has !== 'function' ||
      typeof environment.get !== 'function'
    ) {
      return Object.freeze({ status: 'invalid', value: null });
    }
    if (!environment.has(name)) return Object.freeze({ status: 'missing', value: null });
    const value = environment.get(name);
    return value === undefined
      ? Object.freeze({ status: 'invalid', value: null })
      : Object.freeze({ status: 'bound', value });
  } catch {
    return Object.freeze({ status: 'invalid', value: null });
  }
};
