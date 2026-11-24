import { freeze } from '../../../../immutable';
import type { AssetDiagnostic } from '../../../../project/program/asset/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import { compareText } from '../../../../stableOrder';
import type { InstantiatedComponentInstance, InstantiatedGeometryNode } from '../ir';
import { isAssetNumberValueShape, type AssetNumberValue, type AssetValue } from '../value/contract';
import { toAssetCanonicalNumber } from '../value/evaluate';
import type { AssetTextureUsage } from './contract';

const MAX_SIZE = 4096;
export const MAX_DIAGNOSTICS = 256;

const INTEGER_BOUNDARY = Object.freeze({
  minimum: 1,
  maximum: MAX_SIZE,
  integral: true,
});

export interface Location {
  readonly path: string;
  readonly span: SourceSpan;
}

export interface CollectedUsage {
  readonly surfaceKey: string;
  readonly chart: string;
  readonly usage: AssetTextureUsage;
  readonly path: string;
}

export const addIssue = (
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
  location: Location,
  code: string,
  message: string,
): void => {
  const key =
    `${location.path}\u0000${location.span.start.offset}\u0000` +
    `${location.span.end.offset}\u0000${code}\u0000${message}`;
  if (seen.has(key) || diagnostics.length >= MAX_DIAGNOSTICS) return;
  seen.add(key);
  diagnostics.push(
    freeze({ severity: 'error', path: location.path, span: location.span, code, message }),
  );
};

export const compareUsage = (left: CollectedUsage, right: CollectedUsage): number =>
  compareText(left.surfaceKey, right.surfaceKey) ||
  compareText(left.chart, right.chart) ||
  compareText(left.path, right.path) ||
  left.usage.span.start.offset - right.usage.span.start.offset ||
  JSON.stringify(left.usage.shape).localeCompare(JSON.stringify(right.usage.shape));

export const groupUsagesBySurface = (
  usages: readonly CollectedUsage[],
): ReadonlyMap<string, readonly CollectedUsage[]> => {
  const result = new Map<string, CollectedUsage[]>();
  for (const usage of usages) {
    const entries = result.get(usage.surfaceKey) ?? [];
    entries.push(usage);
    result.set(usage.surfaceKey, entries);
  }
  return result;
};

const valueVector = (
  value: AssetValue,
  type: 'vec2<unit>' | 'vec3<unit>',
): readonly AssetNumberValue[] | null => {
  try {
    if (
      value === null ||
      typeof value !== 'object' ||
      value.kind !== 'vector' ||
      value.type !== type ||
      !Array.isArray(value.values) ||
      value.values.length !== (type === 'vec2<unit>' ? 2 : 3) ||
      !value.values.every(isAssetNumberValueShape) ||
      value.values.some((entry) => entry.type !== 'unit' || entry.value.unit !== 'unit')
    ) {
      return null;
    }
    return value.values;
  } catch {
    return null;
  }
};

const integer = (
  value: AssetNumberValue,
  location: Location,
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): number | null => {
  if (!isAssetNumberValueShape(value) || value.type !== 'unit' || value.value.unit !== 'unit') {
    addIssue(
      diagnostics,
      seen,
      location,
      'asset.texture.geometry-size',
      'Geometry dimensions require exact unit values.',
    );
    return null;
  }
  const result = toAssetCanonicalNumber(value.value, INTEGER_BOUNDARY, location.span);
  if (!result.ok) {
    for (const item of result.diagnostics)
      addIssue(diagnostics, seen, location, item.code, item.message);
    return null;
  }
  return result.value;
};

const geometryUsage = (
  node: InstantiatedGeometryNode,
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): AssetTextureUsage | null => {
  const location: Location = { path: node.sourcePath, span: node.span };
  const properties = Array.isArray(node.properties) ? node.properties : [];
  const sizes = properties.filter((property) => property.name === 'size');
  if (sizes.length !== 1) {
    addIssue(
      diagnostics,
      seen,
      location,
      'asset.texture.geometry-size',
      `A ${node.kind} requires exactly one size property.`,
    );
    return null;
  }
  const size = sizes[0]!;
  const type = node.kind === 'cube' ? 'vec3<unit>' : 'vec2<unit>';
  const values = valueVector(size.value, type);
  if (values === null) {
    addIssue(
      diagnostics,
      seen,
      { path: node.sourcePath, span: size.span },
      'asset.texture.geometry-size',
      `A ${node.kind} size has the wrong exact type.`,
    );
    return null;
  }
  const numbers = values.map((value) =>
    integer(value, { path: node.sourcePath, span: size.span }, diagnostics, seen),
  );
  if (numbers.some((value): value is null => value === null)) return null;
  return freeze({
    chart: node.surface!.chart,
    shape:
      node.kind === 'cube'
        ? freeze({ kind: 'box' as const, size: freeze([numbers[0]!, numbers[1]!, numbers[2]!]) })
        : freeze({ kind: 'flat' as const, size: freeze([numbers[0]!, numbers[1]!]) }),
    span: size.span,
  });
};

const validateCubeOrPlaneSurface = (
  node: InstantiatedGeometryNode,
  location: Location,
  usages: CollectedUsage[],
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): void => {
  if (node.surface === null || typeof node.surface !== 'object') {
    addIssue(
      diagnostics,
      seen,
      location,
      'asset.texture.surface-binding',
      `Every ${node.kind} requires exactly one surface chart binding.`,
    );
    return;
  }
  if (
    typeof node.surface.surface?.key !== 'string' ||
    node.surface.surface.key.length === 0 ||
    typeof node.surface.chart !== 'string' ||
    node.surface.chart.length === 0
  ) {
    addIssue(
      diagnostics,
      seen,
      { path: node.sourcePath, span: node.surface.span },
      'asset.texture.surface-binding',
      'Geometry surface bindings require a nominal surface and chart.',
    );
    return;
  }
  const usage = geometryUsage(node, diagnostics, seen);
  if (usage !== null) {
    usages.push({
      surfaceKey: node.surface.surface.key,
      chart: node.surface.chart,
      usage,
      path: node.sourcePath,
    });
  }
};

const visitGeometryNode = (
  node: InstantiatedGeometryNode,
  usages: CollectedUsage[],
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): void => {
  const location: Location = { path: node.sourcePath, span: node.span };
  if (node.kind === 'cube' || node.kind === 'plane') {
    validateCubeOrPlaneSurface(node, location, usages, diagnostics, seen);
    return;
  }
  if (node.surface !== null && node.surface !== undefined) {
    addIssue(
      diagnostics,
      seen,
      { path: node.sourcePath, span: node.surface.span },
      'asset.texture.surface-binding',
      'Only cube and plane nodes may own a surface chart binding.',
    );
    return;
  }
  if (node.kind !== 'bone' && node.kind !== 'locator' && node.kind !== 'face') {
    addIssue(
      diagnostics,
      seen,
      location,
      'asset.texture.geometry-kind',
      'Geometry node kind is not supported by texture lowering.',
    );
  }
};

const walkGeometry = (
  nodes: readonly InstantiatedGeometryNode[],
  usages: CollectedUsage[],
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): void => {
  for (const node of nodes) {
    if (diagnostics.length >= MAX_DIAGNOSTICS) return;
    visitGeometryNode(node, usages, diagnostics, seen);
    if (Array.isArray(node.children)) walkGeometry(node.children, usages, diagnostics, seen);
    else {
      addIssue(
        diagnostics,
        seen,
        { path: node.sourcePath, span: node.span },
        'asset.texture.geometry-children',
        'Geometry children must be an array.',
      );
    }
  }
};

/** Walk instantiated component geometry in deterministic order to collect chart usages. */
export const collectGeometryUsages = (
  instances: readonly InstantiatedComponentInstance[],
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): CollectedUsage[] => {
  const usages: CollectedUsage[] = [];
  const sorted = [...instances].sort((left, right) => compareText(left.id, right.id));
  for (const instance of sorted) walkGeometry(instance.geometry, usages, diagnostics, seen);
  return usages;
};
