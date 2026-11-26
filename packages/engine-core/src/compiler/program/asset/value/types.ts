import { freeze } from '../../../../immutable';
import type { ProgramUnit } from '../../../../project/program/syntax/contract';
import {
  type AssetExpressionScalarType,
  type AssetExpressionType,
  type AssetScalarUnit,
  type AssetVectorComponentType,
  type AssetVectorValueType,
} from './contract';

export type AssetTypeInfo =
  | Readonly<{
      readonly kind: 'scalar';
      readonly unit: AssetScalarUnit;
      readonly integral: boolean;
      readonly type: AssetExpressionScalarType;
    }>
  | Readonly<{
      readonly kind: 'vector';
      readonly arity: 2 | 3 | 4;
      readonly component: AssetVectorComponentType | 'plain';
      readonly type: AssetVectorValueType;
    }>
  | Readonly<{ readonly kind: 'bool' | 'color'; readonly type: 'bool' | 'color' }>;

const vectorEntry = (
  type: AssetVectorValueType,
  arity: 2 | 3 | 4,
  component: AssetVectorComponentType,
): readonly [AssetVectorValueType, AssetTypeInfo] => [
  type,
  freeze({ kind: 'vector', arity, component, type }),
];

const VECTOR_INFO: ReadonlyMap<AssetVectorValueType, AssetTypeInfo> = new Map([
  vectorEntry('vec2<unit>', 2, 'unit'),
  vectorEntry('vec2<texel>', 2, 'texel'),
  vectorEntry('vec3<unit>', 3, 'unit'),
  vectorEntry('vec3<degree>', 3, 'degree'),
  vectorEntry('vec3<ratio>', 3, 'ratio'),
  vectorEntry('texel_rect', 4, 'texel'),
]);

export const describeAssetType = (type: AssetExpressionType): AssetTypeInfo | null => {
  if (type === 'bool' || type === 'color') return freeze({ kind: type, type });
  const vector = VECTOR_INFO.get(type as AssetVectorValueType);
  if (vector !== undefined) return vector;
  if (type === 'integer') return freeze({ kind: 'scalar', unit: 'plain', integral: true, type });
  if (type === 'plain') return freeze({ kind: 'scalar', unit: 'plain', integral: false, type });
  const units: readonly ProgramUnit[] = ['unit', 'texel', 'degree', 'second', 'ratio'];
  if (!units.includes(type as ProgramUnit)) return null;
  const unit = type as AssetScalarUnit;
  return freeze({ kind: 'scalar', unit, integral: false, type: unit });
};

export const isAssetExpressionType = (type: AssetExpressionType): boolean =>
  describeAssetType(type) !== null;

export const assetVectorType = (
  arity: number,
  component: AssetVectorComponentType,
): AssetVectorValueType | null => {
  for (const [type, info] of VECTOR_INFO) {
    if (info.kind === 'vector' && info.arity === arity && info.component === component) {
      return type;
    }
  }
  return null;
};

export const assetTypeCompatible = (
  actual: AssetExpressionType,
  expected: AssetExpressionType,
): boolean => {
  if (actual === expected || (expected === 'plain' && actual === 'integer')) return true;
  const left = describeAssetType(actual);
  const right = describeAssetType(expected);
  return (
    left?.kind === 'vector' &&
    right?.kind === 'vector' &&
    left.arity === right.arity &&
    left.component === right.component
  );
};

export const assetVectorComponent = (
  values: readonly AssetExpressionScalarType[],
): AssetVectorComponentType | 'plain' | null => {
  if (values.length === 0) return null;
  const first = describeAssetType(values[0]!);
  if (first?.kind !== 'scalar') return null;
  const componentUnit = first.unit;
  if (first.unit === 'plain') return null;
  const vectorUnit = (unit: AssetScalarUnit): unit is AssetVectorComponentType =>
    unit === 'unit' || unit === 'texel' || unit === 'degree' || unit === 'ratio';
  if (!vectorUnit(first.unit)) return null;
  let component: AssetVectorComponentType = first.unit;
  for (const type of values.slice(1)) {
    const info = describeAssetType(type);
    if (
      info?.kind !== 'scalar' ||
      !vectorUnit(info.unit) ||
      info.unit !== componentUnit ||
      info.type === 'integer' ||
      info.type === 'plain'
    )
      return null;
    component = info.unit;
  }
  return component;
};

export const assetVectorInfo = (
  type: AssetExpressionType,
): Extract<AssetTypeInfo, { readonly kind: 'vector' }> | null => {
  const info = describeAssetType(type);
  return info?.kind === 'vector' ? info : null;
};

export const assetScalarInfo = (
  type: AssetExpressionType,
): Extract<AssetTypeInfo, { readonly kind: 'scalar' }> | null => {
  const info = describeAssetType(type);
  return info?.kind === 'scalar' ? info : null;
};
