import { Worker } from 'node:worker_threads';
import { BuildFailure } from '../bundle/contract';

/** The parent owns publication; a cancelled candidate is never returned. */
export const runJob = <T>(file: string | URL, workerData: unknown, signal?: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new BuildFailure('build.cancelled', 'Compilation cancelled', 130)); return; }
    const worker = new Worker(file, { workerData, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    let settled = false, encoding = false, stopping: BuildFailure | undefined;
    const finish = (error?: Error, value?: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      void worker.terminate().then(() => error ? reject(error) : resolve(value!), reject);
    };
    const stop = (error: BuildFailure): void => {
      if (settled || stopping) return;
      stopping = error;
      if (encoding) {
        worker.postMessage('cancel');
        // The encoder kills and joins its child before replying. Never orphan it
        // by terminating this worker while it still owns a subprocess.
      } else finish(error);
    };
    const cancel = (): void => stop(new BuildFailure('build.cancelled', 'Compilation cancelled; previous output retained', 130));
    const timer = setTimeout(() => stop(new BuildFailure('build.timeout', 'Compilation exceeded 120 seconds', 3)), 120000);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    worker.on('message', (message: { phase?: string; ok?: boolean; value?: T; message?: string; code?: string; exitCode?: number }) => {
      if (message.phase) {
        encoding = message.phase === 'encoding';
        if (encoding && !settled) worker.postMessage('encoding-ready');
        if (!encoding && stopping) finish(stopping);
        return;
      }
      if (stopping) { finish(stopping); return; }
      if (message.ok) finish(undefined, message.value);
      else finish(new BuildFailure(message.code ?? 'build.failure', message.message ?? 'Worker failed', message.exitCode ?? 3));
    });
    worker.once('error', error => finish(stopping ?? error));
    worker.once('exit', code => { if (!settled) finish(stopping ?? new BuildFailure('build.worker', `Worker exited without result (${code})`, 3)); });
  });
