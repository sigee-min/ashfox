import { parentPort, workerData } from 'node:worker_threads';
import {
  BuildFailure,
  checkNodeSnapshot,
  compileNodeBundle,
  type CompiledBundle,
  type Snapshot,
} from '@ashfox/asset-build';
import type { HookBindingTarget } from '@ashfox/engine-core';
import { prepare } from './observe/prepare';

const postWorkerFailure = (error: unknown, defaultCode: string, defaultExit: number): void => {
  const failure = error instanceof BuildFailure ? error : null;
  parentPort!.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    code: failure ? failure.code : defaultCode,
    exitCode: failure ? failure.exitCode : defaultExit,
    ...(failure?.diagnostics ? { diagnostics: failure.diagnostics } : {}),
    ...(failure?.hint !== undefined ? { hint: failure.hint } : {}),
  });
};

const runObserveWorker = (observe: Parameters<typeof prepare>[0]): void => {
  try {
    parentPort!.postMessage({ ok: true, value: prepare(observe) });
  } catch (error) {
    postWorkerFailure(error, 'observe.compile', 1);
  }
};

const runBuildWorker = async (
  input: {
    snapshot: Snapshot;
    toolchain: string;
    command: string;
    noCache?: boolean;
    bindings?: readonly HookBindingTarget[];
  },
  signal: AbortSignal,
): Promise<void> => {
  try {
    let value: CompiledBundle | { sourceHash: string; products: readonly unknown[] };
    if (input.command === 'check') {
      value = await checkNodeSnapshot(input.snapshot, signal, {
        noCache: input.noCache,
      });
    } else {
      value = await compileNodeBundle(input.snapshot, input.toolchain, signal, {
        noCache: input.noCache,
        bindings: input.bindings,
      });
    }
    parentPort!.postMessage({ ok: true, value });
  } catch (error) {
    postWorkerFailure(error, 'build.failure', 3);
  }
};

/** Returns true when this worker thread belongs to the persistent asset-build pool. */
export const isPoolWorker = (): boolean =>
  Boolean(
    workerData &&
    typeof workerData === 'object' &&
    'ashfoxPoolWorker' in workerData &&
    (workerData as { ashfoxPoolWorker?: unknown }).ashfoxPoolWorker === true,
  );

/** Dispatches a single-shot worker thread task for observation or build/check. */
export const executeWorker = async (signal: AbortSignal): Promise<void> => {
  if (workerData.observe) {
    runObserveWorker(workerData.observe);
    return;
  }
  await runBuildWorker(
    workerData as {
      snapshot: Snapshot;
      toolchain: string;
      command: string;
      noCache?: boolean;
      bindings?: readonly HookBindingTarget[];
    },
    signal,
  );
};
