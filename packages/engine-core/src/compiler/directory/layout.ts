import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import { inspectNativeSource } from '../../project/directory/source';
import type { DeclaredAssetKind } from '../../project/directory/declarations';

const CANONICAL_PREFIXES = [
  'assets/models/',
  'assets/sprites/',
  'assets/sounds/',
  'assets/structures/',
  'assets/module/',
] as const;

const BUCKET_BY_KIND: Readonly<Record<DeclaredAssetKind, string>> = {
  model: 'assets/models/',
  sprite: 'assets/sprites/',
  sound: 'assets/sounds/',
  structure: 'assets/structures/',
};

const isUnder = (filePath: string, prefix: string): boolean => filePath.startsWith(prefix);

const resolveRelativeImport = (ownerPath: string, specifier: string): string | null => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  const parts = ownerPath.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (segment) {
      parts.push(segment);
    }
  }
  return parts.join('/');
};

type InspectedMap = ReadonlyMap<string, ReturnType<typeof inspectNativeSource>>;

const recordImportDep = (
  entryPath: string,
  target: string | null,
  seen: Set<string>,
  queue: string[],
  inspected: InspectedMap,
  importersByModule: Map<string, Set<string>>,
): void => {
  if (!target || seen.has(target)) return;
  seen.add(target);
  const targetMeta = inspected.get(target);
  if (!targetMeta) return;
  if (targetMeta.kind === 'module') {
    const owners = importersByModule.get(target) ?? new Set<string>();
    owners.add(entryPath);
    importersByModule.set(target, owners);
  }
  queue.push(target);
};

const collectEntryModuleDeps = (
  entryPath: string,
  inspected: InspectedMap,
  importersByModule: Map<string, Set<string>>,
): void => {
  const queue = [entryPath];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const meta = inspected.get(cur);
    if (!meta) continue;
    for (const spec of meta.imports) {
      recordImportDep(
        entryPath,
        resolveRelativeImport(cur, spec),
        seen,
        queue,
        inspected,
        importersByModule,
      );
    }
  }
};

const inspectWorkspaceFiles = (filesByPath: ReadonlyMap<string, DirectoryFile>): InspectedMap => {
  const inspected = new Map<string, ReturnType<typeof inspectNativeSource>>();
  for (const [filePath, file] of filesByPath) {
    if (!CANONICAL_PREFIXES.some((prefix) => isUnder(filePath, prefix))) {
      throw new Error(
        `${filePath}: layout.root: Source files must live under assets/{models,sprites,sounds,structures,module}/`,
      );
    }
    const meta = inspectNativeSource(file.source, filePath);
    inspected.set(filePath, meta);
    if (isUnder(filePath, 'assets/module/') && meta.kind !== 'module') {
      throw new Error(
        `${filePath}: layout.module-only: Only module units are allowed under assets/module/`,
      );
    }
  }
  return inspected;
};

/** Enforces canonical boilerplate directory layout at compile time for multi-asset workspaces. */
export const validateCanonicalLayout = (
  config: DirectoryWorkspace,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  entryPaths: readonly string[],
): void => {
  if (config.name === 'standalone') return;
  const inspected = inspectWorkspaceFiles(filesByPath);
  const importersByModule = new Map<string, Set<string>>();
  for (const entryPath of new Set(entryPaths)) {
    const meta = inspected.get(entryPath);
    if (!meta || meta.kind === 'module') continue;
    const expectedBucket = BUCKET_BY_KIND[meta.kind];
    if (!isUnder(entryPath, expectedBucket)) {
      throw new Error(
        `${entryPath}: layout.kind-mismatch: ${meta.kind} entry must live under ${expectedBucket}`,
      );
    }
    collectEntryModuleDeps(entryPath, inspected, importersByModule);
  }
  for (const [modPath, owners] of importersByModule) {
    if (owners.size >= 2 && !isUnder(modPath, 'assets/module/')) {
      throw new Error(
        `${modPath}: layout.shared-in-module: Shared module imported by ${owners.size} entries must live under assets/module/`,
      );
    }
  }
};
