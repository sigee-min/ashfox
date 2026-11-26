import * as os from 'node:os';
import { Worker } from 'node:worker_threads';
import { BuildFailure } from '../bundle/contract';

export interface PoolReply<O> {
  readonly id: number;
  readonly ok: boolean;
  readonly value?: O;
  readonly code?: string;
  readonly message?: string;
  readonly exitCode?: number;
}

interface PoolMessage<I> {
  readonly id: number;
  readonly payload: I;
}

export interface WorkerPoolHandle {
  readonly run: <I, O>(
    tasks: readonly I[],
    runLocal: (task: I) => Promise<O> | O,
    signal?: AbortSignal,
  ) => Promise<O[]>;
  readonly close: () => Promise<void>;
}

const tsBundleCache = new Map<string, string>();

export const resolveWorkerCount = (taskCount: number): number => {
  if (taskCount <= 1) return 1;
  const cpuLimit = Math.max(1, os.cpus().length);
  const rawJobs = process.env.ASHFOX_JOBS;
  if (rawJobs === '1') return 1;
  const parsed = rawJobs ? Number.parseInt(rawJobs, 10) : Number.NaN;
  const maxWorkers = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, cpuLimit) : cpuLimit;
  return Math.max(1, Math.min(taskCount, maxWorkers));
};

const tryCompileTsWorkerBundle = (workerModulePath: string): string | null => {
  const cached = tsBundleCache.get(workerModulePath);
  if (cached !== undefined) return cached;
  try {
    const esbuildName = 'esbuild';
    const esbuild = require(esbuildName) as {
      buildSync: (opts: {
        entryPoints: string[];
        bundle: boolean;
        platform: string;
        target: string;
        format: string;
        write: boolean;
      }) => { outputFiles: { text: string }[] };
    };
    const result = esbuild.buildSync({
      entryPoints: [workerModulePath],
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
      write: false,
    });
    const code = result.outputFiles[0]?.text ?? null;
    if (code) tsBundleCache.set(workerModulePath, code);
    return code;
  } catch {
    return null;
  }
};

const createPoolWorker = (workerModulePath: string): Worker => {
  if (!workerModulePath.endsWith('.ts')) {
    return new Worker(workerModulePath, {
      workerData: { ashfoxPoolWorker: true },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
  }
  const compiled = tryCompileTsWorkerBundle(workerModulePath);
  if (compiled) {
    return new Worker(compiled, {
      eval: true,
      workerData: { ashfoxPoolWorker: true, ashfoxPoolEval: true },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
  }
  const bootstrap = [
    "require('ts-node').register({",
    '  transpileOnly: true,',
    '  skipProject: true,',
    "  compilerOptions: { module: 'CommonJS', moduleResolution: 'Node', esModuleInterop: true, target: 'ES2022' },",
    '});',
    "require(require('node:worker_threads').workerData.workerModule);",
  ].join('\n');
  return new Worker(bootstrap, {
    eval: true,
    workerData: { ashfoxPoolWorker: true, workerModule: workerModulePath },
    resourceLimits: { maxOldGenerationSizeMb: 512 },
  });
};

const assertNotAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new BuildFailure(
      'build.cancelled',
      'Compilation cancelled; previous output retained',
      130,
    );
  }
};

const runSequential = async <I, O>(
  tasks: readonly I[],
  runLocal: (task: I) => Promise<O> | O,
  signal?: AbortSignal,
): Promise<O[]> => {
  const results: O[] = [];
  for (const task of tasks) {
    assertNotAborted(signal);
    results.push(await runLocal(task));
  }
  assertNotAborted(signal);
  return results;
};

interface BatchState {
  readonly tasks: readonly unknown[];
  readonly results: unknown[];
  readonly offset: number;
  nextIndex: number;
  completed: number;
  settled: boolean;
  readonly finish: (error?: Error) => void;
}

interface PoolContext {
  readonly workerModulePath: string;
  workers: Worker[] | null;
  activeBatch: BatchState | null;
  closed: boolean;
  nextBatchOffset: number;
}

const handlePoolReply = (ctx: PoolContext, worker: Worker, reply: PoolReply<unknown>): void => {
  const batch = ctx.activeBatch;
  if (!batch || batch.settled) return;
  if (!reply.ok) {
    batch.finish(
      new BuildFailure(
        reply.code ?? 'build.failure',
        reply.message ?? 'Worker task failed',
        reply.exitCode ?? 3,
      ),
    );
    return;
  }
  batch.results[reply.id - batch.offset] = reply.value;
  batch.completed += 1;
  if (batch.completed === batch.tasks.length) {
    batch.finish();
    return;
  }
  if (batch.nextIndex < batch.tasks.length) {
    const idx = batch.nextIndex++;
    const msg: PoolMessage<unknown> = { id: batch.offset + idx, payload: batch.tasks[idx] };
    worker.postMessage(msg);
  }
};

const ensurePoolWorkers = (ctx: PoolContext, count: number): Worker[] => {
  if (ctx.workers) return ctx.workers;
  ctx.workers = Array.from({ length: count }, () => {
    const worker = createPoolWorker(ctx.workerModulePath);
    worker.on('message', (reply: PoolReply<unknown>) => handlePoolReply(ctx, worker, reply));
    worker.once('error', (error) => ctx.activeBatch?.finish(error));
    worker.once('exit', (code) => {
      if (!ctx.closed && ctx.activeBatch && !ctx.activeBatch.settled) {
        ctx.activeBatch.finish(new BuildFailure('build.worker', `Pool worker exited (${code})`, 3));
      }
    });
    return worker;
  });
  return ctx.workers;
};

const closePoolContext = async (ctx: PoolContext): Promise<void> => {
  ctx.closed = true;
  const list = ctx.workers;
  ctx.workers = null;
  if (list && list.length > 0) await Promise.allSettled(list.map((w) => w.terminate()));
};

const runPoolBatch = <I, O>(
  ctx: PoolContext,
  pool: Worker[],
  tasks: readonly I[],
  signal?: AbortSignal,
): Promise<O[]> => {
  const batchOffset = ctx.nextBatchOffset;
  ctx.nextBatchOffset += tasks.length;
  return new Promise<O[]>((resolve, reject) => {
    const results = new Array<O>(tasks.length);
    const onAbort = (): void => {
      batch.finish(
        new BuildFailure('build.cancelled', 'Compilation cancelled; previous output retained', 130),
      );
    };
    const batch: BatchState = {
      tasks,
      results,
      offset: batchOffset,
      nextIndex: 0,
      completed: 0,
      settled: false,
      finish: (error?: Error) => {
        if (batch.settled) return;
        batch.settled = true;
        ctx.activeBatch = null;
        signal?.removeEventListener('abort', onAbort);
        if (error) void closePoolContext(ctx).then(() => reject(error));
        else resolve(results);
      },
    };
    ctx.activeBatch = batch;
    signal?.addEventListener('abort', onAbort, { once: true });
    const activeCount = Math.min(pool.length, tasks.length);
    for (let i = 0; i < activeCount; i++) {
      const idx = batch.nextIndex++;
      pool[i]!.postMessage({ id: batchOffset + idx, payload: tasks[idx] });
    }
  });
};

export const createWorkerPool = (
  workerModulePath: string,
  maxTaskCount: number,
  signal?: AbortSignal,
): WorkerPoolHandle => {
  const ctx: PoolContext = {
    workerModulePath,
    workers: null,
    activeBatch: null,
    closed: false,
    nextBatchOffset: 0,
  };
  return {
    run: async <I, O>(
      tasks: readonly I[],
      runLocal: (task: I) => Promise<O> | O,
      runSignal?: AbortSignal,
    ): Promise<O[]> => {
      const sig = runSignal ?? signal;
      assertNotAborted(sig);
      if (tasks.length === 0) return [];
      const count = resolveWorkerCount(Math.max(tasks.length, maxTaskCount));
      if (tasks.length <= 1 || count <= 1) return runSequential(tasks, runLocal, sig);
      const pool = ensurePoolWorkers(ctx, Math.min(count, Math.max(tasks.length, maxTaskCount)));
      return runPoolBatch<I, O>(ctx, pool, tasks, sig);
    },
    close: () => closePoolContext(ctx),
  };
};
