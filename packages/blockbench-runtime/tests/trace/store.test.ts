import assert from 'node:assert/strict';

import {
  isProjectDiffContract,
  isProjectStateContract,
} from '@ashfox/blockbench-contracts/types/project/contract';
import { isTraceLogEntry } from '@ashfox/blockbench-contracts/types/traceLog';
import { TraceLogStore } from '../../src/trace/store';
import { parseTraceLogText } from '../../src/trace/replay';
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

const header = () => ({
  kind: 'header' as const,
  schemaVersion: 1 as const,
  createdAt: '2026-08-06T00:00:00.000Z',
});

const record = (seq: number) => ({
  kind: 'step' as const,
  seq,
  ts: new Date(1_700_000_000_000 + seq).toISOString(),
  route: 'tool' as const,
  op: `op_${seq}`,
  response: { ok: true as const, data: { seq } },
});

const appendHeader = (store: TraceLogStore): void => {
  assert.equal(store.append(header()).error, undefined);
};

const nestedTriggerValue = (depth: number): Record<string, unknown> => {
  let value: Record<string, unknown> = {};
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }
  return value;
};

// append() returns writer error when autoFlush is enabled.
{
  const writeError: ToolError = { code: 'unknown', message: 'write failed' };
  const writer = new QueueWriter([null, writeError]);
  const store = new TraceLogStore({ writer, autoFlush: true, maxEntries: 10 });
  appendHeader(store);
  const appended = store.append(record(1));
  assert.equal(appended.error?.code, 'unknown');
  assert.equal(writer.writes.length, 2);
  assert.equal(writer.writes[1].includes('"op":"op_1"'), true);
}

// flush() supports writer override and no-writer fallback.
{
  const defaultWriter = new QueueWriter();
  const overrideError: ToolError = { code: 'invalid_state', message: 'override failed' };
  const overrideWriter = new QueueWriter([overrideError]);
  const store = new TraceLogStore({ writer: defaultWriter, autoFlush: false, maxEntries: 10 });
  appendHeader(store);
  store.append(record(1));
  const flushed = store.flush(overrideWriter);
  assert.equal(flushed?.code, 'invalid_state');
  assert.equal(defaultWriter.writes.length, 0);
  assert.equal(overrideWriter.writes.length, 1);
  assert.equal(new TraceLogStore({ autoFlush: false }).flush(), null);
}

// maxEntries trimming pins the header and keeps the latest step parseable.
{
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 2 });
  appendHeader(store);
  for (let i = 1; i <= 1205; i += 1) store.append(record(i));
  const text = store.getText();
  assert.equal(store.size(), 2);
  assert.equal(JSON.parse(text.split('\n')[0]).kind, 'header');
  assert.equal(text.includes('"seq":1,"ts"'), false);
  assert.equal(text.includes('"seq":1205,"ts"'), true);
  const parsed = parseTraceLogText(text);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(
      parsed.records.map((entry) => entry.kind),
      ['header', 'step'],
    );
  }
}

// maxBytes trimming respects its floor without ever evicting the header.
{
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10, maxBytes: 1, minEntries: 2 });
  appendHeader(store);
  store.append(record(1));
  store.append(record(2));
  store.append(record(3));
  assert.equal(store.size(), 2);
  assert.equal(parseTraceLogText(store.getText()).ok, true);

  store.update({ minEntries: 0 });
  store.append(record(4));
  assert.equal(store.size(), 1);
  assert.equal(parseTraceLogText(store.getText()).ok, true);

  store.update({ maxBytes: 0 });
  store.append(record(5));
  assert.equal(store.size(), 2);
  assert.equal(parseTraceLogText(store.getText()).ok, true);
}

// maxBytes is an encoded UTF-8 byte budget, not a UTF-16 code-unit budget.
{
  const unicodeRecord = {
    ...record(1),
    response: { ok: true as const, data: { label: '🐾'.repeat(30) } },
  };
  const uncapped = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(uncapped);
  uncapped.append(unicodeRecord);
  const codeUnitBudget = uncapped.getText().length;
  assert.ok(Buffer.byteLength(uncapped.getText(), 'utf8') > codeUnitBudget);

  const capped = new TraceLogStore({
    autoFlush: false,
    maxEntries: 10,
    maxBytes: codeUnitBudget,
  });
  appendHeader(capped);
  capped.append(unicodeRecord);
  assert.equal(capped.size(), 1);
}

// A diff must describe the same observed revision as its paired state.
{
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(store);
  const result = store.append({
    ...record(1),
    state: {
      id: 'p1',
      revision: 'state-r9',
      name: null,
      format: null,
      counts: { bones: 0, cubes: 0, textures: 0, animations: 0 },
    },
    diff: {
      sinceRevision: 'r1',
      currentRevision: 'diff-r2',
      counts: {
        bones: { added: 0, removed: 0, changed: 0 },
        cubes: { added: 0, removed: 0, changed: 0 },
        textures: { added: 0, removed: 0, changed: 0 },
        animations: { added: 0, removed: 0, changed: 0 },
      },
    },
  });
  assert.equal(result.error?.details?.reason, 'trace_log_record_invalid');
  assert.equal(store.size(), 1);
}

// append() validates and serializes one descriptor snapshot, never re-reading a hostile source.
{
  let descriptorReads = 0;
  let propertyReads = 0;
  const payload = new Proxy(
    { value: 'source' },
    {
      get: () => {
        propertyReads += 1;
        throw new Error('property read must not occur');
      },
      getOwnPropertyDescriptor: (_target, key) => {
        descriptorReads += 1;
        if (descriptorReads > 1) throw new Error('second descriptor read');
        return {
          value: key === 'value' ? 'snapshotted' : undefined,
          enumerable: true,
          configurable: true,
          writable: true,
        };
      },
    },
  );
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(store);
  const result = store.append({ ...record(1), payload });
  assert.equal(result.error, undefined);
  assert.equal(result.text.includes('"value":"snapshotted"'), true);
  assert.equal(descriptorReads, 1);
  assert.equal(propertyReads, 0);
}

// Snapshot depth includes the declared trace envelope without shrinking nested v1 values.
{
  const animation = {
    name: 'timeline',
    length: 1,
    loop: false,
    triggers: [
      {
        type: 'timeline' as const,
        keys: [{ time: 0, value: nestedTriggerValue(64) }],
      },
    ],
  };
  const state = {
    id: 'p1',
    active: true,
    name: null,
    format: null,
    revision: 'r1',
    counts: {
      bones: 0,
      cubes: 0,
      textures: 0,
      animations: 1,
    },
    animations: [animation],
  };
  const entry = { ...record(1), state };
  assert.equal(isProjectStateContract(state), true);
  assert.equal(isTraceLogEntry(entry), true);
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(store);
  assert.equal(store.append(entry).error, undefined);
  assert.equal(parseTraceLogText(store.getText()).ok, true);
}

{
  const changedAnimation = {
    name: 'timeline',
    length: 1,
    loop: false,
    triggers: [
      {
        type: 'timeline' as const,
        keys: [{ time: 0, value: nestedTriggerValue(64) }],
      },
    ],
  };
  const zero = { added: 0, removed: 0, changed: 0 };
  const diff = {
    sinceRevision: 'r0',
    currentRevision: 'r1',
    counts: {
      bones: zero,
      cubes: zero,
      textures: zero,
      animations: { added: 0, removed: 0, changed: 1 },
    },
    animations: {
      added: [],
      removed: [],
      changed: [
        {
          key: 'timeline',
          before: changedAnimation,
          after: { name: 'timeline', length: 1, loop: false },
        },
      ],
    },
  };
  const entry = {
    ...record(1),
    state: {
      id: 'p1',
      revision: 'r1',
      name: null,
      format: null,
      counts: { bones: 0, cubes: 0, textures: 0, animations: 1 },
    },
    diff,
  };
  assert.equal(isProjectDiffContract(diff), true);
  assert.equal(isTraceLogEntry(entry), true);
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(store);
  assert.equal(store.append(entry).error, undefined);
  assert.equal(parseTraceLogText(store.getText()).ok, true);
}

// A ledger must start with one header and reject duplicate/non-increasing state.
{
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  assert.equal(store.append(record(1)).error?.details?.reason, 'trace_log_header_required');
  appendHeader(store);
  assert.equal(store.append(header()).error?.details?.reason, 'trace_log_header_duplicated');
  assert.equal(store.append(record(2)).error, undefined);
  assert.equal(store.append(record(2)).error?.details?.reason, 'trace_log_sequence_invalid');
  assert.equal(store.append(record(1)).error?.details?.reason, 'trace_log_sequence_invalid');
  assert.equal(store.append(record(3)).error, undefined);
}

// clear() resets header and sequence state for a fresh ledger.
{
  const store = new TraceLogStore({ autoFlush: false, maxEntries: 10 });
  appendHeader(store);
  store.append(record(1));
  assert.equal(store.size(), 2);
  assert.equal(store.getText().length > 0, true);
  store.clear();
  assert.equal(store.size(), 0);
  assert.equal(store.getText(), '');
  assert.equal(store.append(record(2)).error?.details?.reason, 'trace_log_header_required');
  appendHeader(store);
  assert.equal(store.append(record(1)).error, undefined);
  assert.equal(parseTraceLogText(store.getText()).ok, true);
}
