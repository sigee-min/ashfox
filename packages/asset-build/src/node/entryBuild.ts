import type { StructureAuditReport, WorkspaceEntrySelector } from '@ashfox/engine-core';
import { compareText } from '@ashfox/internal-contracts';
import { BuildFailure, type Snapshot } from '../bundle/contract';
import { writeCachedBuildEntry, type ResolvedBuildEntry } from './bundleCache';
import { writeCacheJson, type DiskCacheContext } from './diskCache';
import { entrySelectorKey, type PlannedEntry, type WorkspaceExecutionPlan } from './entryPlan';
import { collectExactModelPackageInterfaces, computeModelWorkspaceHash } from './modelHash';
import type { WorkerPoolHandle } from './workerPool';
import {
  executeWorkerTask,
  type TargetExportSpec,
  type WorkerTaskInput,
  type WorkerTaskResult,
} from './workerTask';

export interface NodeCheckProduct {
  readonly kind: 'model' | 'sprite' | 'sound' | 'structure' | 'vfx';
  readonly entry: WorkspaceEntrySelector;
  readonly audit?: StructureAuditReport;
}

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

export const resolveUncachedCheckOthers = async (
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

export const toTargetSpecs = (
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
  if (entry.kind === 'vfx') {
    return { kind: 'build-vfx', configuration: entry.subConfigJson, files: entry.files, targets };
  }
  return { kind: 'build-model', configuration: entry.subConfigJson, files: entry.files, targets };
};

export const resolveUncachedOtherBuilds = async (
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

export const resolveModelWorkspaceHashIfNeeded = (
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
