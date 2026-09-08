import type { SourceSpan } from '../../../project/source/contract';
import type { UvRect, Vec2, Vec3 } from '../../../model/identity';
import type { Transform } from '../../../model/scene';
import type {
  InstantiatedAssetIr,
  InstantiatedComponentInstance,
  InstantiatedGeometryNode
} from './ir';
import type { AssetTextureChartPlan, AssetTexturePlan } from './texture/contract';
import {
  assetExactNumber,
  isAssetNumberValueShape,
  type AssetExactNumber,
  type AssetValue,
  type AssetVectorValue
} from './value/contract';
import { toAssetCanonicalNumber } from './valueEvaluate';

export const MAX_SAFE = Number.MAX_SAFE_INTEGER;
export const NUMBER_BOUNDARY = Object.freeze({
  minimum: -MAX_SAFE, maximum: MAX_SAFE, integral: false
});
export const INTEGER_BOUNDARY = Object.freeze({
  minimum: -MAX_SAFE, maximum: MAX_SAFE, integral: true
});
export const CUBE_FACES = ['north', 'south', 'east', 'west', 'up', 'down'] as const;

export const freeze = <T>(value: T): T => Object.freeze(value);
export const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export type CanonicalGeometryIssue = (
  path: string,
  span: SourceSpan,
  code: string,
  message: string
) => void;

export interface Context {
  readonly issue: CanonicalGeometryIssue;
  failed: boolean;
}

export interface PropertyEntry {
  readonly value: AssetValue;
  readonly span: SourceSpan;
}

export interface GeometryRecord {
  readonly node: InstantiatedGeometryNode;
  readonly instance: InstantiatedComponentInstance;
  readonly parentNodeId: string | null;
}

export interface SurfacePlan {
  readonly plan: AssetTexturePlan;
  readonly chart: AssetTextureChartPlan;
  readonly material: 'opaque' | 'cutout' | 'double';
}

export const report = (
  context: Context,
  path: string,
  span: SourceSpan,
  code: string,
  message: string
): void => {
  context.failed = true;
  context.issue(path, span, code, message);
};

export const propertyMap = (
  node: InstantiatedGeometryNode,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  context: Context
): ReadonlyMap<string, PropertyEntry> => {
  const result = new Map<string, PropertyEntry>();
  for (const property of node.properties) {
    if (!allowed.has(property.name)) {
      report(context, node.sourcePath, property.span, 'asset.invalid-geometry-property',
        `Property "${property.name}" is not allowed on a ${node.kind}.`);
      continue;
    }
    if (result.has(property.name)) {
      report(context, node.sourcePath, property.span, 'asset.duplicate-geometry-property',
        `Geometry property "${property.name}" is declared more than once.`);
      continue;
    }
    result.set(property.name, { value: property.value, span: property.span });
  }
  for (const name of required) if (!result.has(name)) {
    report(context, node.sourcePath, node.span, 'asset.missing-geometry-property',
      `A ${node.kind} requires an explicit "${name}" property.`);
  }
  return result;
};

export const exactNumber = (
  entry: PropertyEntry | undefined,
  unit: AssetExactNumber['unit'],
  context: Context,
  path: string,
  ownerSpan: SourceSpan
): AssetExactNumber | null => {
  if (entry === undefined || entry.value.kind !== 'number' ||
      !isAssetNumberValueShape(entry.value) || entry.value.value.unit !== unit ||
      entry.value.type !== (unit === 'plain' ? 'integer' : unit)) {
    report(context, path, entry?.span ?? ownerSpan, 'asset.geometry-value',
      `Geometry value must be an exact ${unit} number.`);
    return null;
  }
  return entry.value.value;
};

export const exactVector = (
  entry: PropertyEntry | undefined,
  type: AssetVectorValue['type'],
  context: Context,
  path: string,
  ownerSpan: SourceSpan
): readonly AssetExactNumber[] | null => {
  if (entry === undefined || entry.value.kind !== 'vector' ||
      entry.value.type !== type || !Array.isArray(entry.value.values)) {
    report(context, path, entry?.span ?? ownerSpan, 'asset.geometry-value',
      `Geometry value must be an exact ${type} vector.`);
    return null;
  }
  const expected = type === 'vec2<unit>' || type === 'vec2<texel>' ? 2 :
    type === 'texel-rect' ? 4 : 3;
  if (entry.value.values.length !== expected ||
      !entry.value.values.every((value) => isAssetNumberValueShape(value))) {
    report(context, path, entry.span, 'asset.geometry-value',
      `Geometry value must be an exact ${type} vector.`);
    return null;
  }
  const unit = type === 'vec2<texel>' || type === 'texel-rect' ? 'texel' :
    type === 'vec3<degree>' ? 'degree' : type === 'vec3<ratio>' ? 'ratio' : 'unit';
  if (entry.value.values.some((value) => value.value.unit !== unit ||
      value.type !== unit)) {
    report(context, path, entry.span, 'asset.geometry-value',
      `Geometry vector components must use ${unit}.`);
    return null;
  }
  return entry.value.values.map((value) => value.value);
};

export const canonical = (
  value: AssetExactNumber,
  boundary: Readonly<{ readonly minimum: number; readonly maximum: number; readonly integral: boolean }>,
  context: Context,
  path: string,
  span: SourceSpan
): number | null => {
  const result = toAssetCanonicalNumber(value, boundary, span);
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) report(context, path, diagnostic.span,
      diagnostic.code, diagnostic.message);
    return null;
  }
  return result.value === 0 ? 0 : result.value;
};

export const vector3 = (values: readonly [number, number, number]): Vec3 =>
  freeze([values[0], values[1], values[2]]);
export const vector2 = (values: readonly [number, number]): Vec2 =>
  freeze([values[0], values[1]]);
export const zero = (): Vec3 => vector3([0, 0, 0]);

export const exactToVector3 = (
  entries: readonly AssetExactNumber[],
  boundary: Readonly<{ readonly minimum: number; readonly maximum: number; readonly integral: boolean }>,
  context: Context,
  path: string,
  span: SourceSpan
): Vec3 | null => {
  if (entries.length !== 3) return null;
  const values = entries.map((entry) => canonical(entry, boundary, context, path, span));
  return values.some((value): value is null => value === null) ? null :
    vector3([values[0]!, values[1]!, values[2]!]);
};

export const exactToVector2 = (
  entries: readonly AssetExactNumber[],
  boundary: Readonly<{ readonly minimum: number; readonly maximum: number; readonly integral: boolean }>,
  context: Context,
  path: string,
  span: SourceSpan
): Vec2 | null => {
  if (entries.length !== 2) return null;
  const values = entries.map((entry) => canonical(entry, boundary, context, path, span));
  return values.some((value): value is null => value === null) ? null :
    vector2([values[0]!, values[1]!]);
};

export const boolean = (
  entry: PropertyEntry | undefined,
  fallback: boolean,
  context: Context,
  path: string
): boolean | null => {
  if (entry === undefined) return fallback;
  if (entry.value.kind !== 'boolean' || entry.value.type !== 'bool' ||
      typeof entry.value.value !== 'boolean') {
    report(context, path, entry.span, 'asset.geometry-value', 'Geometry value must be boolean.');
    return null;
  }
  return entry.value.value;
};

export const transformFor = (
  properties: ReadonlyMap<string, PropertyEntry>,
  context: Context,
  path: string,
  ownerSpan: SourceSpan,
  allowPivot: boolean,
  positionFallback: Vec3 = zero()
): Transform | null => {
  const readOptional = (
    name: string,
    type: AssetVectorValue['type'],
    fallback: Vec3
  ): Vec3 | null => {
    const entry = properties.get(name);
    if (entry === undefined) return fallback;
    const exact = exactVector(entry, type, context, path, ownerSpan);
    return exact === null ? null : exactToVector3(exact, NUMBER_BOUNDARY,
      context, path, entry.span);
  };
  const position = readOptional('position', 'vec3<unit>', positionFallback);
  const rotation = readOptional('rotation', 'vec3<degree>', zero());
  const pivot = allowPivot ? readOptional('pivot', 'vec3<unit>', zero()) : zero();
  if (position === null || rotation === null || pivot === null) return null;
  return { position, rotation, scale: vector3([1, 1, 1]), pivot };
};

export const visibleFor = (
  properties: ReadonlyMap<string, PropertyEntry>,
  context: Context,
  node: InstantiatedGeometryNode
): boolean => boolean(properties.get('visible'), true, context, node.sourcePath) ?? false;

export const addExact = (left: AssetExactNumber, right: AssetExactNumber): AssetExactNumber =>
  assetExactNumber(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
    left.unit
  );

export const positiveIntegral = (entries: readonly AssetExactNumber[]): boolean =>
  entries.every((entry) => entry.denominator === 1n && entry.numerator > 0n && entry.unit !== 'plain');

export const cubeUv = (
  origin: readonly [number, number],
  size: readonly [number, number, number]
): Readonly<Record<(typeof CUBE_FACES)[number], UvRect>> => {
  const [x, y, z] = size;
  const [ox, oy] = origin;
  const rect = (left: number, top: number, width: number, height: number): UvRect =>
    freeze([ox + left, oy + top, ox + left + width, oy + top + height]);
  return freeze({
    west: rect(0, z, z, y), north: rect(z, z, x, y),
    east: rect(z + x, z, z, y), south: rect(z + x + z, z, x, y),
    up: rect(z, 0, x, z), down: rect(z + x, 0, x, z)
  });
};

export const directionOf = (node: InstantiatedGeometryNode): string => {
  const index = node.id.lastIndexOf('/');
  return index < 0 ? node.id : node.id.slice(index + 1);
};

export const surfacePlan = (
  node: InstantiatedGeometryNode,
  ir: InstantiatedAssetIr,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context,
  layout: 'box' | 'flat'
): SurfacePlan | null => {
  const surface = node.surface;
  if (surface === null) {
    report(context, node.sourcePath, node.span, 'asset.geometry-surface',
      `${node.kind} requires one concrete surface chart binding.`);
    return null;
  }
  const bindings = ir.surfaces.filter((candidate) => candidate.surface.key === surface.surface.key);
  const binding = bindings[0];
  const plan = plans.get(surface.surface.key);
  const chart = plan?.charts[surface.chart];
  if (bindings.length !== 1 || binding === undefined || plan === undefined || chart === undefined ||
      plan.surfaceSymbol.key !== surface.surface.key) {
    report(context, node.sourcePath, surface.span, 'asset.geometry-surface',
      bindings.length > 1 ? `Surface "${surface.surface.key}" is bound more than once.` :
        `Surface "${surface.surface.key}" and chart "${surface.chart}" must be materialized.`);
    return null;
  }
  if (chart.layout !== layout) {
    report(context, node.sourcePath, surface.span, 'asset.geometry-surface',
      `Chart "${surface.chart}" has layout ${chart.layout}, expected ${layout}.`);
    return null;
  }
  if (!Number.isSafeInteger(plan.texture.width) || !Number.isSafeInteger(plan.texture.height) ||
      plan.texture.width <= 0 || plan.texture.height <= 0 ||
      !Number.isSafeInteger(chart.origin[0]) || !Number.isSafeInteger(chart.origin[1]) ||
      chart.origin[0] < 0 || chart.origin[1] < 0 || !Number.isSafeInteger(chart.width) ||
      !Number.isSafeInteger(chart.height) || chart.width <= 0 || chart.height <= 0 ||
      chart.origin[0] + chart.width > plan.texture.width ||
      chart.origin[1] + chart.height > plan.texture.height ||
      typeof plan.texture.id !== 'string' || plan.texture.id.length === 0) {
    report(context, node.sourcePath, surface.span, 'asset.geometry-surface',
      `Chart "${surface.chart}" is outside its concrete texture atlas.`);
    return null;
  }
  return freeze({ plan, chart, material: binding.material });
};


export const signedAxis = (entries: readonly AssetExactNumber[]): Vec3 | null => {
  if (entries.length !== 3 || entries.some((entry) => entry.unit !== 'unit' ||
      entry.denominator !== 1n || ![-1n, 0n, 1n].includes(entry.numerator))) return null;
  const values = entries.map((entry) => entry.numerator === -1n ? -1 :
    entry.numerator === 0n ? 0 : 1);
  return values.filter((value) => value !== 0).length === 1
    ? vector3([values[0]!, values[1]!, values[2]!]) : null;
};
