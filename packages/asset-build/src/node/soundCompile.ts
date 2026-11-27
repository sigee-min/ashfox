import type { SoundProduct } from '@ashfox/audio-core';
import { compareText, encodeUtf8 } from '@ashfox/internal-contracts';
import { BuildFailure } from '../bundle/contract';
import { buildSoundMetadata } from '../bundle/delivery/sound';
import { writeCachedBuildEntry, type ResolvedBuildEntry } from './bundleCache';
import type { DiskCacheContext } from './diskCache';
import { entrySelectorKey, type PlannedEntry } from './entryPlan';
import { resolveSoundEntryHooksJson } from './soundPlan';
import type { WorkerPoolHandle } from './workerPool';
import { executeWorkerTask, type TargetExportSpec, type WorkerTaskInput } from './workerTask';

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

export const compileUncachedSounds = async (
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

export const resolveUncachedSoundBuilds = async (
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
    const hooksJson = resolveSoundEntryHooksJson(entry.sourcePath, entry.files);
    const item: ResolvedBuildEntry = {
      entry,
      productKind: 'sound',
      metadata: buildSoundMetadata(sounds),
      sounds,
      ...(hooksJson ? { hooksJson } : {}),
      targets: targets.map((t) => ({
        targetName: t.name,
        files: [
          ...sounds.map((s) => ({ path: `${t.name}/${s.variant}.wav`, bytes: s.wav })),
          ...(hooksJson ? [{ path: `${t.name}.hooks.json`, bytes: encodeUtf8(hooksJson) }] : []),
        ],
      })),
    };
    resolved.set(key, item);
    writeCachedBuildEntry(item, targets, cache);
  }
};
