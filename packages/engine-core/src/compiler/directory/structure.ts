import type { CompiledModel } from '../../model/compiled';
import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
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
import { qualifyCustomAssetKey } from '../structure/contract';

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

const visitReachableModel = (
  current: string,
  packages: DirectoryWorkspace['packages'],
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  reachable: Set<string>,
  stack: string[],
): void => {
  if (reachable.has(current)) return;
  reachable.add(current);
  const file = filesByPath.get(current);
  const parsed = file ? parseAssetSource(file.source, current) : null;
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
): ReadonlySet<string> => {
  const reachable = new Set<string>();
  const stack = [...modelEntryPaths];
  while (stack.length > 0) {
    visitReachableModel(stack.pop()!, config.packages, filesByPath, reachable, stack);
  }
  return new Set([...structureCustomPaths].filter((p) => !reachable.has(p)));
};

const collectModelClosure = (
  entryPath: string,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  collected: Map<string, DirectoryFile>,
  visiting: Set<string>,
): void => {
  if (visiting.has(entryPath) || collected.has(entryPath)) return;
  const file = filesByPath.get(entryPath);
  if (!file) throw new Error(`Missing custom model source: ${entryPath}`);
  visiting.add(entryPath);
  const parsed = parseAssetSource(file.source, entryPath);
  if (!parsed.unit || parsed.diagnostics.length > 0) {
    throw new Error(
      `Custom model parse failed (${entryPath}): ${JSON.stringify(parsed.diagnostics)}`,
    );
  }
  collected.set(entryPath, file);
  for (const imp of parsed.unit.imports) {
    collectModelClosure(relativePath(entryPath, imp.path), filesByPath, collected, visiting);
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
  cache: Map<string, CompiledModel>,
  touched: Set<string>,
): CompiledModel => {
  const cached = cache.get(modelPath);
  if (cached) return cached;
  const closure = new Map<string, DirectoryFile>();
  collectModelClosure(modelPath, filesByPath, closure, new Set());
  for (const path of closure.keys()) touched.add(path);
  const entryUnit = parseAssetSource(filesByPath.get(modelPath)!.source, modelPath).unit!;
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
  cache.set(modelPath, compiled.model);
  return compiled.model;
};

interface StructureGraphState {
  readonly filesByPath: ReadonlyMap<string, DirectoryFile>;
  readonly entryPath: string;
  readonly units: Map<string, StructureSourceUnit>;
  readonly visiting: Set<string>;
  readonly customModels: Record<string, CompiledModel>;
  readonly modelCache: Map<string, CompiledModel>;
  readonly customModelPaths: Set<string>;
}

const visitStructureUnit = (
  state: StructureGraphState,
  filePath: string,
  alias?: string,
  ownerPath?: string,
): void => {
  if (state.visiting.has(filePath)) throw new Error(`Structure import cycle: ${filePath}`);
  const file = state.filesByPath.get(filePath);
  if (!file) throw new Error(`Missing or ignored source: ${filePath}`);
  const topKind = lexProgramSource(file.source).tokens[2]?.value;
  if (topKind === 'asset') {
    if (!alias || !ownerPath || filePath === state.entryPath)
      throw new Error(`Unexpected asset entry: ${filePath}`);
    state.customModels[qualifyCustomAssetKey(ownerPath, alias)] = compileImportedModel(
      filePath,
      state.filesByPath,
      state.modelCache,
      state.customModelPaths,
    );
    return;
  }
  if (state.units.has(filePath)) return;
  if (state.visiting.size >= 32) throw new Error('Structure import depth exceeds 32');
  state.visiting.add(filePath);
  const unit = parseStructureSource(file.source, filePath);
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
): {
  readonly structure: StructureProduct;
  readonly rootUnit: StructureSourceUnit;
  readonly structurePaths: readonly string[];
  readonly customPaths: readonly string[];
} => {
  const state: StructureGraphState = {
    filesByPath,
    entryPath,
    units: new Map(),
    visiting: new Set(),
    customModels: {},
    modelCache: new Map(),
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
  );
  return {
    structure,
    rootUnit,
    structurePaths: [...state.units.keys()],
    customPaths: [...state.customModelPaths],
  };
};
