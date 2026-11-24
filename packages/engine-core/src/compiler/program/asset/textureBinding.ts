import { compareText } from '../../../stableOrder';
import type { SourceSpan } from '../../../project/source/contract';
import { deepFreeze, freeze } from '../../../immutable';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import { toAssetCanonicalNumber } from './valueEvaluate';
import { isAssetNumberValueShape, type AssetNumberValue, type AssetValue } from './value/contract';
import type {
  InstantiatedAssetIr,
  InstantiatedGeometryNode,
  InstantiatedSurfaceBinding,
} from './ir';
import type { AssetTexturePlan, AssetTextureUsage } from './texture/contract';
import { materializeAssetTexturePlan } from './texturePlan';
import type { TypedAssetHir, TypedSurface, TypedSurfaceContract } from './contract';

const MAX_SIZE = 4096;
const MAX_DIAGNOSTICS = 256;
const INTEGER_BOUNDARY = Object.freeze({
  minimum: 1,
  maximum: MAX_SIZE,
  integral: true,
});
export type AssetTextureBindingResult =
  | Readonly<{
      readonly ok: true;
      readonly plans: readonly AssetTexturePlan[];
      readonly resolution: readonly [number, number];
    }>
  | Readonly<{
      readonly ok: false;
      readonly diagnostics: readonly AssetDiagnostic[];
    }>;

interface Location {
  readonly path: string;
  readonly span: SourceSpan;
}

interface CollectedUsage {
  readonly surfaceKey: string;
  readonly chart: string;
  readonly usage: AssetTextureUsage;
  readonly path: string;
}

interface SelectedSurface {
  readonly binding: InstantiatedSurfaceBinding;
  readonly surface: TypedSurface;
  readonly contract: TypedSurfaceContract;
  readonly path: string;
}

const compareDiagnostics = (left: AssetDiagnostic, right: AssetDiagnostic): number =>
  compareText(left.path, right.path) ||
  left.span.start.offset - right.span.start.offset ||
  left.span.end.offset - right.span.end.offset ||
  compareText(left.code, right.code) ||
  compareText(left.message, right.message);

const compareUsage = (left: CollectedUsage, right: CollectedUsage): number =>
  compareText(left.surfaceKey, right.surfaceKey) ||
  compareText(left.chart, right.chart) ||
  compareText(left.path, right.path) ||
  left.usage.span.start.offset - right.usage.span.start.offset ||
  JSON.stringify(left.usage.shape).localeCompare(JSON.stringify(right.usage.shape));

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

const addIssue = (
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

const walkGeometry = (
  nodes: readonly InstantiatedGeometryNode[],
  usages: CollectedUsage[],
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): void => {
  for (const node of nodes) {
    if (diagnostics.length >= MAX_DIAGNOSTICS) return;
    const location: Location = { path: node.sourcePath, span: node.span };
    if (node.kind === 'cube' || node.kind === 'plane') {
      if (node.surface === null || typeof node.surface !== 'object') {
        addIssue(
          diagnostics,
          seen,
          location,
          'asset.texture.surface-binding',
          `Every ${node.kind} requires exactly one surface chart binding.`,
        );
      } else if (
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
      } else {
        const usage = geometryUsage(node, diagnostics, seen);
        if (usage !== null)
          usages.push({
            surfaceKey: node.surface.surface.key,
            chart: node.surface.chart,
            usage,
            path: node.sourcePath,
          });
      }
    } else if (node.surface !== null && node.surface !== undefined) {
      addIssue(
        diagnostics,
        seen,
        { path: node.sourcePath, span: node.surface.span },
        'asset.texture.surface-binding',
        `Only cube and plane nodes may own a surface chart binding.`,
      );
    } else if (node.kind !== 'bone' && node.kind !== 'locator' && node.kind !== 'face') {
      addIssue(
        diagnostics,
        seen,
        location,
        'asset.texture.geometry-kind',
        'Geometry node kind is not supported by texture lowering.',
      );
    }
    if (Array.isArray(node.children)) walkGeometry(node.children, usages, diagnostics, seen);
    else
      addIssue(
        diagnostics,
        seen,
        location,
        'asset.texture.geometry-children',
        'Geometry children must be an array.',
      );
  }
};

const pathForSurface = (
  hir: TypedAssetHir,
  surface: TypedSurface,
  usages: readonly CollectedUsage[],
): string => hir.modules[surface.symbol.modulePath]?.path ?? usages[0]?.path ?? hir.rootPath;

const pathForBinding = (hir: TypedAssetHir, binding: InstantiatedSurfaceBinding): string =>
  hir.modules[binding.surface.modulePath]?.path ?? hir.rootPath;

const assetLocation = (hir: TypedAssetHir, ir: InstantiatedAssetIr): Location => {
  const asset =
    hir.assets[ir.asset.key] ??
    Object.values(hir.assets).sort((left, right) =>
      compareText(left.symbol.key, right.symbol.key),
    )[0];
  const path = hir.modules[asset?.symbol.modulePath ?? ir.asset.modulePath]?.path ?? hir.rootPath;
  if (asset !== undefined) return { path, span: asset.span };
  const instance = [...ir.instances].sort((left, right) => compareText(left.id, right.id))[0];
  if (instance !== undefined) return { path: instance.sourcePath, span: instance.span };
  const binding = [...ir.surfaces].sort((left, right) =>
    compareText(left.surface.key, right.surface.key),
  )[0];
  if (binding !== undefined) return { path: pathForBinding(hir, binding), span: binding.span };
  throw new Error('Texture lowering requires a validated asset source span.');
};

const selectedSurfaces = (
  hir: TypedAssetHir,
  ir: InstantiatedAssetIr,
  usages: readonly CollectedUsage[],
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): readonly SelectedSurface[] => {
  const usageBySurface = new Map<string, CollectedUsage[]>();
  for (const usage of usages) {
    const entries = usageBySurface.get(usage.surfaceKey) ?? [];
    entries.push(usage);
    usageBySurface.set(usage.surfaceKey, entries);
  }
  const result: SelectedSurface[] = [];
  const bindings = [...ir.surfaces].sort((left, right) =>
    compareText(left.surface.key, right.surface.key),
  );
  const selected = new Set<string>();
  for (const binding of bindings) {
    const location: Location = { path: pathForBinding(hir, binding), span: binding.span };
    const key = binding.surface?.key;
    if (typeof key !== 'string' || key.length === 0) {
      addIssue(
        diagnostics,
        seen,
        location,
        'asset.texture.surface-reference',
        'Selected texture surfaces require a complete nominal identity.',
      );
      continue;
    }
    if (selected.has(key)) {
      addIssue(
        diagnostics,
        seen,
        location,
        'asset.texture.duplicate-surface',
        `Surface "${key}" is selected more than once.`,
      );
      continue;
    }
    selected.add(key);
    const surface = hir.surfaces[key];
    const contract = surface === undefined ? undefined : hir.surfaceContracts[surface.contract.key];
    if (surface === undefined) {
      addIssue(
        diagnostics,
        seen,
        location,
        'asset.texture.missing-surface',
        `Selected surface "${key}" is not present in typed HIR.`,
      );
      continue;
    }
    if (contract === undefined || binding.contract.key !== surface.contract.key) {
      addIssue(
        diagnostics,
        seen,
        location,
        'asset.texture.contract-mismatch',
        `Selected surface "${key}" does not resolve to its typed contract.`,
      );
      continue;
    }
    const surfaceUsages = usageBySurface.get(key) ?? [];
    result.push({ binding, surface, contract, path: pathForSurface(hir, surface, surfaceUsages) });
  }
  for (const usage of usages)
    if (!selected.has(usage.surfaceKey))
      addIssue(
        diagnostics,
        seen,
        { path: usage.path, span: usage.usage.span },
        'asset.texture.unselected-surface',
        `Geometry selects surface "${usage.surfaceKey}" without an asset surface binding.`,
      );
  return result.sort((left, right) =>
    compareText(left.surface.symbol.key, right.surface.symbol.key),
  );
};

/** Collect exact geometry chart usages and materialize every selected surface. */
export const lowerAssetTextures = (
  hir: TypedAssetHir,
  ir: InstantiatedAssetIr,
): AssetTextureBindingResult => {
  const diagnostics: AssetDiagnostic[] = [];
  const seen = new Set<string>();
  const usages: CollectedUsage[] = [];
  for (const instance of [...ir.instances].sort((left, right) => compareText(left.id, right.id)))
    walkGeometry(instance.geometry, usages, diagnostics, seen);
  if (diagnostics.length >= MAX_DIAGNOSTICS)
    return deepFreeze({ ok: false, diagnostics: [...diagnostics].sort(compareDiagnostics) });
  const selected = selectedSurfaces(hir, ir, usages, diagnostics, seen);
  if (selected.length === 0 && diagnostics.length === 0) {
    const location = assetLocation(hir, ir);
    addIssue(
      diagnostics,
      seen,
      location,
      'asset.texture.missing',
      'The selected asset must materialize at least one surface texture.',
    );
  }
  const bySurface = new Map<string, CollectedUsage[]>();
  for (const usage of usages) {
    const entries = bySurface.get(usage.surfaceKey) ?? [];
    entries.push(usage);
    bySurface.set(usage.surfaceKey, entries);
  }
  const plans: AssetTexturePlan[] = [];
  let resolution: readonly [number, number] | null = null;
  for (const item of selected) {
    if (diagnostics.length >= MAX_DIAGNOSTICS) break;
    const surfaceUsages = [...(bySurface.get(item.surface.symbol.key) ?? [])]
      .sort(compareUsage)
      .map((entry) => entry.usage);
    const before = diagnostics.length;
    const plan = materializeAssetTexturePlan(
      item.surface,
      item.contract,
      surfaceUsages,
      item.path,
      (path, span, code, message) => addIssue(diagnostics, seen, { path, span }, code, message),
    );
    if (plan === null) {
      if (diagnostics.length === before)
        addIssue(
          diagnostics,
          seen,
          { path: item.path, span: item.binding.span },
          'asset.texture.materialization',
          'Selected surface texture could not be materialized.',
        );
      continue;
    }
    if (resolution === null) resolution = freeze([plan.texture.width, plan.texture.height]);
    else if (resolution[0] !== plan.texture.width || resolution[1] !== plan.texture.height) {
      addIssue(
        diagnostics,
        seen,
        { path: item.path, span: item.binding.span },
        'asset.texture.resolution-mismatch',
        'All selected surfaces must use one exact atlas resolution.',
      );
      continue;
    }
    plans.push(deepFreeze(plan));
  }
  if (diagnostics.length > 0)
    return deepFreeze({ ok: false, diagnostics: [...diagnostics].sort(compareDiagnostics) });
  return deepFreeze({ ok: true, plans: deepFreeze(plans), resolution: resolution! });
};
