import { Worker } from 'node:worker_threads';
import { BuildFailure, type Snapshot, type CompiledBundle } from '@ashfox/asset-build';
interface CheckResult { readonly sourceHash: string; readonly products: readonly unknown[] }
interface WorkerResult {
  readonly ok: boolean; readonly value?: CompiledBundle | CheckResult;
  readonly message?: string; readonly code?: string; readonly exitCode?: number;
}
export const runWorker = (file: string, snapshot: Snapshot, toolchain: string, command: 'build' | 'check', signal?: AbortSignal):
  Promise<CompiledBundle | CheckResult> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new BuildFailure('build.cancelled', 'Build cancelled', 130)); return; }
  const worker = new Worker(file, { workerData: { snapshot, toolchain, command },
    resourceLimits: { maxOldGenerationSizeMb: 256 } });
  let settled = false, stopping: BuildFailure | undefined, grace: ReturnType<typeof setTimeout> | undefined;
  const finish = (error?: Error, value?: CompiledBundle | CheckResult): void => {
    if (settled) return; settled = true;
    clearTimeout(timer); clearTimeout(grace); signal?.removeEventListener('abort', cancel);
    void worker.terminate().then(() => error ? reject(error) : resolve(value!));
  };
  const stop = (failure: BuildFailure): void => {
    if (settled || stopping) return;
    stopping = failure;
    worker.postMessage('cancel');
    // Async encoders kill their child first; CPU-bound compilation remains bounded.
    grace = setTimeout(() => finish(failure), 2000);
  };
  const cancel = (): void => stop(new BuildFailure('build.cancelled', 'Build cancelled; previous output retained', 130));
  const timer = setTimeout(() => stop(new BuildFailure('build.timeout', 'Build exceeded 120 seconds', 3)), 120000);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  worker.once('message', (message: WorkerResult) => {
    if (stopping) { finish(stopping); return; }
    if (message.ok) finish(undefined, message.value);
    else finish(new BuildFailure(message.code ?? 'build.failure', message.message ?? 'Worker failed', message.exitCode ?? 3));
  });
  worker.once('error', error => finish(error));
  worker.once('exit', code => { if (!settled) finish(new BuildFailure('build.worker', `Worker exited without result (${code})`, 3)); });
});
