import type { SourceSpan } from '../../../project/source/contract';
import { freeze } from '../../../immutable';
import type { Vec3 } from '../../../model/identity';
import { sha256Digest } from '../../../provenance/digest';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import {
  isAssetNumberValueShape,
  type AssetExactNumber,
  type AssetNumberValue,
  type AssetVectorValue,
} from './value/contract';
import { toAssetCanonicalNumber } from './value/evaluate';
import type { InstantiatedMotionKey } from './ir';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
export const MAX_MOTION_FPS = 240;
export const MAX_MOTION_FRAMES = 300;

export type CanonicalBoundary = Readonly<{ minimum: number; maximum: number; integral: boolean }>;

export const NUMBER_BOUNDARY: CanonicalBoundary = Object.freeze({
  minimum: -MAX_SAFE,
  maximum: MAX_SAFE,
  integral: false,
});

export const INTEGER_BOUNDARY: CanonicalBoundary = Object.freeze({
  minimum: 1,
  maximum: MAX_MOTION_FPS,
  integral: true,
});

export interface Location {
  readonly path: string;
  readonly span: SourceSpan;
}

const diagnostic = (location: Location, code: string, message: string): AssetDiagnostic =>
  freeze({
    severity: 'error',
    code,
    message,
    path: location.path,
    span: location.span,
  });

export const hashId = (kind: string, nominalKey: string): string =>
  `${kind}:${sha256Digest(nominalKey)}`;

export const vector = (x: number, y: number, z: number): Vec3 => freeze([x, y, z]);

export const exactValue = (value: AssetNumberValue): AssetExactNumber | null => {
  try {
    return isAssetNumberValueShape(value) ? value.value : null;
  } catch {
    return null;
  }
};

export const exactCompare = (
  left: AssetExactNumber,
  right: AssetExactNumber,
): -1 | 0 | 1 | null => {
  if (left.unit !== right.unit || left.denominator <= 0n || right.denominator <= 0n) return null;
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  if (difference < 0n) return -1;
  return difference > 0n ? 1 : 0;
};

export const addIssue = (
  diagnostics: AssetDiagnostic[],
  location: Location,
  code: string,
  message: string,
): void => {
  if (diagnostics.length < 256) diagnostics.push(diagnostic(location, code, message));
};

const isExactUnitNumber = (
  value: AssetNumberValue,
  unit: 'plain' | 'unit' | 'second' | 'degree' | 'ratio',
): boolean =>
  value !== null &&
  typeof value === 'object' &&
  value.kind === 'number' &&
  value.type === (unit === 'plain' ? 'integer' : unit) &&
  isAssetNumberValueShape(value) &&
  value.value.unit === unit;

export const canonicalNumber = (
  value: AssetNumberValue,
  unit: 'plain' | 'unit' | 'second' | 'degree' | 'ratio',
  boundary: CanonicalBoundary,
  location: Location,
  diagnostics: AssetDiagnostic[],
): number | null => {
  if (!isExactUnitNumber(value, unit)) {
    addIssue(
      diagnostics,
      location,
      'asset.canonical-number',
      `Canonical output requires an exact ${unit} number.`,
    );
    return null;
  }
  const result = toAssetCanonicalNumber(value.value, boundary, location.span);
  if (!result.ok) {
    for (const item of result.diagnostics) addIssue(diagnostics, location, item.code, item.message);
    return null;
  }
  return result.value === 0 ? 0 : result.value;
};

export const registerId = (
  seen: Map<string, string>,
  id: string,
  owner: string,
  location: Location,
  kind: string,
  diagnostics: AssetDiagnostic[],
): boolean => {
  const previous = seen.get(id);
  if (previous === undefined) {
    seen.set(id, owner);
    return true;
  }
  if (previous === owner) {
    addIssue(
      diagnostics,
      location,
      `asset.duplicate-${kind}-id`,
      `Duplicate ${kind} identifier "${id}".`,
    );
  } else {
    addIssue(
      diagnostics,
      location,
      `asset.${kind}-id-collision`,
      `Hash collision for ${kind} identifier "${id}".`,
    );
  }
  return false;
};

const vectorComponents = (
  value: AssetVectorValue,
  type: 'vec3<unit>' | 'vec3<degree>' | 'vec3<ratio>',
): readonly AssetNumberValue[] | null => {
  try {
    if (
      value === null ||
      typeof value !== 'object' ||
      value.kind !== 'vector' ||
      value.type !== type ||
      !Array.isArray(value.values) ||
      value.values.length !== 3 ||
      !value.values.every(isAssetNumberValueShape)
    ) {
      return null;
    }
    return value.values;
  } catch {
    return null;
  }
};

const CHANNEL_UNITS = { position: 'unit', rotation: 'degree', scale: 'ratio' } as const;

export const keyVector = (
  key: InstantiatedMotionKey,
  property: 'position' | 'rotation' | 'scale',
  location: Location,
  diagnostics: AssetDiagnostic[],
): readonly [number, number, number] | null => {
  const unit = CHANNEL_UNITS[property];
  const type = `vec3<${unit}>` as const;
  const components = vectorComponents(key.value, type);
  if (components === null) {
    addIssue(
      diagnostics,
      location,
      'asset.motion-value',
      `Motion ${property} keys require a three-component ${type} value.`,
    );
    return null;
  }
  const values = components.map((c) =>
    canonicalNumber(c, unit, NUMBER_BOUNDARY, location, diagnostics),
  );
  if (values.some((v): v is null => v === null)) return null;
  const numeric = [values[0]!, values[1]!, values[2]!] as const;
  if (property === 'scale' && numeric.some((v) => v <= 0)) {
    addIssue(
      diagnostics,
      location,
      'asset.motion-scale',
      'Motion scale keys require strictly positive ratio components.',
    );
    return null;
  }
  return vector(numeric[0], numeric[1], numeric[2]);
};
