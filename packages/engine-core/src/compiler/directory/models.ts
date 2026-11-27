import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import {
  validateAssetDeclarations,
  type AssetDeclarations,
} from '../../project/directory/declarations';
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
  return { format: 'ashfox-workspace' as const, version: 1 as const, packages };
};

const pushModelProducts = (
  checkedProducts: ReturnType<typeof compileWorkspaceCandidate> & { readonly ok: true },
  modelEntries: readonly ModelCompileEntry[],
  filesByPath: Files,
  moduleAliases: ReadonlyMap<string, string>,
  output: ModelCompileOutput,
): ModelCompileFailure | null => {
  const modelSources = new Map(modelEntries.map((e) => [entryKey(e.entry), e.path]));
  for (const result of checkedProducts.products) {
    const sourcePath = modelSources.get(entryKey(result.entry))!;
    const resolvedHooks = resolveDirectoryHooks(
      sourcePath,
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
      (f) => !output.nonModelPaths.has(f.path) && !output.structureCustomPaths.has(f.path),
    );
    if (orphan) throw new Error('Every declared module must be reachable');
    return null;
  }
  const excludedCustom = collectStructureOnlyCustomPaths(
    config,
    output.modelEntries.map((e) => e.path),
    output.structureCustomPaths,
    filesByPath,
    cache?.assetUnits,
  );
  const moduleAliases = buildModuleAliasMap(config);
  const modelReachable = collectHookModuleClosure(
    output.modelEntries.map((e) => e.path),
    filesByPath,
    moduleAliases,
  );
  const effectiveOutput: ModelCompileOutput = {
    ...output,
    nonModelPaths: new Set([...output.nonModelPaths].filter((p) => !modelReachable.has(p))),
  };
  const manifest = modelManifest(config, effectiveOutput, excludedCustom);
  const lock = {
    format: 'ashfox-lock' as const,
    version: 1 as const,
    compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
    packages: [],
  };
  const sources = files.filter(
    (f) => !effectiveOutput.nonModelPaths.has(f.path) && !excludedCustom.has(f.path),
  );
  const sealed = sealWorkspaceCandidate(
    { files: [], manifest, lock },
    sources,
    manifest,
    DEFAULT_WORKSPACE_LIMITS,
  );
  if (!sealed.ok) return mapModelDiagnostics(sealed.diagnostics);
  const checked = compileWorkspaceCandidate(sealed.value, {}, true);
  if (!checked.ok) return mapModelDiagnostics(checked.diagnostics);
  return pushModelProducts(checked, output.modelEntries, filesByPath, moduleAliases, output);
};
