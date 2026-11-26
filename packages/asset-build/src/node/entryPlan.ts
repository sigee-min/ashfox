import { AUDIO_POLICY } from '@ashfox/audio-core';
import {
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  SPRITE_POLICY,
  canonicalJsonString,
  inspectNativeSource,
  isDirectorySource,
  readDirectoryWorkspace,
  sha256Digest,
  type DirectoryFile,
  type DirectoryWorkspace,
  type WorkspaceEntrySelector,
} from '@ashfox/engine-core';
import { compareText, encodeUtf8 } from '@ashfox/internal-contracts';
import { BuildFailure, type Snapshot } from '../bundle/contract';
import { digest, json } from '../shared/digest';
import { readCacheJson, writeCacheJson, type DiskCacheContext } from './diskCache';
import { assertWorkspaceSoundBudget, prepareNodeSound, type PreparedNodeSound } from './soundPlan';

type NativeSourceMetadata = ReturnType<typeof inspectNativeSource>;

export interface PlannedEntry {
  readonly kind: 'model' | 'sprite' | 'sound' | 'structure';
  readonly entry: WorkspaceEntrySelector;
  readonly sourcePath: string;
  readonly closurePaths: readonly string[];
  readonly files: readonly DirectoryFile[];
  readonly subConfigJson: string;
  readonly closureHash: string;
  readonly preparedSound?: PreparedNodeSound;
}

export interface WorkspaceExecutionPlan {
  readonly ok: true;
  readonly config: DirectoryWorkspace;
  readonly sourceHash: string;
  readonly buildKey: string;
  readonly entries: readonly PlannedEntry[];
}

const CANONICAL_PREFIXES = [
  'assets/models/',
  'assets/sprites/',
  'assets/sounds/',
  'assets/structures/',
  'assets/module/',
] as const;

const BUCKET_BY_KIND: Readonly<Record<PlannedEntry['kind'], string>> = {
  model: 'assets/models/',
  sprite: 'assets/sprites/',
  sound: 'assets/sounds/',
  structure: 'assets/structures/',
};

export const joinPackagePath = (root: string, rel: string): string =>
  [root, rel].filter(Boolean).join('/');

export const entrySelectorKey = (entry: WorkspaceEntrySelector): string =>
  JSON.stringify([entry.packageName, entry.entryName]);

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

const resolvePackageImport = (
  packages: DirectoryWorkspace['packages'],
  specifier: string,
): string | null => {
  for (const pkg of packages) {
    if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) continue;
    const subpath = specifier === pkg.name ? '.' : `./${specifier.slice(pkg.name.length + 1)}`;
    const mod = pkg.manifest.modules.find((m) => m.subpath === subpath);
    if (!mod) return null;
    return joinPackagePath(pkg.root, mod.path);
  }
  return null;
};

const resolveImportTarget = (
  packages: DirectoryWorkspace['packages'],
  ownerPath: string,
  specifier: string,
  allowPackage: boolean,
): string | null => {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return resolveRelativeImport(ownerPath, specifier);
  }
  return allowPackage ? resolvePackageImport(packages, specifier) : null;
};

const loadSourceMetadata = (
  files: readonly DirectoryFile[],
  cache: DiskCacheContext,
): ReadonlyMap<string, NativeSourceMetadata> => {
  const indexKey = `meta-${cache.fingerprint}`;
  const cached = cache.enabled
    ? (readCacheJson<Record<string, NativeSourceMetadata>>(cache, indexKey) ?? {})
    : {};
  const nextIndex: Record<string, NativeSourceMetadata> = { ...cached };
  const result = new Map<string, NativeSourceMetadata>();
  let dirty = false;
  for (const file of files) {
    const fileKey = digest(`${file.path}\u0000${file.source}`);
    let meta = cached[fileKey];
    if (!meta) {
      meta = inspectNativeSource(file.source, file.path);
      nextIndex[fileKey] = meta;
      dirty = true;
    }
    result.set(file.path, meta);
  }
  if (dirty && cache.enabled) writeCacheJson(cache, indexKey, nextIndex);
  return result;
};

const validateDeclaredSnapshotFiles = (
  config: DirectoryWorkspace,
  files: readonly DirectoryFile[],
): ReadonlyMap<string, DirectoryFile> | null => {
  const totalBytes = files.reduce((sum, f) => sum + encodeUtf8(f.source).length, 0);
  if (files.length > 512 || totalBytes > 8 * 1024 * 1024) return null;
  const declared = new Set(
    config.packages.flatMap((p) =>
      [...p.manifest.entries, ...p.manifest.modules].map((e) => joinPackagePath(p.root, e.path)),
    ),
  );
  const seen = new Set<string>();
  for (const f of files) {
    const valid =
      !f.path.startsWith('/') &&
      isDirectorySource(config, f.path) &&
      declared.has(f.path) &&
      !seen.has(f.path.toLowerCase());
    if (!valid) return null;
    seen.add(f.path.toLowerCase());
  }
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const p of declared) if (!byPath.has(p)) return null;
  return byPath;
};

const recordModuleImport = (
  entryPath: string,
  target: string | null,
  seen: Set<string>,
  queue: string[],
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
  importers: Map<string, Set<string>>,
): void => {
  if (!target || seen.has(target)) return;
  seen.add(target);
  const targetMeta = metaByPath.get(target);
  if (!targetMeta) return;
  if (targetMeta.kind === 'module') {
    const owners = importers.get(target) ?? new Set<string>();
    owners.add(entryPath);
    importers.set(target, owners);
  }
  queue.push(target);
};

const collectEntryModuleImporters = (
  entryPath: string,
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
  importers: Map<string, Set<string>>,
): void => {
  const seen = new Set<string>();
  const queue = [entryPath];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const curMeta = metaByPath.get(cur);
    if (!curMeta) continue;
    for (const spec of curMeta.imports) {
      recordModuleImport(
        entryPath,
        resolveRelativeImport(cur, spec),
        seen,
        queue,
        metaByPath,
        importers,
      );
    }
  }
};

const hasInvalidLayoutFile = (metaByPath: ReadonlyMap<string, NativeSourceMetadata>): boolean => {
  for (const [filePath, meta] of metaByPath) {
    if (!CANONICAL_PREFIXES.some((prefix) => filePath.startsWith(prefix))) return true;
    if (filePath.startsWith('assets/module/') && meta.kind !== 'module') return true;
  }
  return false;
};

const checkLayout = (
  config: DirectoryWorkspace,
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
  entryPaths: readonly string[],
): boolean => {
  if (config.name === 'standalone') return true;
  if (hasInvalidLayoutFile(metaByPath)) return false;
  const importers = new Map<string, Set<string>>();
  for (const entryPath of new Set(entryPaths)) {
    const meta = metaByPath.get(entryPath);
    if (!meta || meta.kind === 'module') continue;
    if (!entryPath.startsWith(BUCKET_BY_KIND[meta.kind])) return false;
    collectEntryModuleImporters(entryPath, metaByPath, importers);
  }
  return [...importers.entries()].every(
    ([modPath, owners]) => owners.size < 2 || modPath.startsWith('assets/module/'),
  );
};

const collectEntryClosure = (
  entryPath: string,
  kind: PlannedEntry['kind'],
  packages: DirectoryWorkspace['packages'],
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
): readonly string[] | null => {
  const seen = new Set<string>();
  const queue = [entryPath];
  const allowPkg = kind === 'model';
  while (queue.length > 0) {
    const cur = queue.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const meta = metaByPath.get(cur);
    if (!meta) return null;
    for (const spec of meta.imports) {
      const target = resolveImportTarget(packages, cur, spec, allowPkg);
      if (!target || !metaByPath.has(target)) return null;
      if (!seen.has(target)) queue.push(target);
    }
  }
  return [...seen].sort(compareText);
};

const packageRelativePath = (pkgRoot: string, fullPath: string): string =>
  pkgRoot ? fullPath.slice(pkgRoot.length + 1) : fullPath;

const buildSubConfigJson = (
  config: DirectoryWorkspace,
  ownerEntry: WorkspaceEntrySelector,
  ownerPath: string,
  closureSet: ReadonlySet<string>,
): string => {
  const packages = config.packages
    .map((pkg) => {
      const isOwner = pkg.name === ownerEntry.packageName;
      const entries = isOwner
        ? pkg.manifest.entries.filter((e) => e.name === ownerEntry.entryName)
        : [];
      const modules = pkg.manifest.modules.filter((m) =>
        closureSet.has(joinPackagePath(pkg.root, m.path)),
      );
      const declaredModPaths = new Set(modules.map((m) => joinPackagePath(pkg.root, m.path)));
      const prefix = pkg.root ? `${pkg.root}/` : '';
      const extraModules = [...closureSet]
        .filter(
          (p) =>
            p !== ownerPath && !declaredModPaths.has(p) && (prefix === '' || p.startsWith(prefix)),
        )
        .sort(compareText)
        .map((p, idx) => ({ subpath: `./__dep_${idx}`, path: packageRelativePath(pkg.root, p) }));
      const allModules = [...modules, ...extraModules];
      if (entries.length === 0 && allModules.length === 0) return null;
      return {
        name: pkg.name,
        root: pkg.root,
        manifest: {
          format: pkg.manifest.format,
          version: pkg.manifest.version,
          entries,
          modules: allModules,
          dependencies: pkg.manifest.dependencies,
        },
      };
    })
    .filter((pkg): pkg is NonNullable<typeof pkg> => pkg !== null);

  const validNames = new Set(packages.map((p) => p.name));
  const sanitized = packages.map((pkg) => ({
    ...pkg,
    manifest: {
      ...pkg.manifest,
      dependencies: pkg.manifest.dependencies.filter((d) => validNames.has(d.name)),
    },
  }));
  return JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: config.name,
    packages: sanitized,
    include: config.include,
    ignore: config.ignore,
    build: { directory: config.build.directory },
    exports: [],
  });
};

const prepareEntrySound = (
  entryPath: string,
  entryName: string,
  closureHash: string,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  cache: DiskCacheContext,
): PreparedNodeSound => {
  const key = `sound-prep-${closureHash}-${cache.fingerprint}`;
  const cached = readCacheJson<PreparedNodeSound>(cache, key);
  if (cached) return cached;
  const prepared = prepareNodeSound(filesByPath, entryPath, entryName);
  writeCacheJson(cache, key, prepared);
  return prepared;
};

const isValidPackSoundBinding = (
  sound: Extract<
    NonNullable<DirectoryWorkspace['packs']>[number],
    { readonly format: 'minecraft_java' }
  >['sounds'][number],
  exportsByName: ReadonlyMap<string, DirectoryWorkspace['exports'][number]>,
  byEntry: ReadonlyMap<string, PlannedEntry>,
): boolean => {
  const target = exportsByName.get(sound.source);
  const entry = target ? byEntry.get(entrySelectorKey(target.entry)) : undefined;
  if (!entry || entry.kind !== 'sound' || !entry.preparedSound) return false;
  const rawVariants = entry.preparedSound.resolvedRecipe.variants;
  const available = new Set(
    Array.isArray(rawVariants) ? rawVariants.map((v) => String((v as { id?: unknown }).id)) : [],
  );
  return sound.variants === 'all' || sound.variants.every((v) => available.has(v.id));
};

const validatePackSoundsMatch = (
  config: DirectoryWorkspace,
  byEntry: ReadonlyMap<string, PlannedEntry>,
): boolean => {
  const exportsByName = new Map(config.exports.map((t) => [t.name, t]));
  for (const pack of config.packs ?? []) {
    if (pack.format !== 'minecraft_java') continue;
    if (pack.sounds.some((sound) => !isValidPackSoundBinding(sound, exportsByName, byEntry))) {
      return false;
    }
  }
  return true;
};

const validatePlanExportsAndPacks = (
  config: DirectoryWorkspace,
  byEntry: ReadonlyMap<string, PlannedEntry>,
): boolean => {
  const formats: Readonly<Record<PlannedEntry['kind'], readonly string[]>> = {
    sprite: ['png'],
    model: ['glb', 'gltf', 'java_block', 'geckolib5', 'bedrock'],
    sound: ['wav'],
    structure: ['java_structure', 'glb'],
  };
  for (const target of config.exports) {
    const entry = byEntry.get(entrySelectorKey(target.entry));
    if (!entry || !formats[entry.kind].includes(target.format)) return false;
  }
  return validatePackSoundsMatch(config, byEntry);
};

interface ResolvedPlanEntries {
  readonly planned: readonly PlannedEntry[];
  readonly reachable: ReadonlySet<string>;
}

const resolveAllPlannedEntries = (
  config: DirectoryWorkspace,
  rawEntries: readonly { readonly entry: WorkspaceEntrySelector; readonly path: string }[],
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
  cache: DiskCacheContext,
): ResolvedPlanEntries | null => {
  const reachable = new Set<string>();
  const planned: PlannedEntry[] = [];
  const soundTotals = { outputFrames: 0, eventFrames: 0, weightedFrames: 0 };
  let soundSources = 0;

  for (const item of rawEntries) {
    const meta = metaByPath.get(item.path);
    if (!meta || meta.kind === 'module') return null;
    const closurePaths = collectEntryClosure(item.path, meta.kind, config.packages, metaByPath);
    if (!closurePaths) return null;
    for (const p of closurePaths) reachable.add(p);
    const subConfigJson = buildSubConfigJson(config, item.entry, item.path, new Set(closurePaths));
    const files = closurePaths.map((p) => filesByPath.get(p)!);
    const closureHash = digest(json({ entry: item.entry, subConfigJson, files }));
    let preparedSound: PreparedNodeSound | undefined;
    if (meta.kind === 'sound') {
      preparedSound = prepareEntrySound(
        item.path,
        item.entry.entryName,
        closureHash,
        filesByPath,
        cache,
      );
      soundSources += 1;
      soundTotals.outputFrames += preparedSound.budget.outputFrames;
      soundTotals.eventFrames += preparedSound.budget.eventFrames;
      soundTotals.weightedFrames += preparedSound.budget.weightedFrames;
      assertWorkspaceSoundBudget(item.path, soundSources, soundTotals);
    }
    planned.push({
      kind: meta.kind,
      entry: item.entry,
      sourcePath: item.path,
      closurePaths,
      files,
      subConfigJson,
      closureHash,
      preparedSound,
    });
  }
  return { planned, reachable };
};

export const planWorkspaceExecution = (
  snapshot: Snapshot,
  cache: DiskCacheContext,
): WorkspaceExecutionPlan | null => {
  try {
    const config = readDirectoryWorkspace(snapshot.configuration);
    const filesByPath = validateDeclaredSnapshotFiles(config, snapshot.files);
    if (!filesByPath) return null;
    const rawEntries = config.packages.flatMap((p) =>
      p.manifest.entries.map((e) => ({
        entry: { packageName: p.name, entryName: e.name },
        path: joinPackagePath(p.root, e.path),
      })),
    );
    if (!rawEntries.length) return null;
    const metaByPath = loadSourceMetadata(snapshot.files, cache);
    if (
      !checkLayout(
        config,
        metaByPath,
        rawEntries.map((e) => e.path),
      )
    )
      return null;

    const resolved = resolveAllPlannedEntries(config, rawEntries, filesByPath, metaByPath, cache);
    if (!resolved) return null;
    if (snapshot.files.some((f) => !resolved.reachable.has(f.path))) return null;
    const byEntry = new Map(resolved.planned.map((e) => [entrySelectorKey(e.entry), e]));
    if (!validatePlanExportsAndPacks(config, byEntry)) return null;

    const sourceHash = sha256Digest(
      canonicalJsonString({
        config,
        files: [...snapshot.files].sort((a, b) => compareText(a.path, b.path)),
      }),
    );
    const buildKey = sha256Digest(
      sourceHash +
        SPRITE_POLICY +
        AUDIO_POLICY +
        ASHFOX_WORKSPACE_COMPILER_FINGERPRINT +
        ':directory-v2',
    );
    return { ok: true, config, sourceHash, buildKey, entries: resolved.planned };
  } catch (error) {
    if (error instanceof BuildFailure) throw error;
    return null;
  }
};
