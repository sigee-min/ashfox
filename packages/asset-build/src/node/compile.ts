import { compareText } from '@ashfox/internal-contracts';
import { checkSnapshot, compileBundle } from '../bundle/compile';
import { generateWorkspaceHookBindings } from '../bundle/bindings';
import { generateBundleRuntimeSdk, normalizeSdkTargets } from '../bundle/sdk';
import type { CompiledBundle, Snapshot } from '../bundle/contract';
import {
  assertNoLoopPackBindings,
  finalizeNodeBundle,
  readCachedBuildEntry,
  requiresVorbisEncoder,
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
  resolveModelWorkspaceHashIfNeeded,
  resolveUncachedCheckOthers,
  resolveUncachedOtherBuilds,
  toTargetSpecs,
  type NodeCheckProduct,
} from './entryBuild';
import { entrySelectorKey, planWorkspaceExecution, type PlannedEntry } from './entryPlan';
import { createLazyVorbisGetter } from './packCache';
import { compileUncachedSounds, resolveUncachedSoundBuilds } from './soundCompile';
import { createWorkerPool } from './workerPool';
import { poolWorkerModulePath, type TargetExportSpec } from './workerTask';

export type { NodeBuildOptions } from './diskCache';
export type { NodeCheckProduct } from './entryBuild';

export interface NodeCheckResult {
  readonly sourceHash: string;
  readonly products: readonly NodeCheckProduct[];
}

const partitionCheckEntries = (entries: readonly PlannedEntry[], cache: DiskCacheContext) => {
  const results = new Map<string, NodeCheckProduct>();
  const uncachedSounds: PlannedEntry[] = [];
  const uncachedOther: PlannedEntry[] = [];
  for (const entry of entries) {
    const cached = readCacheJson<NodeCheckProduct>(
      cache,
      `check-${entry.closureHash}-${cache.fingerprint}`,
    );
    if (cached) results.set(entrySelectorKey(entry.entry), cached);
    else if (entry.kind === 'sound') uncachedSounds.push(entry);
    else uncachedOther.push(entry);
  }
  return { results, uncachedSounds, uncachedOther };
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
  const { results, uncachedSounds, uncachedOther } = partitionCheckEntries(plan.entries, cache);
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

const partitionBuildEntries = (
  entries: readonly PlannedEntry[],
  targetsByEntry: ReadonlyMap<string, readonly TargetExportSpec[]>,
  cache: DiskCacheContext,
) => {
  const resolved = new Map<string, ResolvedBuildEntry>();
  const uncachedSounds: PlannedEntry[] = [];
  const uncachedOther: PlannedEntry[] = [];
  for (const entry of entries) {
    const key = entrySelectorKey(entry.entry);
    const hit = readCachedBuildEntry(entry, targetsByEntry.get(key) ?? [], cache);
    if (hit) resolved.set(key, hit);
    else if (entry.kind === 'sound') uncachedSounds.push(entry);
    else uncachedOther.push(entry);
  }
  return { resolved, uncachedSounds, uncachedOther };
};

const attachNodeBundleExtras = (
  snapshot: Snapshot,
  bundle: CompiledBundle,
  options?: NodeBuildOptions,
): CompiledBundle => {
  const bindings =
    options?.bindings && options.bindings.length > 0
      ? generateWorkspaceHookBindings(snapshot.files, options.bindings)
      : undefined;
  const effectiveSdk = normalizeSdkTargets([
    ...(snapshot.config.sdk ?? []),
    ...(options?.sdk ?? []),
  ]);
  const sdk =
    effectiveSdk.length > 0
      ? generateBundleRuntimeSdk(
          snapshot.config.name,
          bundle.catalog,
          bundle.artifacts,
          effectiveSdk,
        )
      : undefined;
  return {
    ...bundle,
    ...(bindings && bindings.length > 0 ? { bindings } : {}),
    ...(sdk && sdk.length > 0 ? { sdk } : {}),
  };
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
    return compileBundle(snapshot, toolchain, encoder, checked, options?.bindings, options?.sdk);
  }
  const targetsByEntry = toTargetSpecs(plan);
  const { resolved, uncachedSounds, uncachedOther } = partitionBuildEntries(
    plan.entries,
    targetsByEntry,
    cache,
  );
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
  const bundle = await finalizeNodeBundle(
    snapshot,
    plan,
    resolved,
    modelWorkspaceHash,
    toolchain,
    cache,
    signal,
  );
  return attachNodeBundleExtras(snapshot, bundle, options);
};
