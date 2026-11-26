import { deepFreeze } from '../../immutable';
import type { CompiledModel } from '../../model/compiled';
import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import type { AssetSourceParseResult } from '../../project/program/asset/contract';
import { parseAssetSource } from '../../project/program/asset/parse';
import { lexProgramSource } from '../../project/program/syntax/lex';
import {
  parseStructureSource,
  StructureInputError,
  type StructureSourceUnit,
} from '../../project/structure';
import {
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  DEFAULT_WORKSPACE_LIMITS,
} from '../../project/workspace';
import { sealWorkspaceCandidate } from '../../project/workspace/seal';
import { compileAssetWorkspaceEntry } from '../program/asset/compile';
import {
  compileStructureUnits,
  type StructureAuditEvaluator,
  type StructureProduct,
} from '../structure';
import { qualifyCustomAssetKey, type EvaluatedStructureResult } from '../structure/contract';
import type { CachedCustomModel, DirectoryWorkspaceCache } from './cache';

const relativePath = (owner: string, target: string): string => {
  if (!target.startsWith('./') && !target.startsWith('../')) {
    throw new Error(`Structure imports must be relative .ashfox paths: ${target}`);
  }
  if (!target.endsWith('.ashfox') || /[\\\x00-\x1f]/u.test(target)) {
    throw new Error(`Invalid structure import: ${target}`);
  }
  const parts = owner.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) throw new Error(`Import escapes root: ${target}`);
      parts.pop();
    } else if (!segment) throw new Error(`Empty import segment: ${target}`);
    else parts.push(segment);
  }
  return parts.join('/');
};

const resolvePackageImport = (
  packages: DirectoryWorkspace['packages'],
  specifier: string,
): string | null => {
  for (const pkg of packages) {
    if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) continue;
    const subpath = specifier === pkg.name ? '.' : `./${specifier.slice(pkg.name.length + 1)}`;
    const mod = pkg.manifest.modules.find((m) => m.subpath === subpath);
    if (!mod) return null;
    return pkg.root ? `${pkg.root}/${mod.path}` : mod.path;
  }
  return null;
};

const resolveModelImport = (
  packages: DirectoryWorkspace['packages'],
  ownerPath: string,
  specifier: string,
): string | null => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return resolvePackageImport(packages, specifier);
  }
  try {
    return relativePath(ownerPath, specifier);
  } catch {
    return null;
  }
};

const parseAssetCached = (
  filePath: string,
  source: string,
  assetUnits?: Map<string, AssetSourceParseResult>,
): AssetSourceParseResult => {
  const cached = assetUnits?.get(filePath);
  if (cached) return cached;
  const parsed = parseAssetSource(source, filePath);
  assetUnits?.set(filePath, parsed);
  return parsed;
};

const visitReachableModel = (
  current: string,
  packages: DirectoryWorkspace['packages'],
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  reachable: Set<string>,
  stack: string[],
  assetUnits?: Map<string, AssetSourceParseResult>,
): void => {
  if (reachable.has(current)) return;
  reachable.add(current);
  const file = filesByPath.get(current);
  const parsed = file ? parseAssetCached(current, file.source, assetUnits) : null;
  if (!parsed?.unit) return;
  for (const imp of parsed.unit.imports) {
    const target = resolveModelImport(packages, current, imp.path);
    if (target && !reachable.has(target)) stack.push(target);
  }
};

/** Returns structure custom-model sources not reachable from any independent model entry. */
export const collectStructureOnlyCustomPaths = (
  config: DirectoryWorkspace,
  modelEntryPaths: readonly string[],
  structureCustomPaths: ReadonlySet<string>,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  assetUnits?: Map<string, AssetSourceParseResult>,
): ReadonlySet<string> => {
  const reachable = new Set<string>();
  const stack = [...modelEntryPaths];
  while (stack.length > 0) {
    visitReachableModel(stack.pop()!, config.packages, filesByPath, reachable, stack, assetUnits);
  }
  return new Set([...structureCustomPaths].filter((p) => !reachable.has(p)));
};

const collectModelClosure = (
  entryPath: string,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  collected: Map<string, DirectoryFile>,
  visiting: Set<string>,
  assetUnits?: Map<string, AssetSourceParseResult>,
): void => {
  if (visiting.has(entryPath) || collected.has(entryPath)) return;
  const file = filesByPath.get(entryPath);
  if (!file) throw new Error(`Missing custom model source: ${entryPath}`);
  visiting.add(entryPath);
  const parsed = parseAssetCached(entryPath, file.source, assetUnits);
  if (!parsed.unit || parsed.diagnostics.length > 0) {
    throw new Error(
      `Custom model parse failed (${entryPath}): ${JSON.stringify(parsed.diagnostics)}`,
    );
  }
  collected.set(entryPath, file);
  for (const imp of parsed.unit.imports) {
    collectModelClosure(
      relativePath(entryPath, imp.path),
      filesByPath,
      collected,
      visiting,
      assetUnits,
    );
  }
  visiting.delete(entryPath);
};

const buildCustomModelManifest = (
  entryId: string,
  modelPath: string,
  files: readonly DirectoryFile[],
) => ({
  format: 'ashfox-workspace' as const,
  version: 1 as const,
  packages: [
    {
      name: 'custom',
      root: '',
      manifest: {
        format: 'ashfox-package' as const,
        version: 1 as const,
        dependencies: [],
        entries: [{ name: entryId, path: modelPath }],
        modules: files
          .filter((f) => f.path !== modelPath)
          .map((f, i) => ({ subpath: `./mod${i}`, path: f.path })),
      },
    },
  ],
});

const compileImportedModel = (
  modelPath: string,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  cache: Map<string, CachedCustomModel>,
  touched: Set<string>,
  assetUnits?: Map<string, AssetSourceParseResult>,
): CompiledModel => {
  const cached = cache.get(modelPath);
  if (cached) {
    for (const p of cached.closurePaths) touched.add(p);
    return cached.model;
  }
  const closure = new Map<string, DirectoryFile>();
  collectModelClosure(modelPath, filesByPath, closure, new Set(), assetUnits);
  const closurePaths = Object.freeze([...closure.keys()]);
  for (const p of closurePaths) touched.add(p);
  const entryUnit = parseAssetCached(
    modelPath,
    filesByPath.get(modelPath)!.source,
    assetUnits,
  ).unit!;
  const files = [...closure.values()];
  const manifest = buildCustomModelManifest(entryUnit.id, modelPath, files);
  const base = {
    files: [],
    manifest,
    lock: {
      format: 'ashfox-lock' as const,
      version: 1 as const,
      compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
      packages: [],
    },
  };
  const sealed = sealWorkspaceCandidate(base, files, manifest, DEFAULT_WORKSPACE_LIMITS);
  if (!sealed.ok)
    throw new Error(
      `Custom model seal failed (${modelPath}): ${JSON.stringify(sealed.diagnostics)}`,
    );
  const compiled = compileAssetWorkspaceEntry(sealed.value, {
    packageName: 'custom',
    entryName: entryUnit.id,
  });
  if (!compiled.ok)
    throw new Error(
      `Custom model compile failed (${modelPath}): ${JSON.stringify(compiled.diagnostics)}`,
    );
  cache.set(modelPath, Object.freeze({ model: compiled.model, closurePaths }));
  return compiled.model;
};

interface StructureGraphState {
  readonly filesByPath: ReadonlyMap<string, DirectoryFile>;
  readonly entryPath: string;
  readonly units: Map<string, StructureSourceUnit>;
  readonly parsedUnitCache: Map<string, StructureSourceUnit>;
  readonly topKinds: Map<string, string | undefined>;
  readonly assetUnits: Map<string, AssetSourceParseResult>;
  readonly visiting: Set<string>;
  readonly customModels: Record<string, CompiledModel>;
  readonly modelCache: Map<string, CachedCustomModel>;
  readonly customModelPaths: Set<string>;
}

const topKindOf = (
  state: StructureGraphState,
  filePath: string,
  source: string,
): string | undefined => {
  if (state.topKinds.has(filePath)) return state.topKinds.get(filePath);
  const kind = lexProgramSource(source).tokens[2]?.value;
  state.topKinds.set(filePath, kind);
  return kind;
};

const parseStructureCached = (
  state: StructureGraphState,
  filePath: string,
  source: string,
): StructureSourceUnit => {
  const cached = state.parsedUnitCache.get(filePath);
  if (cached) return cached;
  const unit = deepFreeze(parseStructureSource(source, filePath));
  state.parsedUnitCache.set(filePath, unit);
  return unit;
};

const visitStructureUnit = (
  state: StructureGraphState,
  filePath: string,
  alias?: string,
  ownerPath?: string,
): void => {
  if (state.visiting.has(filePath)) throw new Error(`Structure import cycle: ${filePath}`);
  const file = state.filesByPath.get(filePath);
  if (!file) throw new Error(`Missing or ignored source: ${filePath}`);
  if (topKindOf(state, filePath, file.source) === 'asset') {
    if (!alias || !ownerPath || filePath === state.entryPath)
      throw new Error(`Unexpected asset entry: ${filePath}`);
    state.customModels[qualifyCustomAssetKey(ownerPath, alias)] = compileImportedModel(
      filePath,
      state.filesByPath,
      state.modelCache,
      state.customModelPaths,
      state.assetUnits,
    );
    return;
  }
  if (state.units.has(filePath)) return;
  if (state.visiting.size >= 32) throw new Error('Structure import depth exceeds 32');
  state.visiting.add(filePath);
  const unit = parseStructureCached(state, filePath, file.source);
  const ownerKind = ownerPath ? state.units.get(ownerPath)?.kind : undefined;
  const allowStructure = ownerKind === 'compound';
  if (
    filePath !== state.entryPath &&
    unit.kind !== 'module' &&
    !(allowStructure && unit.kind === 'structure')
  ) {
    throw new Error(`Structure import must refer to a module or asset: ${filePath}`);
  }
  state.units.set(filePath, unit);
  for (const dep of unit.imports) {
    visitStructureUnit(state, relativePath(filePath, dep.path), dep.alias, filePath);
  }
  state.visiting.delete(filePath);
};

export const compileDirectoryStructure = (
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  entryPath: string,
  evaluateAudit: StructureAuditEvaluator,
  cache?: DirectoryWorkspaceCache,
): {
  readonly structure: StructureProduct;
  readonly rootUnit: StructureSourceUnit;
  readonly structurePaths: readonly string[];
  readonly customPaths: readonly string[];
} => {
  const evaluatedGrids: Map<string, EvaluatedStructureResult> | undefined = cache?.evaluatedGrids;
  const state: StructureGraphState = {
    filesByPath,
    entryPath,
    units: new Map(),
    parsedUnitCache: cache?.structureUnits ?? new Map(),
    topKinds: cache?.topKinds ?? new Map(),
    assetUnits: cache?.assetUnits ?? new Map(),
    visiting: new Set(),
    customModels: {},
    modelCache: cache?.customModels ?? new Map(),
    customModelPaths: new Set(),
  };
  visitStructureUnit(state, entryPath);
  const rootUnit = state.units.get(entryPath)!;
  const nonEmptyLines = filesByPath
    .get(entryPath)!
    .source.split(/\r?\n/u)
    .filter((l) => l.trim().length > 0).length;
  if (nonEmptyLines > 140 && rootUnit.imports.length === 0 && rootUnit.prefabs.length >= 3) {
    throw new StructureInputError({
      code: 'structure.monolithic-entry',
      file: entryPath,
      pointer: 'build',
      expected: 'modular imports or fewer inline prefabs',
      actual: `${rootUnit.prefabs.length} inline prefabs across ${nonEmptyLines} non-empty lines`,
    });
  }
  const structure = compileStructureUnits(
    entryPath,
    state.units,
    state.customModels,
    relativePath,
    evaluateAudit,
    evaluatedGrids,
  );
  return {
    structure,
    rootUnit,
    structurePaths: [...state.units.keys()],
    customPaths: [...state.customModelPaths],
  };
};
