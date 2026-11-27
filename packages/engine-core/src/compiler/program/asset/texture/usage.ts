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
  hint?: string,
): void => {
  const key =
    `${location.path}\u0000${location.span.start.offset}\u0000` +
    `${location.span.end.offset}\u0000${code}\u0000${message}`;
  if (seen.has(key) || diagnostics.length >= MAX_DIAGNOSTICS) return;
  seen.add(key);
  diagnostics.push(
    freeze({
      severity: 'error',
      path: location.path,
      span: location.span,
      code,
      message,
      ...(hint !== undefined ? { hint } : {}),
    }),
  );
};

export const compareUsage = (left: CollectedUsage, right: CollectedUsage): number =>
  compareText(left.surfaceKey, right.surfaceKey) ||
  compareText(left.chart, right.chart) ||
  compareText(left.path, right.path) ||
  left.usage.span.start.offset - right.usage.span.start.offset ||
  compareText(JSON.stringify(left.usage.shape), JSON.stringify(right.usage.shape));

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

const cylinderDim = (
  value: AssetValue | undefined,
  minimum: number,
  location: Location,
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): number | null => {
  if (
    value === undefined ||
    !isAssetNumberValueShape(value as AssetNumberValue) ||
    (value as AssetNumberValue).value.unit !== 'unit'
  ) {
    addIssue(
      diagnostics,
      seen,
      location,
      'asset.texture.geometry-size',
      'Cylinder dimensions require exact unit values.',
    );
    return null;
  }
  const num = toAssetCanonicalNumber(
    (value as AssetNumberValue).value,
    { minimum, maximum: MAX_SIZE, integral: false },
    location.span,
  );
  if (!num.ok) {
    for (const item of num.diagnostics)
      addIssue(diagnostics, seen, location, item.code, item.message);
    return null;
  }
  return num.value;
};

const cylinderUsage = (
  node: InstantiatedGeometryNode,
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): AssetTextureUsage | null => {
  const location: Location = { path: node.sourcePath, span: node.span };
  const properties = Array.isArray(node.properties) ? node.properties : [];
  const radius = cylinderDim(
    properties.find((p) => p.name === 'radius')?.value,
    0,
    location,
    diagnostics,
    seen,
  );
  const height = cylinderDim(
    properties.find((p) => p.name === 'height')?.value,
    1e-4,
    location,
    diagnostics,
    seen,
  );
  if (radius === null || height === null) return null;
  const topProp = properties.find((p) => p.name === 'radius_top')?.value;
  const radiusTop =
    topProp === undefined ? radius : cylinderDim(topProp, 0, location, diagnostics, seen);
  if (radiusTop === null) return null;
  const maxR = Math.max(radius, radiusTop);
  if (maxR <= 0) {
    addIssue(
      diagnostics,
      seen,
      location,
      'asset.texture.geometry-size',
      'Cylinder requires at least one positive end radius.',
    );
    return null;
  }
  const d = Math.max(1, Math.min(MAX_SIZE, Math.ceil(maxR * 2)));
  const h = Math.max(1, Math.min(MAX_SIZE, Math.ceil(height)));
  return freeze({
    chart: node.surface!.chart,
    shape: freeze({ kind: 'box' as const, size: freeze([d, h, d]) }),
    span: node.span,
  });
};

const BOX_SHAPE_KINDS = new Set(['cube', 'taper', 'wedge']);

const geometryUsage = (
  node: InstantiatedGeometryNode,
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): AssetTextureUsage | null => {
  if (node.kind === 'cylinder') return cylinderUsage(node, diagnostics, seen);
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
  const isBox = BOX_SHAPE_KINDS.has(node.kind);
  const type = isBox ? 'vec3<unit>' : 'vec2<unit>';
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
    shape: isBox
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

const expressionSlotUsage = (
  node: InstantiatedGeometryNode,
  usages: CollectedUsage[],
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): void => {
  const location: Location = { path: node.sourcePath, span: node.span };
  const properties = Array.isArray(node.properties) ? node.properties : [];
  const sizeProp = properties.find((p) => p.name === 'size');
  const values = sizeProp ? valueVector(sizeProp.value, 'vec2<unit>') : null;
  if (!sizeProp || values === null) {
    addIssue(
      diagnostics,
      seen,
      location,
      'asset.texture.geometry-size',
      'expression_slot requires a vec2<unit> size.',
    );
    return;
  }
  const nums = values.map((v) =>
    integer(v, { path: node.sourcePath, span: sizeProp.span }, diagnostics, seen),
  );
  if (nums.some((n): n is null => n === null)) return;
  for (const variant of node.expressionVariants ?? []) {
    usages.push({
      surfaceKey: variant.surface.surface.key,
      chart: variant.surface.chart,
      usage: freeze({
        chart: variant.surface.chart,
        shape: freeze({ kind: 'flat' as const, size: freeze([nums[0]!, nums[1]!]) }),
        span: variant.span,
      }),
      path: node.sourcePath,
    });
  }
};

const SURFACE_NODE_KINDS = new Set(['cube', 'plane', 'taper', 'wedge', 'cylinder']);

const visitGeometryNode = (
  node: InstantiatedGeometryNode,
  usages: CollectedUsage[],
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): void => {
  const location: Location = { path: node.sourcePath, span: node.span };
  if (node.kind === 'expression_slot') {
    expressionSlotUsage(node, usages, diagnostics, seen);
    return;
  }
  if (SURFACE_NODE_KINDS.has(node.kind)) {
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
