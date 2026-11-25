import { Worker } from 'node:worker_threads';
import { BuildFailure } from '../bundle/contract';

interface WorkerMessage<T> {
  phase?: string;
  ok?: boolean;
  value?: T;
  message?: string;
  code?: string;
  exitCode?: number;
}

interface JobState<T> {
  worker: Worker;
  signal: AbortSignal | undefined;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
  encoding: boolean;
  stopping: BuildFailure | undefined;
  finish: (error?: Error, value?: T) => void;
  stop: (error: BuildFailure) => void;
}

const createJobState = <T>(
  worker: Worker,
  resolve: (value: T) => void,
  reject: (reason?: unknown) => void,
  cancel: () => void,
  signal?: AbortSignal,
): JobState<T> => {
  const state: JobState<T> = {
    worker,
    signal,
    settled: false,
    encoding: false,
    stopping: undefined,
    timer: setTimeout(
      () => state.stop(new BuildFailure('build.timeout', 'Compilation exceeded 120 seconds', 3)),
      120000,
    ),
    finish: (error?: Error, value?: T) => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(state.timer);
      signal?.removeEventListener('abort', cancel);
      void worker.terminate().then(() => (error ? reject(error) : resolve(value!)), reject);
    },
    stop: (error: BuildFailure) => {
      if (state.settled || state.stopping) return;
      state.stopping = error;
      if (state.encoding) {
        worker.postMessage('cancel');
        // The encoder kills and joins its child before replying. Never orphan it
        // by terminating this worker while it still owns a subprocess.
      } else state.finish(error);
    },
  };
  return state;
};

const handleWorkerMessage = <T>(state: JobState<T>, message: WorkerMessage<T>): void => {
  if (message.phase) {
    state.encoding = message.phase === 'encoding';
    if (state.encoding && !state.settled) state.worker.postMessage('encoding-ready');
    if (!state.encoding && state.stopping) state.finish(state.stopping);
    return;
  }
  if (state.stopping) {
    state.finish(state.stopping);
    return;
  }
  if (message.ok) {
    state.finish(undefined, message.value);
    return;
  }
  state.finish(
    new BuildFailure(
      message.code ?? 'build.failure',
      message.message ?? 'Worker failed',
      message.exitCode ?? 3,
    ),
  );
};

const attachWorkerLifecycle = <T>(
  worker: Worker,
  resolve: (value: T) => void,
  reject: (reason?: unknown) => void,
  signal?: AbortSignal,
): void => {
  const cancel = (): void =>
    state.stop(
      new BuildFailure('build.cancelled', 'Compilation cancelled; previous output retained', 130),
    );
  const state = createJobState(worker, resolve, reject, cancel, signal);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  worker.on('message', (message: WorkerMessage<T>) => handleWorkerMessage(state, message));
  worker.once('error', (error) => state.finish(state.stopping ?? error));
  worker.once('exit', (code) => {
    if (!state.settled)
      state.finish(
        state.stopping ??
          new BuildFailure('build.worker', `Worker exited without result (${code})`, 3),
      );
  });
};

/** The parent owns publication; a cancelled candidate is never returned. */
export const runJob = <T>(
  file: string | URL,
  workerData: unknown,
  signal?: AbortSignal,
): Promise<T> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BuildFailure('build.cancelled', 'Compilation cancelled', 130));
      return;
    }
    const worker = new Worker(file, {
      workerData,
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    attachWorkerLifecycle(worker, resolve, reject, signal);
  });
