import assert from 'node:assert/strict';

import type { Logger } from '../../src/logging';
import { TraceLogFlushScheduler } from '../../src/trace/flush';
import { TraceLogStore } from '../../src/trace/store';
import type { TraceLogWriter } from '../../src/ports/traceLog';
import type { ToolError } from '@ashfox/blockbench-contracts/types/internal';

class QueueWriter implements TraceLogWriter {
  readonly writes: string[] = [];
  private readonly queue: Array<ToolError | null>;

  constructor(queue: Array<ToolError | null> = []) {
    this.queue = [...queue];
  }

  write(text: string): ToolError | null {
    this.writes.push(text);
    if (this.queue.length === 0) return null;
    return this.queue.shift() ?? null;
  }
}

const record = (seq: number) => ({
  kind: 'step' as const,
  seq,
  ts: new Date(1_700_000_100_000 + seq).toISOString(),
  route: 'tool' as const,
  op: `flush_${seq}`,
  response: { ok: true as const, data: { seq } },
});

const header = () => ({
  kind: 'header' as const,
  schemaVersion: 1 as const,
  createdAt: '2026-08-06T00:00:00.000Z',
});

const appendHeader = (store: TraceLogStore): void => {
  assert.equal(store.append(header()).error, undefined);
};

const createLogger = () => {
  const warnEntries: Array<{ message: string; meta?: Record<string, unknown> }> = [];
  const logger: Logger = {
    log: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (message, meta) => warnEntries.push({ message, meta }),
    error: () => undefined,
  };
  return { logger, warnEntries };
};

// interval-only policy flushes once clock delta reaches threshold.
{
  let now = 0;
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(store);
  const writer = new QueueWriter();
  const scheduler = new TraceLogFlushScheduler({
    store,
    writer,
    policy: { flushEvery: 0, flushIntervalMs: 10 },
    clock: () => now,
  });

  store.append(record(1));
  scheduler.recorded();
  assert.equal(writer.writes.length, 0);

  now = 10;
  store.append(record(2));
  scheduler.recorded();
  assert.equal(writer.writes.length, 1);
}

// force flush works even when disabled and pending is zero.
{
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  const writer = new QueueWriter();
  const scheduler = new TraceLogFlushScheduler({
    store,
    writer,
    policy: { enabled: false, flushEvery: 10 },
  });

  scheduler.flushNow();
  assert.equal(writer.writes.length, 0);
  scheduler.flushNow(true);
  assert.equal(writer.writes.length, 1);
}

// update() can swap writer/store/policy and apply to subsequent flushes.
{
  const storeA = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  const storeB = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(storeA);
  appendHeader(storeB);
  const writerA = new QueueWriter();
  const writerB = new QueueWriter();
  const scheduler = new TraceLogFlushScheduler({
    store: storeA,
    writer: writerA,
    policy: { flushEvery: 2 },
  });

  storeA.append(record(1));
  scheduler.recorded();
  assert.equal(writerA.writes.length, 0);

  scheduler.update({
    store: storeB,
    writer: writerB,
    policy: { enabled: true, flushEvery: 1, flushIntervalMs: 0 },
  });
  storeB.append(record(2));
  scheduler.recorded();
  assert.equal(writerA.writes.length, 0);
  assert.equal(writerB.writes.length, 1);
}

// repeated identical flush errors are deduplicated until a successful flush resets state.
{
  const errA: ToolError = { code: 'unknown', message: 'same' };
  const errB: ToolError = { code: 'unknown', message: 'different' };
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(store);
  const writer = new QueueWriter([errA, errA, errB, null, errB]);
  const { logger, warnEntries } = createLogger();
  const scheduler = new TraceLogFlushScheduler({
    store,
    writer,
    logger,
    policy: { flushEvery: 1 },
  });

  for (let i = 1; i <= 5; i += 1) {
    store.append(record(i));
    scheduler.recorded();
  }

  assert.equal(warnEntries.length, 3);
  assert.equal(warnEntries[0].message, 'trace log flush failed');
  assert.equal(warnEntries[0].meta?.message, 'same');
  assert.equal(warnEntries[1].meta?.message, 'different');
  assert.equal(warnEntries[2].meta?.message, 'different');
}

// null writer path is a no-op.
{
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(store);
  const scheduler = new TraceLogFlushScheduler({
    store,
    writer: null,
    policy: { flushEvery: 1 },
  });

  store.append(record(1));
  scheduler.recorded();
  scheduler.flushNow();
  scheduler.flushNow(true);
  assert.equal(store.size(), 2);
}
