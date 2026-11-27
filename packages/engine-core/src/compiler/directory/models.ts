import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import {
  validateAssetDeclarations,
  type AssetDeclarations,
} from '../../project/directory/declarations';
import { buildStdPackageEntry, isStdLibraryLogicalPath } from '../../project/stdlib/resolve';
import { elaborateModelVariants } from '../../project/program/asset/variants';
import { collectStructureOnlyCustomPaths } from './structure';
import type { DirectoryWorkspaceCache } from './cache';
import { sealWorkspaceCandidate } from '../../project/workspace/seal';
import {
  DEFAULT_WORKSPACE_LIMITS,
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  type AuthoredAssetWorkspace,
  type WorkspaceEntrySelector,
} from '../../project/workspace';
import type { HooksDocument } from '../../hooks/contract';
import type { CompiledModel } from '../../model/compiled';
import type { AssetAuthoringTelemetry } from '../program/asset/texture/telemetry';
import { compileWorkspaceCandidate } from '../program/asset/workspaceCompile';
import { computeModelColliders } from '../../model/collider';
import { buildHooksBoneContext, emptyHooksDocument } from '../../hooks/resolve';
import { buildModuleAliasMap, collectHookModuleClosure, resolveDirectoryHooks } from './hooks';

interface ModelCompileFailure {
  readonly ok: false;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly file: string;
    readonly message: string;
    readonly hint?: string;
  }[];
}

export interface ModelCompileEntry {
  readonly entry: WorkspaceEntrySelector;
  readonly path: string;
}

export interface ModelCompileProduct {
  readonly kind: 'model';
  readonly entry: WorkspaceEntrySelector;
  readonly sourcePath: string;
  readonly model: CompiledModel;
  readonly workspace: AuthoredAssetWorkspace;
  readonly declarations: AssetDeclarations;
  readonly hooks?: HooksDocument;
  readonly telemetry?: AssetAuthoringTelemetry;
}

export interface ModelCompileOutput {
  readonly products: { push: (product: ModelCompileProduct) => number };
  readonly nonModelPaths: Set<string>;
  readonly structureCustomPaths: Set<string>;
  readonly modelEntries: ModelCompileEntry[];
}

type Files = ReadonlyMap<string, DirectoryFile>;

const joinPath = (root: string, path: string): string => [root, path].filter(Boolean).join('/');
const entryKey = (entry: WorkspaceEntrySelector): string =>
  JSON.stringify([entry.packageName, entry.entryName]);

const modelManifest = (
  config: DirectoryWorkspace,
  output: ModelCompileOutput,
  excludedCustom: ReadonlySet<string>,
  sources: readonly DirectoryFile[],
) => {
  const modelPaths = new Set(output.modelEntries.map((e) => e.path));
  const packages = config.packages.map((p) => ({
    ...p,
    manifest: {
      ...p.manifest,
      entries: p.manifest.entries.filter((e) => modelPaths.has(joinPath(p.root, e.path))),
      modules: p.manifest.modules.filter((e) => {
        const pth = joinPath(p.root, e.path);
        return !output.nonModelPaths.has(pth) && !excludedCustom.has(pth);
      }),
    },
  }));
  const stdPkg = packages.some((p) => p.name === 'std')
    ? null
    : buildStdPackageEntry(sources.map((f) => f.path));
  return {
    format: 'ashfox-workspace' as const,
    version: 1 as const,
    packages: stdPkg ? [...packages, stdPkg] : packages,
  };
};

const pushModelProducts = (
  checkedProducts: ReturnType<typeof compileWorkspaceCandidate> & { readonly ok: true },
  modelEntries: readonly ModelCompileEntry[],
  filesByPath: Files,
  moduleAliases: ReadonlyMap<string, string>,
  output: ModelCompileOutput,
  originPaths?: ReadonlyMap<string, string>,
): ModelCompileFailure | null => {
  const modelSources = new Map(modelEntries.map((e) => [entryKey(e.entry), e.path]));
  for (const result of checkedProducts.products) {
    const virtualPath = modelSources.get(entryKey(result.entry))!;
    const sourcePath = originPaths?.get(entryKey(result.entry)) ?? virtualPath;
    const resolvedHooks = resolveDirectoryHooks(
      virtualPath,
      filesByPath,
      undefined,
      buildHooksBoneContext(result.model.scene.nodes),
      moduleAliases,
    );
    if (resolvedHooks.failure) return resolvedHooks.failure;
    const colliders = computeModelColliders(result.model);
    const baseHooks = resolvedHooks.hooks ?? emptyHooksDocument(result.model.name);
    const hooks =
      colliders.colliders.length > 0 ? { ...baseHooks, colliders } : resolvedHooks.hooks;
    output.products.push({
      kind: 'model',
      entry: result.entry,
      sourcePath,
      model: result.model,
      workspace: checkedProducts.workspace,
      declarations: validateAssetDeclarations('model', result.outputs, result.previews, sourcePath),
      ...(hooks ? { hooks } : {}),
      ...(result.telemetry !== undefined ? { telemetry: result.telemetry } : {}),
    });
  }
  return null;
};

interface ExpandedVariantModels {
  readonly config: DirectoryWorkspace;
  readonly files: readonly DirectoryFile[];
  readonly filesByPath: Files;
  readonly modelEntries: readonly ModelCompileEntry[];
  readonly originPaths: ReadonlyMap<string, string>;
}

const variantRelPath = (pkgRoot: string, fullPath: string, modelId: string): string => {
  const rel =
    pkgRoot && fullPath.startsWith(`${pkgRoot}/`) ? fullPath.slice(pkgRoot.length + 1) : fullPath;
  const slash = rel.lastIndexOf('/');
  const dir = slash >= 0 ? rel.slice(0, slash + 1) : '';
  return `${dir}__variant_${modelId}.ashfox`;
};

const applyVariantEntries = (
  config: DirectoryWorkspace,
  filesByPath: Files,
  modelEntries: readonly ModelCompileEntry[],
  expandedByOrigin: ReadonlyMap<string, ReturnType<typeof elaborateModelVariants>>,
): ExpandedVariantModels => {
  const replacedPaths = new Set<string>();
  const nextEntries: ModelCompileEntry[] = [];
  const nextFilesMap = new Map(filesByPath);
  const originPaths = new Map<string, string>();
  const extraPkgEntries = new Map<string, { readonly name: string; readonly path: string }[]>();
  const removedPkgEntries = new Set<string>();

  for (const entry of modelEntries) {
    const key = entryKey(entry.entry);
    const variants = expandedByOrigin.get(key);
    if (!variants) {
      nextEntries.push(entry);
      continue;
    }
    replacedPaths.add(entry.path);
    removedPkgEntries.add(key);
    const pkg = config.packages.find((p) => p.name === entry.entry.packageName)!;
    const added = extraPkgEntries.get(pkg.name) ?? [];
    for (const v of variants) {
      const rel = variantRelPath(pkg.root, entry.path, v.modelId);
      const fullPath = joinPath(pkg.root, rel);
      const selector = { packageName: pkg.name, entryName: v.modelId };
      nextEntries.push({ entry: selector, path: fullPath });
      nextFilesMap.set(fullPath, { path: fullPath, source: v.source });
      originPaths.set(entryKey(selector), entry.path);
      added.push({ name: v.modelId, path: rel });
    }
    extraPkgEntries.set(pkg.name, added);
  }
  for (const p of replacedPaths) nextFilesMap.delete(p);
  const nextConfig = rebuildConfigWithVariants(config, removedPkgEntries, extraPkgEntries);
  return {
    config: nextConfig,
    files: [...nextFilesMap.values()],
    filesByPath: nextFilesMap,
    modelEntries: nextEntries,
    originPaths,
  };
};

const rebuildConfigWithVariants = (
  config: DirectoryWorkspace,
  removedPkgEntries: ReadonlySet<string>,
  extraPkgEntries: ReadonlyMap<string, readonly { readonly name: string; readonly path: string }[]>,
): DirectoryWorkspace => ({
  ...config,
  packages: config.packages.map((p) => ({
    ...p,
    manifest: {
      ...p.manifest,
      entries: [
        ...p.manifest.entries.filter(
          (e) => !removedPkgEntries.has(entryKey({ packageName: p.name, entryName: e.name })),
        ),
        ...(extraPkgEntries.get(p.name) ?? []),
      ],
    },
  })),
});

const expandVariantModels = (
  config: DirectoryWorkspace,
  files: readonly DirectoryFile[],
  filesByPath: Files,
  modelEntries: readonly ModelCompileEntry[],
): ExpandedVariantModels => {
  const expandedByOrigin = new Map<string, ReturnType<typeof elaborateModelVariants>>();
  for (const entry of modelEntries) {
    const src = filesByPath.get(entry.path)?.source;
    if (!src || !/\bvariant\b/.test(src)) continue;
    const variants = elaborateModelVariants(src, entry.path);
    if (variants.length > 0) expandedByOrigin.set(entryKey(entry.entry), variants);
  }
  if (expandedByOrigin.size === 0) {
    return { config, files, filesByPath, modelEntries, originPaths: new Map() };
  }
  return applyVariantEntries(config, filesByPath, modelEntries, expandedByOrigin);
};

const mapModelDiagnostics = (
  diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly hint?: string;
    readonly source?: { readonly path: string };
  }[],
): ModelCompileFailure => ({
  ok: false,
  diagnostics: diagnostics.map((d) => ({
    code: d.code,
    file: d.source?.path ?? '.ashfoxworkspace',
    message: d.message,
    ...(d.hint !== undefined ? { hint: d.hint } : {}),
  })),
});

const buildModelWorkspace = (
  expanded: ExpandedVariantModels,
  output: ModelCompileOutput,
  cache?: DirectoryWorkspaceCache,
) => {
  const entryPaths = expanded.modelEntries.map((e) => e.path);
  const excludedCustom = collectStructureOnlyCustomPaths(
    expanded.config,
    entryPaths,
    output.structureCustomPaths,
    expanded.filesByPath,
    cache?.assetUnits,
  );
  const moduleAliases = buildModuleAliasMap(expanded.config);
  const modelReachable = collectHookModuleClosure(entryPaths, expanded.filesByPath, moduleAliases);
  const effectiveOutput: ModelCompileOutput = {
    ...output,
    modelEntries: [...expanded.modelEntries],
    nonModelPaths: new Set([...output.nonModelPaths].filter((p) => !modelReachable.has(p))),
  };
  const sources = expanded.files.filter(
    (f) =>
      !effectiveOutput.nonModelPaths.has(f.path) &&
      !excludedCustom.has(f.path) &&
      (!isStdLibraryLogicalPath(f.path) || modelReachable.has(f.path)),
  );
  const manifest = modelManifest(expanded.config, effectiveOutput, excludedCustom, sources);
  const lock = {
    format: 'ashfox-lock' as const,
    version: 1 as const,
    compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
    packages: [],
  };
  return { sources, manifest, lock, moduleAliases };
};

/** Seals the non-sprite sources as one model workspace and compiles every model entry. */
export const compileModels = (
  config: DirectoryWorkspace,
  files: readonly DirectoryFile[],
  filesByPath: Files,
  output: ModelCompileOutput,
  cache?: DirectoryWorkspaceCache,
): ModelCompileFailure | null => {
  if (!output.modelEntries.length) {
    const orphan = files.some(
      (f) =>
        !output.nonModelPaths.has(f.path) &&
        !output.structureCustomPaths.has(f.path) &&
        !isStdLibraryLogicalPath(f.path),
    );
    if (orphan) throw new Error('Every declared module must be reachable');
    return null;
  }
  const expanded = expandVariantModels(config, files, filesByPath, output.modelEntries);
  const { sources, manifest, lock, moduleAliases } = buildModelWorkspace(expanded, output, cache);
  const sealed = sealWorkspaceCandidate(
    { files: [], manifest, lock },
    sources,
    manifest,
    DEFAULT_WORKSPACE_LIMITS,
  );
  if (!sealed.ok) return mapModelDiagnostics(sealed.diagnostics);
  const checked = compileWorkspaceCandidate(sealed.value, {}, true);
  if (!checked.ok) return mapModelDiagnostics(checked.diagnostics);
  return pushModelProducts(
    checked,
    expanded.modelEntries,
    expanded.filesByPath,
    moduleAliases,
    output,
    expanded.originPaths,
  );
};
