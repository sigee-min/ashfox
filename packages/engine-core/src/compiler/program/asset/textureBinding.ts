import { deepFreeze, freeze } from '../../../immutable';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import { compareText } from '../../../stableOrder';
import type { TypedAssetHir, TypedSurface, TypedSurfaceContract } from './contract';
import { compareDiagnostics } from './diagnostics';
import type { InstantiatedAssetIr, InstantiatedSurfaceBinding } from './ir';
import type { AssetTexturePlan } from './texture/contract';
import { buildTextureSceneContext, type TextureSceneContext } from './texture/ao';
import {
  addIssue,
  collectGeometryUsages,
  compareUsage,
  groupUsagesBySurface,
  MAX_DIAGNOSTICS,
  type CollectedUsage,
  type Location,
} from './texture/usage';
import { materializeAssetTexturePlan } from './texturePlan';

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

interface SelectedSurface {
  readonly binding: InstantiatedSurfaceBinding;
  readonly surface: TypedSurface;
  readonly contract: TypedSurfaceContract;
  readonly path: string;
}

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

const selectBinding = (
  binding: InstantiatedSurfaceBinding,
  hir: TypedAssetHir,
  usageBySurface: ReadonlyMap<string, readonly CollectedUsage[]>,
  selected: Set<string>,
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): SelectedSurface | null => {
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
    return null;
  }
  if (selected.has(key)) {
    addIssue(
      diagnostics,
      seen,
      location,
      'asset.texture.duplicate-surface',
      `Surface "${key}" is selected more than once.`,
    );
    return null;
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
    return null;
  }
  if (contract === undefined || binding.contract.key !== surface.contract.key) {
    addIssue(
      diagnostics,
      seen,
      location,
      'asset.texture.contract-mismatch',
      `Selected surface "${key}" does not resolve to its typed contract.`,
    );
    return null;
  }
  const surfaceUsages = usageBySurface.get(key) ?? [];
  return { binding, surface, contract, path: pathForSurface(hir, surface, surfaceUsages) };
};

const selectedSurfaces = (
  hir: TypedAssetHir,
  ir: InstantiatedAssetIr,
  usageBySurface: ReadonlyMap<string, readonly CollectedUsage[]>,
  usages: readonly CollectedUsage[],
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): readonly SelectedSurface[] => {
  const result: SelectedSurface[] = [];
  const bindings = [...ir.surfaces].sort((left, right) =>
    compareText(left.surface.key, right.surface.key),
  );
  const selected = new Set<string>();
  for (const binding of bindings) {
    const entry = selectBinding(binding, hir, usageBySurface, selected, diagnostics, seen);
    if (entry !== null) result.push(entry);
  }
  for (const usage of usages) {
    if (!selected.has(usage.surfaceKey)) {
      addIssue(
        diagnostics,
        seen,
        { path: usage.path, span: usage.usage.span },
        'asset.texture.unselected-surface',
        `Geometry selects surface "${usage.surfaceKey}" without an asset surface binding.`,
      );
    }
  }
  return result.sort((left, right) =>
    compareText(left.surface.symbol.key, right.surface.symbol.key),
  );
};

const materializeSelectedSurfaces = (
  selected: readonly SelectedSurface[],
  bySurface: ReadonlyMap<string, readonly CollectedUsage[]>,
  scene: TextureSceneContext,
  diagnostics: AssetDiagnostic[],
  seen: Set<string>,
): Readonly<{
  readonly plans: readonly AssetTexturePlan[];
  readonly resolution: readonly [number, number] | null;
}> => {
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
      scene,
    );
    if (plan === null) {
      if (diagnostics.length === before) {
        addIssue(
          diagnostics,
          seen,
          { path: item.path, span: item.binding.span },
          'asset.texture.materialization',
          'Selected surface texture could not be materialized.',
        );
      }
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
  return { plans, resolution };
};

/** Collect exact geometry chart usages and materialize every selected surface. */
export const lowerAssetTextures = (
  hir: TypedAssetHir,
  ir: InstantiatedAssetIr,
): AssetTextureBindingResult => {
  const diagnostics: AssetDiagnostic[] = [];
  const seen = new Set<string>();
  const usages = collectGeometryUsages(ir.instances, diagnostics, seen);
  if (diagnostics.length >= MAX_DIAGNOSTICS) {
    return deepFreeze({ ok: false, diagnostics: [...diagnostics].sort(compareDiagnostics) });
  }
  const bySurface = groupUsagesBySurface(usages);
  const selected = selectedSurfaces(hir, ir, bySurface, usages, diagnostics, seen);
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
  const scene = buildTextureSceneContext(ir);
  const { plans, resolution } = materializeSelectedSurfaces(
    selected,
    bySurface,
    scene,
    diagnostics,
    seen,
  );
  if (diagnostics.length > 0) {
    return deepFreeze({ ok: false, diagnostics: [...diagnostics].sort(compareDiagnostics) });
  }
  return deepFreeze({ ok: true, plans: deepFreeze(plans), resolution: resolution! });
};
