import { AUDIO_POLICY } from '@ashfox/audio-core';
import {
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  SPRITE_POLICY,
  canonicalJsonString,
  checkWorkspaceModularity,
  elaborateModelVariants,
  readDirectoryWorkspace,
  sha256Digest,
  type DirectoryFile,
  type DirectoryWorkspace,
  type ElaboratedVariantSource,
  type WorkspaceEntrySelector,
} from '@ashfox/engine-core';
import { compareText } from '@ashfox/internal-contracts';
import { BuildFailure, type Snapshot } from '../bundle/contract';
import { digest, json } from '../shared/digest';
import { readCacheJson, writeCacheJson, type DiskCacheContext } from './diskCache';
import {
  buildSubConfigJson,
  checkLayout,
  collectEntryClosure,
  entrySelectorKey,
  joinPackagePath,
  loadSourceMetadata,
  validateDeclaredSnapshotFiles,
  type AssetEntryKind,
  type NativeSourceMetadata,
} from './planLayout';
import { assertWorkspaceSoundBudget, prepareNodeSound, type PreparedNodeSound } from './soundPlan';
import { resolveStdLibraryFiles } from './stdlib';

export { entrySelectorKey, joinPackagePath } from './planLayout';

export interface PlannedEntry {
  readonly kind: AssetEntryKind;
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

const EXPORT_FORMATS_BY_KIND: Readonly<Record<AssetEntryKind, readonly string[]>> = {
  sprite: ['png'],
  model: ['glb', 'gltf', 'java_block', 'geckolib5', 'bedrock'],
  sound: ['wav'],
  structure: ['java_structure', 'glb'],
  vfx: ['glb'],
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
  for (const target of config.exports) {
    const entry = byEntry.get(entrySelectorKey(target.entry));
    if (!entry || !EXPORT_FORMATS_BY_KIND[entry.kind].includes(target.format)) return false;
  }
  return validatePackSoundsMatch(config, byEntry);
};

interface SoundBudgetState {
  sources: number;
  readonly totals: { outputFrames: number; eventFrames: number; weightedFrames: number };
}

const resolvePlannedEntry = (
  config: DirectoryWorkspace,
  item: { readonly entry: WorkspaceEntrySelector; readonly path: string },
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
  cache: DiskCacheContext,
  soundBudget: SoundBudgetState,
): PlannedEntry | null => {
  const meta = metaByPath.get(item.path);
  if (!meta || meta.kind === 'module') return null;
  const closurePaths = collectEntryClosure(item.path, meta.kind, config.packages, metaByPath);
  if (!closurePaths) return null;
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
    soundBudget.sources += 1;
    soundBudget.totals.outputFrames += preparedSound.budget.outputFrames;
    soundBudget.totals.eventFrames += preparedSound.budget.eventFrames;
    soundBudget.totals.weightedFrames += preparedSound.budget.weightedFrames;
    assertWorkspaceSoundBudget(item.path, soundBudget.sources, soundBudget.totals);
  }
  return {
    kind: meta.kind,
    entry: item.entry,
    sourcePath: item.path,
    closurePaths,
    files,
    subConfigJson,
    closureHash,
    preparedSound,
  };
};

const variantPaths = (
  pkgRoot: string,
  fullPath: string,
  modelId: string,
): readonly [string, string] => {
  const rel =
    pkgRoot && fullPath.startsWith(`${pkgRoot}/`) ? fullPath.slice(pkgRoot.length + 1) : fullPath;
  const slash = rel.lastIndexOf('/');
  const dir = slash >= 0 ? rel.slice(0, slash + 1) : '';
  const variantRel = `${dir}__variant_${modelId}.ashfox`;
  return [variantRel, joinPackagePath(pkgRoot, variantRel)];
};

const buildVariantPlannedEntry = (
  config: DirectoryWorkspace,
  item: { readonly entry: WorkspaceEntrySelector; readonly path: string },
  closurePaths: readonly string[],
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  variant: ElaboratedVariantSource,
): PlannedEntry => {
  const pkg = config.packages.find((p) => p.name === item.entry.packageName)!;
  const [variantRel, variantFull] = variantPaths(pkg.root, item.path, variant.modelId);
  const selector = { packageName: pkg.name, entryName: variant.modelId };
  const vConfig: DirectoryWorkspace = {
    ...config,
    packages: config.packages.map((p) =>
      p.name === pkg.name
        ? {
            ...p,
            manifest: {
              ...p.manifest,
              entries: [
                ...p.manifest.entries.filter((e) => e.name !== item.entry.entryName),
                { name: variant.modelId, path: variantRel },
              ],
            },
          }
        : p,
    ),
  };
  const nextClosure = closurePaths.map((p) => (p === item.path ? variantFull : p));
  const files = nextClosure.map((p) =>
    p === variantFull ? { path: variantFull, source: variant.source } : filesByPath.get(p)!,
  );
  const subConfigJson = buildSubConfigJson(vConfig, selector, variantFull, new Set(nextClosure));
  return {
    kind: 'model',
    entry: selector,
    sourcePath: item.path,
    closurePaths,
    files,
    subConfigJson,
    closureHash: digest(json({ entry: selector, subConfigJson, files })),
  };
};

const resolvePlannedEntriesForItem = (
  config: DirectoryWorkspace,
  item: { readonly entry: WorkspaceEntrySelector; readonly path: string },
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
  cache: DiskCacheContext,
  soundBudget: SoundBudgetState,
): readonly PlannedEntry[] | null => {
  const base = resolvePlannedEntry(config, item, filesByPath, metaByPath, cache, soundBudget);
  if (!base) return null;
  if (base.kind !== 'model') return [base];
  const src = filesByPath.get(item.path)?.source;
  if (!src || !/\bvariant\b/.test(src)) return [base];
  const variants = elaborateModelVariants(src, item.path);
  if (variants.length === 0) return [base];
  return variants.map((v) =>
    buildVariantPlannedEntry(config, item, base.closurePaths, filesByPath, v),
  );
};

const resolveAllPlannedEntries = (
  config: DirectoryWorkspace,
  rawEntries: readonly { readonly entry: WorkspaceEntrySelector; readonly path: string }[],
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  metaByPath: ReadonlyMap<string, NativeSourceMetadata>,
  cache: DiskCacheContext,
): {
  readonly planned: readonly PlannedEntry[];
  readonly reachable: ReadonlySet<string>;
} | null => {
  const reachable = new Set<string>();
  const planned: PlannedEntry[] = [];
  const soundBudget: SoundBudgetState = {
    sources: 0,
    totals: { outputFrames: 0, eventFrames: 0, weightedFrames: 0 },
  };
  for (const item of rawEntries) {
    const entries = resolvePlannedEntriesForItem(
      config,
      item,
      filesByPath,
      metaByPath,
      cache,
      soundBudget,
    );
    if (!entries) return null;
    for (const entry of entries) {
      for (const p of entry.closurePaths) reachable.add(p);
      planned.push(entry);
    }
  }
  return { planned, reachable };
};

export const planWorkspaceExecution = (
  snapshot: Snapshot,
  cache: DiskCacheContext,
): WorkspaceExecutionPlan | null => {
  try {
    const config = readDirectoryWorkspace(snapshot.configuration);
    const files = resolveStdLibraryFiles(snapshot.files, undefined, snapshot.root);
    const filesByPath = validateDeclaredSnapshotFiles(config, files);
    if (!filesByPath || !checkWorkspaceModularity(files).ok) return null;
    const rawEntries = config.packages.flatMap((p) =>
      p.manifest.entries.map((e) => ({
        entry: { packageName: p.name, entryName: e.name },
        path: joinPackagePath(p.root, e.path),
      })),
    );
    if (!rawEntries.length) return null;
    const metaByPath = loadSourceMetadata(files, cache);
    if (
      !checkLayout(
        config,
        metaByPath,
        rawEntries.map((e) => e.path),
      )
    )
      return null;
    const resolved = resolveAllPlannedEntries(config, rawEntries, filesByPath, metaByPath, cache);
    if (!resolved || files.some((f) => !resolved.reachable.has(f.path))) return null;
    const byEntry = new Map(resolved.planned.map((e) => [entrySelectorKey(e.entry), e]));
    if (!validatePlanExportsAndPacks(config, byEntry)) return null;
    const sourceHash = sha256Digest(
      canonicalJsonString({
        config,
        files: [...files].sort((a, b) => compareText(a.path, b.path)),
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
