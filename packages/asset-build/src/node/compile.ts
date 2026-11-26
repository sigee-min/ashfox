import type { SoundProduct } from '@ashfox/audio-core';
import type { StructureAuditReport, WorkspaceEntrySelector } from '@ashfox/engine-core';
import { compareText } from '@ashfox/internal-contracts';
import { compileBundle, checkSnapshot } from '../bundle/compile';
import {
  BuildFailure,
  type AssetMetadata,
  type CompiledBundle,
  type Snapshot,
} from '../bundle/contract';
import {
  finalizeNodeBundle,
  readCachedBuildEntry,
  requiresVorbisEncoder,
  writeCachedBuildEntry,
  type ResolvedBuildEntry,
} from './bundleCache';
import {
  createDiskCache,
  readCacheJson,
  writeCacheJson,
  type DiskCacheContext,
  type NodeBuildOptions,
} from './diskCache';
import {
  entrySelectorKey,
  planWorkspaceExecution,
  type PlannedEntry,
  type WorkspaceExecutionPlan,
} from './entryPlan';
import { collectExactModelPackageInterfaces, computeModelWorkspaceHash } from './modelHash';
import { createLazyVorbisGetter } from './packCache';
import { createWorkerPool, type WorkerPoolHandle } from './workerPool';
import {
  executeWorkerTask,
  poolWorkerModulePath,
  type TargetExportSpec,
  type WorkerTaskInput,
  type WorkerTaskResult,
} from './workerTask';

export type { NodeBuildOptions } from './diskCache';

export interface NodeCheckProduct {
  readonly kind: 'model' | 'sprite' | 'sound' | 'structure';
  readonly entry: WorkspaceEntrySelector;
  readonly audit?: StructureAuditReport;
}

export interface NodeCheckResult {
  readonly sourceHash: string;
  readonly products: readonly NodeCheckProduct[];
}

const assertPackBindingNoLoop = (
  packFormat: string,
  sourceName: string,
  config: Snapshot['config'],
  entriesByKey: ReadonlyMap<string, ResolvedBuildEntry>,
): void => {
  const target = config.exports.find((e) => e.name === sourceName);
  const resolved = target ? entriesByKey.get(entrySelectorKey(target.entry)) : undefined;
  if (resolved?.sounds?.some((s) => s.playback.kind === 'loop')) {
    throw new BuildFailure(
      packFormat === 'minecraft_java' ? 'sound.loop.target' : 'sound.loop.codec',
      `${sourceName}: loop audio requires WAV game delivery`,
    );
  }
};

const assertNoLoopPackBindings = (
  config: Snapshot['config'],
  entriesByKey: ReadonlyMap<string, ResolvedBuildEntry>,
): void => {
  for (const pack of config.packs ?? []) {
    const bindings =
      pack.format === 'minecraft_java' ? pack.sounds : pack.audio === 'ogg' ? pack.assets : [];
    for (const binding of bindings) {
      assertPackBindingNoLoop(pack.format, binding.source, config, entriesByKey);
    }
  }
};

const toSoundMetadata = (sounds: readonly SoundProduct[]): AssetMetadata => ({
  variants: sounds.map((sound) => ({
    id: sound.variant,
    frames: sound.frames,
    sample_rate: sound.sample_rate,
    channels: sound.channels,
    playback: sound.playback,
    peak: sound.peak,
    rms: sound.rms,
    dc: sound.dc,
    seamDelta: sound.seamDelta,
    maxAdjacentDelta: sound.maxAdjacentDelta,
  })),
});

const collectSoundVariantTasks = (entries: readonly PlannedEntry[]) => {
  const jobs: {
    readonly entryKey: string;
    readonly weight: number;
    readonly task: WorkerTaskInput;
  }[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'sound' || !entry.preparedSound) continue;
    const rawVariants = entry.preparedSound.resolvedRecipe.variants;
    const variants = Array.isArray(rawVariants)
      ? (rawVariants as readonly { readonly id: string }[])
      : [];
    const perVarWeight = entry.preparedSound.budget.weightedFrames / Math.max(1, variants.length);
    for (const v of variants) {
      jobs.push({
        entryKey: entrySelectorKey(entry.entry),
        weight: perVarWeight,
        task: {
          kind: 'sound-variant',
          entryPath: entry.sourcePath,
          resolvedRecipe: entry.preparedSound.resolvedRecipe,
          variantId: v.id,
        },
      });
    }
  }
  return jobs.sort((a, b) => b.weight - a.weight);
};

const shouldRunSoundSequential = (uncached: readonly PlannedEntry[], jobCount: number): boolean => {
  if (jobCount <= 1) return true;
  if (uncached.length !== 1 || jobCount > 2) return false;
  const weighted = uncached[0]?.preparedSound?.budget.weightedFrames ?? 0;
  return weighted <= 4_000_000;
};

const compileUncachedSounds = async (
  uncached: readonly PlannedEntry[],
  pool: WorkerPoolHandle,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, readonly SoundProduct[]>> => {
  const jobs = collectSoundVariantTasks(uncached);
  if (jobs.length === 0) return new Map();
  const replies = shouldRunSoundSequential(uncached, jobs.length)
    ? await Promise.all(
        jobs.map(async (j) => {
          if (signal?.aborted) {
            throw new BuildFailure('build.cancelled', 'Compilation cancelled', 130);
          }
          return executeWorkerTask(j.task);
        }),
      )
    : await pool.run(
        jobs.map((j) => j.task),
        executeWorkerTask,
        signal,
      );
  const byEntry = new Map<string, SoundProduct[]>();
  jobs.forEach((job, idx) => {
    const reply = replies[idx];
    if (reply?.kind !== 'sound-variant') {
      throw new BuildFailure('build.worker', 'Invalid sound reply', 3);
    }
    const list = byEntry.get(job.entryKey) ?? [];
    list.push(reply.sound);
    byEntry.set(job.entryKey, list);
  });
  for (const list of byEntry.values()) list.sort((a, b) => compareText(a.variant, b.variant));
  return byEntry;
};

const runLightweightOrPooledTasks = async (
  tasks: readonly WorkerTaskInput[],
  allSprites: boolean,
  pool: WorkerPoolHandle,
  signal?: AbortSignal,
): Promise<readonly WorkerTaskResult[]> => {
  if (tasks.length === 0) return [];
  if (allSprites && tasks.length <= 24) {
    const out: WorkerTaskResult[] = [];
    for (const task of tasks) {
      if (signal?.aborted) throw new BuildFailure('build.cancelled', 'Compilation cancelled', 130);
      out.push(await executeWorkerTask(task));
    }
    return out;
  }
  return pool.run(tasks, executeWorkerTask, signal);
};

const resolveUncachedCheckOthers = async (
  uncachedOther: readonly PlannedEntry[],
  cache: DiskCacheContext,
  results: Map<string, NodeCheckProduct>,
  pool: WorkerPoolHandle,
  signal?: AbortSignal,
): Promise<void> => {
  if (uncachedOther.length === 0) return;
  const tasks: WorkerTaskInput[] = uncachedOther.map((e) => ({
    kind: 'check-entry',
    configuration: e.subConfigJson,
    files: e.files,
  }));
  const replies = await runLightweightOrPooledTasks(
    tasks,
    uncachedOther.every((e) => e.kind === 'sprite'),
    pool,
    signal,
  );
  uncachedOther.forEach((entry, idx) => {
    const reply = replies[idx];
    if (reply?.kind !== 'check-entry') {
      throw new BuildFailure('build.worker', 'Invalid check reply', 3);
    }
    const product: NodeCheckProduct = {
      kind: reply.productKind,
      entry: reply.entry,
      ...(reply.audit ? { audit: reply.audit } : {}),
    };
    results.set(entrySelectorKey(entry.entry), product);
    writeCacheJson(cache, `check-${entry.closureHash}-${cache.fingerprint}`, product);
  });
};

export const checkNodeSnapshot = async (
  snapshot: Snapshot,
  signal?: AbortSignal,
  options?: NodeBuildOptions,
): Promise<NodeCheckResult> => {
  const cache = createDiskCache(snapshot.root, 'node-check', options);
  const plan = planWorkspaceExecution(snapshot, cache);
  if (!plan) {
    const checked = checkSnapshot(snapshot);
    return {
      sourceHash: checked.sourceHash,
      products: checked.products.map((p) => ({
        kind: p.kind,
        entry: p.entry,
        ...(p.kind === 'structure' ? { audit: p.structure.audit } : {}),
      })),
    };
  }
  const results = new Map<string, NodeCheckProduct>();
  const uncachedSounds: PlannedEntry[] = [];
  const uncachedOther: PlannedEntry[] = [];
  for (const entry of plan.entries) {
    const cached = readCacheJson<NodeCheckProduct>(
      cache,
      `check-${entry.closureHash}-${cache.fingerprint}`,
    );
    if (cached) results.set(entrySelectorKey(entry.entry), cached);
    else if (entry.kind === 'sound') uncachedSounds.push(entry);
    else uncachedOther.push(entry);
  }
  const pool = createWorkerPool(
    poolWorkerModulePath(),
    uncachedSounds.length * 2 + uncachedOther.length,
    signal,
  );
  try {
    if (uncachedSounds.length > 0) {
      await compileUncachedSounds(uncachedSounds, pool, signal);
      for (const entry of uncachedSounds) {
        const product: NodeCheckProduct = { kind: 'sound', entry: entry.entry };
        results.set(entrySelectorKey(entry.entry), product);
        writeCacheJson(cache, `check-${entry.closureHash}-${cache.fingerprint}`, product);
      }
    }
    await resolveUncachedCheckOthers(uncachedOther, cache, results, pool, signal);
  } finally {
    await pool.close();
  }
  const ordered = [...plan.entries]
    .sort((a, b) =>
      compareText(
        `${a.entry.packageName}:${a.entry.entryName}`,
        `${b.entry.packageName}:${b.entry.entryName}`,
      ),
    )
    .map((e) => results.get(entrySelectorKey(e.entry))!);
  return { sourceHash: plan.sourceHash, products: ordered };
};

const toTargetSpecs = (
  plan: WorkspaceExecutionPlan,
): ReadonlyMap<string, readonly TargetExportSpec[]> => {
  const byEntry = new Map<string, TargetExportSpec[]>();
  for (const target of [...plan.config.exports].sort((a, b) => compareText(a.name, b.name))) {
    const key = entrySelectorKey(target.entry);
    const list = byEntry.get(key) ?? [];
    list.push({
      name: target.name,
      format: target.format,
      directory: target.directory,
      ...('encoding' in target && target.encoding ? { encoding: target.encoding } : {}),
      ...('namespace' in target && target.namespace ? { namespace: target.namespace } : {}),
      ...('modelPath' in target && target.modelPath ? { modelPath: target.modelPath } : {}),
    });
    byEntry.set(key, list);
  }
  return byEntry;
};

const buildEntryTask = (
  entry: PlannedEntry,
  targets: readonly TargetExportSpec[],
): WorkerTaskInput => {
  if (targets.length === 0) {
    return { kind: 'check-entry', configuration: entry.subConfigJson, files: entry.files };
  }
  if (entry.kind === 'sprite') {
    return {
      kind: 'build-sprite',
      configuration: entry.subConfigJson,
      files: entry.files,
      targetNames: targets.map((t) => t.name),
    };
  }
  if (entry.kind === 'structure') {
    return {
      kind: 'build-structure',
      configuration: entry.subConfigJson,
      files: entry.files,
      targets,
    };
  }
  return { kind: 'build-model', configuration: entry.subConfigJson, files: entry.files, targets };
};

const resolveUncachedSoundBuilds = async (
  uncachedSounds: readonly PlannedEntry[],
  targetsByEntry: ReadonlyMap<string, readonly TargetExportSpec[]>,
  cache: DiskCacheContext,
  resolved: Map<string, ResolvedBuildEntry>,
  pool: WorkerPoolHandle,
  signal?: AbortSignal,
): Promise<void> => {
  if (uncachedSounds.length === 0) return;
  const compiledMap = await compileUncachedSounds(uncachedSounds, pool, signal);
  const auditEntries = uncachedSounds.filter(
    (e) => (targetsByEntry.get(entrySelectorKey(e.entry)) ?? []).length > 0,
  );
  if (auditEntries.length > 0) {
    const auditTasks: WorkerTaskInput[] = auditEntries.map((e) => {
      const key = entrySelectorKey(e.entry);
      const firstTarget = targetsByEntry.get(key)![0]!.name;
      return { kind: 'sound-audit', targetName: firstTarget, sounds: compiledMap.get(key)! };
    });
    await pool.run(auditTasks, executeWorkerTask, signal);
  }
  for (const entry of uncachedSounds) {
    const key = entrySelectorKey(entry.entry);
    const sounds = compiledMap.get(key)!;
    const targets = targetsByEntry.get(key) ?? [];
    const item: ResolvedBuildEntry = {
      entry,
      productKind: 'sound',
      metadata: toSoundMetadata(sounds),
      sounds,
      targets: targets.map((t) => ({
        targetName: t.name,
        files: sounds.map((s) => ({ path: `${t.name}/${s.variant}.wav`, bytes: s.wav })),
      })),
    };
    resolved.set(key, item);
    writeCachedBuildEntry(item, targets, cache);
  }
};

const resolveUncachedOtherBuilds = async (
  uncachedOther: readonly PlannedEntry[],
  targetsByEntry: ReadonlyMap<string, readonly TargetExportSpec[]>,
  cache: DiskCacheContext,
  resolved: Map<string, ResolvedBuildEntry>,
  pool: WorkerPoolHandle,
  signal?: AbortSignal,
): Promise<void> => {
  if (uncachedOther.length === 0) return;
  const tasks = uncachedOther.map((e) =>
    buildEntryTask(e, targetsByEntry.get(entrySelectorKey(e.entry)) ?? []),
  );
  const replies = await runLightweightOrPooledTasks(
    tasks,
    uncachedOther.every((e) => e.kind === 'sprite'),
    pool,
    signal,
  );
  uncachedOther.forEach((entry, idx) => {
    const key = entrySelectorKey(entry.entry);
    const targets = targetsByEntry.get(key) ?? [];
    const reply = replies[idx]!;
    if (reply.kind === 'check-entry') {
      resolved.set(key, {
        entry,
        productKind: reply.productKind,
        metadata: { width: 0, height: 0 },
        targets: [],
        pkgInterfaces: reply.pkgInterfaces,
      });
      return;
    }
    if (reply.kind !== 'build-entry') {
      throw new BuildFailure('build.worker', 'Invalid build reply', 3);
    }
    const item: ResolvedBuildEntry = {
      entry,
      productKind: reply.productKind,
      metadata: reply.metadata,
      targets: reply.targets,
      pkgInterfaces: reply.pkgInterfaces,
    };
    resolved.set(key, item);
    writeCachedBuildEntry(item, targets, cache);
  });
};

const resolveModelWorkspaceHashIfNeeded = (
  plan: WorkspaceExecutionPlan,
  snapshotFiles: Snapshot['files'],
  resolved: ReadonlyMap<string, ResolvedBuildEntry>,
  cache: DiskCacheContext,
): string => {
  const modelEntries = plan.entries.filter((e) => e.kind === 'model');
  const hasExportedModel = plan.config.exports.some((e) =>
    modelEntries.some((m) => entrySelectorKey(m.entry) === entrySelectorKey(e.entry)),
  );
  if (modelEntries.length === 0 || !hasExportedModel) return '';
  const filesByPath = new Map(snapshotFiles.map((f) => [f.path, f]));
  const pkgInterfacesByEntry = new Map(
    [...resolved.entries()]
      .filter(([, item]) => Boolean(item.pkgInterfaces))
      .map(([k, item]) => [k, item.pkgInterfaces!] as const),
  );
  const known = collectExactModelPackageInterfaces(
    modelEntries,
    plan.config,
    pkgInterfacesByEntry,
    cache,
    filesByPath,
  );
  return computeModelWorkspaceHash(plan.config, snapshotFiles, modelEntries, known, cache);
};

export const compileNodeBundle = async (
  snapshot: Snapshot,
  toolchain: string,
  signal?: AbortSignal,
  options?: NodeBuildOptions,
): Promise<CompiledBundle> => {
  const cache = createDiskCache(snapshot.root, toolchain, options);
  const plan = planWorkspaceExecution(snapshot, cache);
  if (!plan) {
    const checked = checkSnapshot(snapshot);
    const encoder = requiresVorbisEncoder(snapshot)
      ? await createLazyVorbisGetter(signal)()
      : undefined;
    return compileBundle(snapshot, toolchain, encoder, checked);
  }
  const targetsByEntry = toTargetSpecs(plan);
  const resolved = new Map<string, ResolvedBuildEntry>();
  const uncachedSounds: PlannedEntry[] = [];
  const uncachedOther: PlannedEntry[] = [];
  for (const entry of plan.entries) {
    const key = entrySelectorKey(entry.entry);
    const hit = readCachedBuildEntry(entry, targetsByEntry.get(key) ?? [], cache);
    if (hit) resolved.set(key, hit);
    else if (entry.kind === 'sound') uncachedSounds.push(entry);
    else uncachedOther.push(entry);
  }
  const pool = createWorkerPool(
    poolWorkerModulePath(),
    uncachedSounds.length * 2 + uncachedOther.length,
    signal,
  );
  try {
    await resolveUncachedSoundBuilds(uncachedSounds, targetsByEntry, cache, resolved, pool, signal);
    await resolveUncachedOtherBuilds(uncachedOther, targetsByEntry, cache, resolved, pool, signal);
  } finally {
    await pool.close();
  }
  assertNoLoopPackBindings(plan.config, resolved);
  const modelWorkspaceHash = resolveModelWorkspaceHashIfNeeded(
    plan,
    snapshot.files,
    resolved,
    cache,
  );
  return finalizeNodeBundle(snapshot, plan, resolved, modelWorkspaceHash, toolchain, cache, signal);
};
